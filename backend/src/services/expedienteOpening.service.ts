import { DocCategoria, Prisma, PrismaClient, Role } from '@prisma/client';
import { reserveExpedienteFolio } from './expedienteFolio.service';

export class ExpedienteOpeningError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}

export type OpenExpedienteInput = {
  tipoActoId: string;
  abogadoId: string;
  actorUserId: string;
  clienteAlias: string;
  notariaId?: string | null;
  comparecienteId?: string | null;
  caracterId?: string | null;
  descripcion?: string | null;
  valorOperacion?: number | null;
  datosOperacion?: Prisma.InputJsonValue;
  cotizacionId?: string | null;
  proximaAccion?: string | null;
  correlationId?: string;
  source?: 'DIRECTO' | 'COTIZACION';
};

const ALLOWED_RESPONSIBLE_ROLES = new Set<Role>(['DIRECCION', 'ADMINISTRACION', 'ABOGADO']);

export class ExpedienteOpeningService {
  constructor(private readonly prisma: PrismaClient) {}

  async open(input: OpenExpedienteInput) {
    return this.prisma.$transaction((tx) => this.openInTransaction(tx, input), { timeout: 20_000 });
  }

  async openInTransaction(tx: Prisma.TransactionClient, input: OpenExpedienteInput) {
    const alias = input.clienteAlias?.trim();
    if (!input.tipoActoId || !input.abogadoId || !input.actorUserId || !alias) {
      throw new ExpedienteOpeningError('Completa el tipo de acto, cliente y responsable.', 'EXPEDIENTE_OPEN_REQUIRED');
    }
    const [tipoActo, actor, lawyer, notary, formVersion, workflowVersion, documentTemplateVersion, selectedParty] = await Promise.all([
      tx.tipoActo.findFirst({ where: { id: input.tipoActoId, activo: true, archived_at: null }, include: { tipoActoCaracteresCompareciente: { include: { caracter: true }, orderBy: [{ sugerido: 'desc' }, { orden: 'asc' }] } } }),
      tx.user.findFirst({ where: { id: input.actorUserId, activo: true }, select: { id: true } }),
      tx.user.findFirst({ where: { id: input.abogadoId, activo: true }, select: { id: true, rol: true } }),
      input.notariaId ? tx.notaria.findFirst({ where: { id: input.notariaId, activa: true, archived_at: null }, select: { id: true } }) : Promise.resolve(null),
      tx.formularioVersion.findFirst({ where: { tipo_acto_id: input.tipoActoId }, orderBy: { version: 'desc' } }),
      tx.flujoVersion.findFirst({ where: { tipo_acto_id: input.tipoActoId }, orderBy: { version: 'desc' } }),
      tx.plantillaDocumentalVersion.findFirst({ where: { tipo_acto_id: input.tipoActoId, activa: true, OR: [{ notaria_id: input.notariaId || null }, { notaria_id: null }] }, orderBy: [{ notaria_id: 'desc' }, { version: 'desc' }] }),
      input.comparecienteId ? tx.compareciente.findFirst({ where: { id: input.comparecienteId, estatus: 'ACTIVO', archived_at: null }, select: { id: true } }) : Promise.resolve(null),
    ]);
    if (!tipoActo) throw new ExpedienteOpeningError('El tipo de acto ya no está disponible.', 'EXPEDIENTE_ACT_TYPE_INVALID', 404);
    if (!actor) throw new ExpedienteOpeningError('Tu sesión ya no está activa.', 'EXPEDIENTE_ACTOR_INVALID', 403);
    if (!lawyer || !ALLOWED_RESPONSIBLE_ROLES.has(lawyer.rol)) throw new ExpedienteOpeningError('Selecciona un responsable autorizado y activo.', 'EXPEDIENTE_RESPONSIBLE_INVALID');
    if (input.notariaId && !notary) throw new ExpedienteOpeningError('La notaría seleccionada ya no está disponible.', 'EXPEDIENTE_NOTARY_INVALID');
    if (input.comparecienteId && !selectedParty) throw new ExpedienteOpeningError('El cliente seleccionado ya no está disponible.', 'EXPEDIENTE_PARTY_INVALID');

    const characterId = input.comparecienteId
      ? input.caracterId || tipoActo.tipoActoCaracteresCompareciente[0]?.caracter_id
      : null;
    if (input.comparecienteId && !characterId) {
      throw new ExpedienteOpeningError('Este tipo de acto aún no tiene un carácter de compareciente configurado.', 'EXPEDIENTE_PARTY_CHARACTER_MISSING', 409);
    }
    if (characterId && !tipoActo.tipoActoCaracteresCompareciente.some((item) => item.caracter_id === characterId)) {
      throw new ExpedienteOpeningError('El carácter seleccionado no corresponde al tipo de acto.', 'EXPEDIENTE_PARTY_CHARACTER_INVALID');
    }

    const numeroPravia = await reserveExpedienteFolio(tx);
    let expediente = await tx.expediente.create({ data: {
      numero_pravia: numeroPravia,
      tipo_acto_id: tipoActo.id,
      abogado_id: lawyer.id,
      creador_id: actor.id,
      cotizacion_id: input.cotizacionId || null,
      notaria_id: input.notariaId || null,
      cliente_alias: alias,
      descripcion: input.descripcion?.trim() || null,
      valor_operacion: input.valorOperacion ?? null,
      datos_operacion: input.datosOperacion,
      formulario_version_id: formVersion?.id,
      flujo_version_id: workflowVersion?.id,
      plantilla_doc_version_id: documentTemplateVersion?.id,
      estatus: 'ABIERTO',
      proxima_accion: input.proximaAccion || 'Integrar documentación y comparecientes',
    } });

    const frozenStages = Array.isArray(workflowVersion?.etapas_json) ? workflowVersion.etapas_json as Array<Record<string, unknown>> : [];
    const firstStage = [...frozenStages].sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0))[0];
    if (firstStage) {
      const stage = await tx.expedienteEtapa.create({ data: {
        expediente_id: expediente.id,
        flujo_version_id: workflowVersion!.id,
        clave_snapshot: String(firstStage.clave || 'APERTURA'),
        nombre_snapshot: String(firstStage.nombre || 'Apertura de expediente'),
        orden_snapshot: Number(firstStage.orden || 1),
        duracion_esperada_snapshot: Number(firstStage.duracion ?? firstStage.duracion_esperada_dias ?? 0) || null,
        responsable_id: lawyer.id,
      } });
      expediente = await tx.expediente.update({ where: { id: expediente.id }, data: { expediente_etapa_actual_id: stage.id, etapa_actual_nombre: stage.nombre_snapshot } });
    }

    const requirements = Array.isArray(documentTemplateVersion?.requisitos_json) ? documentTemplateVersion.requisitos_json as Array<Record<string, unknown>> : [];
    if (requirements.length) {
      await tx.expedienteRequisitoDoc.createMany({ data: requirements.map((requirement) => ({
        expediente_id: expediente.id,
        nombre: String(requirement.nombre || 'Documento requerido'),
        categoria: Object.values(DocCategoria).includes(String(requirement.categoria) as DocCategoria) ? String(requirement.categoria) as DocCategoria : DocCategoria.PROYECTO,
        obligatorio: requirement.obligatorio !== false,
      })) });
    }

    if (input.comparecienteId && characterId) {
      await tx.expedienteCompareciente.create({ data: {
        expediente_id: expediente.id,
        compareciente_id: input.comparecienteId,
        caracter_id: characterId,
        forma_comparecencia: 'PROPIO_DERECHO',
        orden_comparecencia: 1,
        es_principal: true,
        creado_por_id: actor.id,
      } });
    }

    await tx.expedienteActividad.create({ data: {
      expediente_id: expediente.id,
      usuario_id: actor.id,
      tipo: 'CAMBIO_ESTATUS',
      titulo: 'Apertura de expediente',
      descripcion: `Expediente ${numeroPravia} creado${input.source === 'COTIZACION' ? ' desde una cotización aceptada' : ''}.`,
    } });
    if (input.source !== 'COTIZACION') {
      await tx.auditLog.create({ data: {
        user_id: actor.id,
        accion: 'OPEN_EXPEDIENTE',
        entidad: 'Expediente',
        entidad_id: expediente.id,
        valores_nuevos: { numero_pravia: numeroPravia, tipo_acto_id: tipoActo.id, abogado_id: lawyer.id, notaria_id: input.notariaId || null },
        correlation_id: input.correlationId,
      } });
    }
    return expediente;
  }
}
