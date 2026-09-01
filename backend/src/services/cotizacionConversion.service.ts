import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { CotizacionBusinessError, evaluateConversionEligibility } from '../domain/cotizacionWorkflow';
import { ExpedienteOpeningService } from './expedienteOpening.service';
import { attachGeneratedFeeToExpediente } from './honorarioRecognition.service';
import { ExpedienteBudgetService } from './expedienteBudget.service';
import {
  assertQuoteReplay,
  assertQuoteVersion,
  failQuote,
  quoteActionResult,
  quoteEffectiveAt,
  quoteHash,
  quoteKey,
} from '../domain/cotizacionContract';
import { recordQuoteTransitionInTransaction } from './cotizacionWorkflow.service';

type Actor = NonNullable<Request['user']>;

export interface ConvertCotizacionInput {
  cotizacionId: string;
  actorUserId?: string;
  actorOrganizationId: string;
  actorSessionId?: string;
  actor?: Actor;
  abogadoId?: string;
  tipoActoId?: string;
  correlationId?: string;
  expectedVersion?: unknown;
  idempotencyKey?: unknown;
  confirm?: unknown;
  effectiveAt?: unknown;
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
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cot001:${input.actorOrganizationId}:${input.cotizacionId}`}))`);

      const cotizacion = await tx.cotizacion.findFirst({
        where: { id: input.cotizacionId, organization_id: input.actorOrganizationId },
        include: {
          prospecto: true,
          expediente: true,
          versiones: { orderBy: { version: 'desc' } },
          pagos: true,
          transicion_actual: true,
        },
      });

      if (!cotizacion) {
        throw new CotizacionBusinessError('Cotización no encontrada.', 'COTIZACION_NOT_FOUND', 404);
      }

      const canonical = Boolean(cotizacion.etapa_contractual);
      const key = canonical ? quoteKey(input.idempotencyKey) : null;
      const hash = canonical ? quoteHash({
        cotizacionId: input.cotizacionId,
        tipoActoId: input.tipoActoId ?? null,
        abogadoId: input.abogadoId ?? null,
        expectedVersion: input.expectedVersion,
        effectiveAt: input.effectiveAt,
        actor: input.actorUserId,
      }) : null;
      const replay = canonical && key
        ? await tx.cotizacionTransicion.findFirst({ where: {
          organization_id: input.actorOrganizationId,
          cotizacion_id: input.cotizacionId,
          idempotency_key: key,
        } })
        : null;
      if (replay) {
        assertQuoteReplay(replay, hash!, input.actorUserId || '');
        if (!cotizacion.expediente) {
          failQuote(409, 'COT001_REPLAY_INCOMPLETE', 'La conversión anterior requiere revisión antes de volver a intentarla.');
        }
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
      if (!approvedVersion) throw new CotizacionBusinessError('La cotización no tiene una versión estructurada aprobada.', 'APPROVED_VERSION_REQUIRED');

      let workflowEffectiveAt: Date | null = null;
      if (canonical) {
        if (input.confirm !== true) failQuote(400, 'COT001_CONFIRM_REQUIRED', 'Revisa y confirma la conversión antes de continuar.');
        assertQuoteVersion(input.expectedVersion, cotizacion.version_operativa);
        quoteActionResult(cotizacion.etapa_contractual, 'CONVERTIR');
        workflowEffectiveAt = quoteEffectiveAt(
          input.effectiveAt,
          new Date(),
          cotizacion.transicion_actual?.effective_at ?? null,
          true,
        );
      }

      const expediente = await new ExpedienteOpeningService(this.prisma).openInTransaction(tx, {
        tipoActoId: tipoActo.id,
        abogadoId: lawyer.id,
        actorUserId: actor.id,
        clienteAlias: cotizacion.prospecto?.nombre || 'Cliente',
        notariaId: cotizacion.notaria_id,
        cotizacionId: cotizacion.id,
        proximaAccion: 'Integrar documentación y comparecientes',
        correlationId,
      });
      await new ExpedienteBudgetService(this.prisma).createFromQuoteInTransaction(tx, {
        actor: {
          id: actor.id,
          organizationId: input.actorOrganizationId,
          sessionId: input.actorSessionId || correlationId,
          rol: actor.rol,
          permissions: [],
        },
        expedienteId: expediente.id,
        quoteVersion: approvedVersion,
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
            origen: 'COTIZACION',
            source_entity_type: 'COTIZACION',
            source_entity_id: cotizacion.id,
            source_context: 'CONVERSION_COTIZACION',
            source_key: `COTIZACION:COTIZACION:${cotizacion.id}:${documentId}:CONVERSION_COTIZACION`,
            document_version: `DOCUMENTO:${documentId}`,
            provenance: { origin: 'COTIZACION', conversion: true },
          },
        });
      }

      await tx.pago.updateMany({
        where: { cotizacion_id: cotizacion.id },
        data: { expediente_id: expediente.id },
      });
      await attachGeneratedFeeToExpediente(tx, { cotizacionId: cotizacion.id, expedienteId: expediente.id });

      if (canonical) {
        const workflowActor = input.actor ?? ({
          id: actor.id,
          email: actor.email,
          nombre: actor.nombre,
          apellido: actor.apellido,
          rol: actor.rol,
          sessionId: input.actorSessionId || correlationId,
          organizationId: input.actorOrganizationId,
          membershipId: '',
          scope: 'GLOBAL',
          permissions: [],
          requiresPasswordChange: false,
        } as Actor);
        await recordQuoteTransitionInTransaction(tx, {
          actor: workflowActor,
          quote: cotizacion,
          action: 'CONVERTIR',
          next: quoteActionResult(cotizacion.etapa_contractual, 'CONVERTIR').next,
          changesStage: true,
          effectiveAt: workflowEffectiveAt!,
          recordedAt: new Date(),
          key: key!,
          hash: hash!,
          quoteVersionId: approvedVersion.id,
          evidence: { expedienteId: expediente.id, numeroPravia, source: 'COT-001' },
        });
      } else {
        await tx.cotizacion.update({
          where: { id: cotizacion.id },
          data: { estado: 'CONVERTIDA_EXPEDIENTE', fecha_conversion_expediente: new Date() },
        });
      }
      if (cotizacion.prospecto_id) {
        await tx.prospecto.update({
          where: { id: cotizacion.prospecto_id },
          data: { estado: 'ACEPTADO' },
        });
      }

      await tx.expedienteActividad.create({
        data: {
          organization_id: input.actorOrganizationId,
          expediente_id: expediente.id,
          usuario_id: actor.id,
          tipo: 'AUDITORIA',
          titulo: 'Conversión desde cotización aceptada',
          descripcion: canonical
            ? `Expediente ${numeroPravia} creado después del hito comercial Aceptó / Anticipo. Se vincularon ${documentLinks.size} documento(s) sin duplicar archivos.`
            : `Expediente ${numeroPravia} creado con anticipo validado por ${eligibility.validatedAdvanceTotal.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}. Se vincularon ${documentLinks.size} documento(s) sin duplicar archivos.`,
          metadatos: {
            cotizacion_id: cotizacion.id,
            anticipo_validado: eligibility.validatedAdvanceTotal,
            correlation_id: correlationId,
          },
        },
      });
      if (!canonical) await tx.auditLog.create({
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
