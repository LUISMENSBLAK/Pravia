import { Prisma, PrismaClient } from '@prisma/client';
import { CotizacionBusinessError, evaluateConversionEligibility } from '../domain/cotizacionWorkflow';
import { ExpedienteOpeningService } from './expedienteOpening.service';
import { attachGeneratedFeeToExpediente } from './honorarioRecognition.service';

export interface ConvertCotizacionInput {
  cotizacionId: string;
  actorUserId?: string;
  abogadoId?: string;
  tipoActoId?: string;
  correlationId?: string;
}

export interface ConvertCotizacionResult {
  expediente: any;
  alreadyConverted: boolean;
  correlationId: string;
  validatedAdvanceTotal: number;
}

export class CotizacionConversionService {
  constructor(private readonly prisma: PrismaClient) {}

  async convert(input: ConvertCotizacionInput): Promise<ConvertCotizacionResult> {
    if (!input.cotizacionId) {
      throw new CotizacionBusinessError('cotizacion_id es obligatorio.', 'COTIZACION_ID_REQUIRED');
    }

    const correlationId = input.correlationId || crypto.randomUUID();

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cotizacion:${input.cotizacionId}`}))`);

      const cotizacion = await tx.cotizacion.findUnique({
        where: { id: input.cotizacionId },
        include: {
          prospecto: true,
          expediente: true,
          versiones: { orderBy: { version: 'desc' } },
          pagos: true,
        },
      });

      if (!cotizacion) {
        throw new CotizacionBusinessError('Cotización no encontrada.', 'COTIZACION_NOT_FOUND', 404);
      }

      if (cotizacion.expediente) {
        return {
          expediente: cotizacion.expediente,
          alreadyConverted: true,
          correlationId,
          validatedAdvanceTotal: cotizacion.pagos
            .filter((payment) => payment.categoria_ingreso === 'ANTICIPO_NOTARIA' && payment.estatus === 'VALIDADO')
            .reduce((sum, payment) => sum + Number(payment.monto), 0),
        };
      }

      if (cotizacion.estado === 'CONVERTIDA_EXPEDIENTE') {
        throw new CotizacionBusinessError(
          'La cotización figura como convertida, pero no tiene expediente vinculado. Requiere revisión de integridad antes de continuar.',
          'CONVERSION_INTEGRITY_ERROR',
          409,
        );
      }

      const eligibility = evaluateConversionEligibility(cotizacion);
      if (!eligibility.eligible) {
        throw new CotizacionBusinessError(eligibility.failures.join(' '), 'CONVERSION_REQUIREMENTS_NOT_MET');
      }

      const actorId = input.actorUserId || cotizacion.user_id;
      const lawyerId = input.abogadoId || cotizacion.user_id;
      const [actor, lawyer] = await Promise.all([
        tx.user.findFirst({ where: { id: actorId, activo: true } }),
        tx.user.findFirst({ where: { id: lawyerId, activo: true } }),
      ]);
      if (!actor) throw new CotizacionBusinessError('El usuario que convierte no existe o está inactivo.', 'ACTOR_INVALID', 403);
      if (!lawyer) throw new CotizacionBusinessError('El abogado asignado no existe o está inactivo.', 'LAWYER_INVALID');

      const tipoActo = await this.resolveTipoActo(tx, input.tipoActoId, cotizacion.prospecto?.tipo_acto);
      const approvedVersion = cotizacion.versiones.find((version) => version.aprobada)
        || cotizacion.versiones[0];
      const frozenBudget = approvedVersion ? {
        rubros: (approvedVersion.desglose_notaria as any)?.rubros || [],
        total_notaria: Number(approvedVersion.total_notaria),
        honorarios_pravia: Number(approvedVersion.honorarios_pravia),
        total_cliente: Number(approvedVersion.total_cliente),
        cotizacion_version_id: approvedVersion.id,
      } : null;

      const expediente = await new ExpedienteOpeningService(this.prisma).openInTransaction(tx, {
        tipoActoId: tipoActo.id,
        abogadoId: lawyer.id,
        actorUserId: actor.id,
        clienteAlias: cotizacion.prospecto?.nombre || 'Cliente',
        notariaId: cotizacion.notaria_id,
        cotizacionId: cotizacion.id,
        datosOperacion: frozenBudget ? { presupuesto: frozenBudget } : undefined,
        proximaAccion: 'Integrar documentación y comparecientes',
        correlationId,
        source: 'COTIZACION',
      });
      const numeroPravia = expediente.numero_pravia;

      const documentLinks = await this.collectDocuments(tx, cotizacion.id, cotizacion.prospecto_id);
      for (const documentId of documentLinks) {
        await tx.expedienteDocumento.upsert({
          where: {
            expediente_id_documento_id_tipo_vinculo: {
              expediente_id: expediente.id,
              documento_id: documentId,
              tipo_vinculo: 'Administrativo',
            },
          },
          update: { estatus: 'ACTIVO' },
          create: {
            expediente_id: expediente.id,
            documento_id: documentId,
            tipo_vinculo: 'Administrativo',
            creado_por_id: actor.id,
            estatus: 'ACTIVO',
          },
        });
      }

      await tx.pago.updateMany({
        where: { cotizacion_id: cotizacion.id },
        data: { expediente_id: expediente.id },
      });
      await attachGeneratedFeeToExpediente(tx, { cotizacionId: cotizacion.id, expedienteId: expediente.id });

      await tx.cotizacion.update({
        where: { id: cotizacion.id },
        data: { estado: 'CONVERTIDA_EXPEDIENTE', fecha_conversion_expediente: new Date() },
      });
      if (cotizacion.prospecto_id) {
        await tx.prospecto.update({
          where: { id: cotizacion.prospecto_id },
          data: { estado: 'ACEPTADO' },
        });
      }

      await tx.expedienteActividad.create({
        data: {
          expediente_id: expediente.id,
          usuario_id: actor.id,
          tipo: 'AUDITORIA',
          titulo: 'Conversión desde cotización aceptada',
          descripcion: `Expediente ${numeroPravia} creado con anticipo validado por ${eligibility.validatedAdvanceTotal.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}. Se vincularon ${documentLinks.size} documento(s) sin duplicar archivos.`,
          metadatos: {
            cotizacion_id: cotizacion.id,
            anticipo_validado: eligibility.validatedAdvanceTotal,
            correlation_id: correlationId,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          user_id: actor.id,
          accion: 'CONVERT_TO_EXPEDIENTE',
          entidad: 'Cotizacion',
          entidad_id: cotizacion.id,
          valores_anteriores: { estado: cotizacion.estado },
          valores_nuevos: { estado: 'CONVERTIDA_EXPEDIENTE', expediente_id: expediente.id, numero_pravia: numeroPravia },
          correlation_id: correlationId,
          detalles: { anticipo_validado: eligibility.validatedAdvanceTotal, documentos_vinculados: documentLinks.size },
        },
      });
      await tx.domainEventOutbox.create({
        data: {
          event_type: 'CotizacionConvertidaAExpediente',
          aggregate_type: 'Cotizacion',
          aggregate_id: cotizacion.id,
          actor_user_id: actor.id,
          correlation_id: correlationId,
          payload: {
            expediente_id: expediente.id,
            numero_pravia: numeroPravia,
            anticipo_validado: eligibility.validatedAdvanceTotal,
          },
        },
      });

      return { expediente, alreadyConverted: false, correlationId, validatedAdvanceTotal: eligibility.validatedAdvanceTotal };
    }, { timeout: 20_000 });
  }

  private async resolveTipoActo(tx: Prisma.TransactionClient, requestedId?: string, prospectTypeName?: string | null) {
    if (requestedId) {
      const requested = await tx.tipoActo.findFirst({ where: { id: requestedId, activo: true } });
      if (requested) return requested;
      throw new CotizacionBusinessError('El tipo de acto seleccionado no existe o está inactivo.', 'TIPO_ACTO_INVALID');
    }
    if (prospectTypeName?.trim()) {
      const prospectName = prospectTypeName.trim();
      const exactMatch = await tx.tipoActo.findFirst({
        where: { activo: true, nombre: { equals: prospectName, mode: 'insensitive' } },
        orderBy: { nombre: 'asc' },
      });
      if (exactMatch) return exactMatch;

      const normalizedProspect = this.normalizeActName(prospectName);
      const significantWord = prospectName
        .split(/\s+/)
        .find((word) => {
          const token = this.normalizeActName(word);
          return token.length >= 4 && !['general', 'especificado', 'acto'].includes(token);
        });
      if (significantWord) {
        const candidates = await tx.tipoActo.findMany({
          where: { activo: true, nombre: { contains: significantWord, mode: 'insensitive' } },
          orderBy: { nombre: 'asc' },
          take: 5,
        });
        const compatible = candidates.filter((candidate) => {
          const normalizedCandidate = this.normalizeActName(candidate.nombre);
          return normalizedCandidate.includes(normalizedProspect)
            || normalizedProspect.includes(normalizedCandidate)
            || normalizedCandidate.split(' ')[0] === normalizedProspect.split(' ')[0];
        });
        if (compatible.length === 1) return compatible[0];
        if (compatible.length > 1) {
          throw new CotizacionBusinessError(
            'El tipo de acto del prospecto coincide con más de un catálogo. Selecciona el tipo exacto antes de convertir.',
            'TIPO_ACTO_AMBIGUOUS',
          );
        }
      }
    }
    throw new CotizacionBusinessError(
      'Selecciona un tipo de acto válido antes de convertir la cotización.',
      'TIPO_ACTO_REQUIRED',
    );
  }

  private normalizeActName(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es-MX')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private async collectDocuments(tx: Prisma.TransactionClient, cotizacionId: string, prospectoId?: string | null) {
    const [prospectDocuments, prospectLinks, quoteDocuments, quoteLinks] = await Promise.all([
      prospectoId ? tx.documento.findMany({ where: { prospecto_id: prospectoId }, select: { id: true } }) : [],
      prospectoId ? tx.prospectoDocumento.findMany({ where: { prospecto_id: prospectoId, estatus: 'ACTIVO' }, select: { documento_id: true } }) : [],
      tx.documento.findMany({ where: { cotizacion_id: cotizacionId }, select: { id: true } }),
      tx.cotizacionDocumento.findMany({ where: { cotizacion_id: cotizacionId, estatus: 'ACTIVO' }, select: { documento_id: true } }),
    ]);
    return new Set([
      ...prospectDocuments.map((document) => document.id),
      ...prospectLinks.map((link) => link.documento_id),
      ...quoteDocuments.map((document) => document.id),
      ...quoteLinks.map((link) => link.documento_id),
    ]);
  }
}
