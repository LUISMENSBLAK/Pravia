import { createHash, randomUUID } from 'crypto';
import { Prisma, PrismaClient, type ExpedienteActoOrigen } from '@prisma/client';
import type { Request } from 'express';
import { expedienteAccessWhere } from '../middleware/auth.middleware';

type Actor = NonNullable<Request['user']>;
type Db = PrismaClient | Prisma.TransactionClient;

export type ExpedienteActoOperation = 'ADD' | 'CHANGE' | 'REMOVE';
export type ExpedienteActoCommand = {
  operation: ExpedienteActoOperation;
  tipo_acto_id?: string;
  expediente_acto_id?: string;
  idempotency_key?: string;
  preview_fingerprint?: string;
  confirm_protected_work?: boolean;
  reason?: string;
};

export class ExpedienteActoError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const clean = (value: unknown, max = 240) => String(value || '').trim().slice(0, max);
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const activeActInclude = { tipo_acto: { select: { id: true, nombre: true, descripcion: true } } } as const;

type ActSlot = { id: string; tipo_acto_id: string };
type ImpactItem = { key: string; id: string; name: string; source: 'CFG-001' | 'CFG-002' };

export class ExpedienteActosService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(actor: Actor, expedienteId: string) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const data = await this.prisma.expedienteActo.findMany({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId },
      include: activeActInclude,
      orderBy: [{ estatus: 'asc' }, { created_at: 'asc' }],
    });
    return { data, canonical_source: 'ExpedienteActo', legacy_tipo_acto_id_editable: false };
  }

  async preview(actor: Actor, expedienteId: string, command: ExpedienteActoCommand) {
    return this.buildPreview(this.prisma, actor, expedienteId, command);
  }

  async apply(actor: Actor, expedienteId: string, command: ExpedienteActoCommand) {
    const idempotencyKey = clean(command.idempotency_key, 160);
    if (!idempotencyKey) throw new ExpedienteActoError(400, 'EXPEDIENTE_ACT_IDEMPOTENCY_REQUIRED', 'La operación requiere una clave de idempotencia.');
    if (!clean(command.preview_fingerprint, 128)) throw new ExpedienteActoError(400, 'EXPEDIENTE_ACT_PREVIEW_REQUIRED', 'Primero revisa el impacto de este cambio.');

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:expediente-actos:${expedienteId}`}))`);
      await this.assertExpediente(tx, actor, expedienteId);

      const prior = await tx.expedienteActo.findFirst({
        where: { organization_id: actor.organizationId, expediente_id: expedienteId, OR: [{ idempotency_key: idempotencyKey }, { removal_idempotency_key: idempotencyKey }] },
        include: activeActInclude,
      });
      if (prior) return { acto: prior, idempotent: true };

      const preview = await this.buildPreview(tx, actor, expedienteId, command);
      if (preview.fingerprint !== command.preview_fingerprint) {
        throw new ExpedienteActoError(409, 'EXPEDIENTE_ACT_PREVIEW_STALE', 'El expediente o su configuración cambió. Revisa nuevamente el impacto.');
      }
      if (preview.classification === 'BLOCKED') {
        throw new ExpedienteActoError(409, 'EXPEDIENTE_ACT_CHANGE_BLOCKED', 'El acto no puede cambiarse porque existe trabajo jurídico protegido.');
      }
      if (preview.classification === 'REVIEW_REQUIRED' && command.confirm_protected_work !== true) {
        throw new ExpedienteActoError(409, 'EXPEDIENTE_ACT_CONFIRMATION_REQUIRED', 'Confirma expresamente el impacto sobre el trabajo existente.');
      }

      const now = new Date();
      const correlationId = randomUUID();
      let result: any;
      let before: any = null;
      if (command.operation === 'ADD') {
        result = await tx.expedienteActo.create({ data: {
          organization_id: actor.organizationId,
          expediente_id: expedienteId,
          tipo_acto_id: preview.target_tipo_acto!.id,
          origen: 'ADICIONAL',
          created_by: actor.id,
          idempotency_key: idempotencyKey,
        }, include: activeActInclude });
      } else {
        const current = await tx.expedienteActo.findFirst({
          where: { id: command.expediente_acto_id, organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', removed_at: null },
          include: activeActInclude,
        });
        if (!current) throw new ExpedienteActoError(404, 'EXPEDIENTE_ACT_NOT_FOUND', 'El acto ya no está activo en este expediente.');
        before = current;
        const reason = clean(command.reason, 500);
        if (!reason) throw new ExpedienteActoError(400, 'EXPEDIENTE_ACT_REASON_REQUIRED', 'Indica el motivo del cambio o desvinculación.');
        await tx.expedienteActo.update({ where: { id: current.id }, data: {
          estatus: 'RETIRADO', removed_at: now, removed_by: actor.id, removed_reason: reason,
          removal_idempotency_key: command.operation === 'REMOVE' ? idempotencyKey : undefined,
        } });
        result = command.operation === 'CHANGE'
          ? await tx.expedienteActo.create({ data: {
              organization_id: actor.organizationId,
              expediente_id: expedienteId,
              tipo_acto_id: preview.target_tipo_acto!.id,
              origen: 'ADICIONAL',
              created_by: actor.id,
              idempotency_key: idempotencyKey,
            }, include: activeActInclude })
          : { ...current, estatus: 'RETIRADO', removed_at: now, removed_by: actor.id, removed_reason: reason };
      }

      const updated = await tx.expediente.update({ where: { id: expedienteId }, data: { version: { increment: 1 } }, select: { version: true } });
      const action = command.operation === 'ADD' ? 'ADD_EXPEDIENTE_ACT' : command.operation === 'CHANGE' ? 'CHANGE_EXPEDIENTE_ACT' : 'UNLINK_EXPEDIENTE_ACT';
      const summary = {
        operation: command.operation,
        expediente_acto_id: result.id,
        tipo_acto_id: result.tipo_acto_id,
        previous_expediente_acto_id: before?.id || null,
        classification: preview.classification,
        impact: preview.impact,
        version: updated.version,
      };
      await tx.expedienteActividad.create({ data: {
        organization_id: actor.organizationId, expediente_id: expedienteId, usuario_id: actor.id, tipo: 'AUDITORIA',
        titulo: command.operation === 'ADD' ? 'Acto agregado al expediente' : command.operation === 'CHANGE' ? 'Acto del expediente cambiado' : 'Acto desvinculado del expediente',
        descripcion: command.operation === 'REMOVE' ? before.tipo_acto.nombre : result.tipo_acto.nombre,
        metadatos: json(summary),
      } });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, accion: action, entidad: 'ExpedienteActo', entidad_id: result.id,
        valores_anteriores: before ? json(before) : undefined, valores_nuevos: json(summary), correlation_id: correlationId,
        session_id: actor.sessionId,
      } });
      await tx.domainEventOutbox.create({ data: {
        organization_id: actor.organizationId, event_type: `ExpedienteActo${command.operation === 'ADD' ? 'Agregado' : command.operation === 'CHANGE' ? 'Cambiado' : 'Desvinculado'}`,
        aggregate_type: 'Expediente', aggregate_id: expedienteId, actor_user_id: actor.id, correlation_id: correlationId, payload: json(summary),
      } });
      return { acto: result, idempotent: false, version: updated.version };
    }, { timeout: 20_000 });
  }

  async createInitial(tx: Prisma.TransactionClient, input: {
    organizationId: string; expedienteId: string; tipoActoId: string; cotizacionId: string; actorUserId: string;
  }) {
    return tx.expedienteActo.create({ data: {
      organization_id: input.organizationId,
      expediente_id: input.expedienteId,
      tipo_acto_id: input.tipoActoId,
      origen: 'COTIZACION' as ExpedienteActoOrigen,
      source_cotizacion_id: input.cotizacionId,
      idempotency_key: `QUOTE:${input.cotizacionId}`,
      created_by: input.actorUserId,
    } });
  }

  private async assertExpediente(db: Db, actor: Actor, expedienteId: string) {
    const record = await db.expediente.findFirst({
      where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor) },
      select: { id: true },
    });
    if (!record) throw new ExpedienteActoError(403, 'EXPEDIENTE_ACCESS_DENIED', 'No tienes acceso a este expediente.');
    return record;
  }

  private async buildPreview(db: Db, actor: Actor, expedienteId: string, command: ExpedienteActoCommand) {
    if (!['ADD', 'CHANGE', 'REMOVE'].includes(command.operation)) throw new ExpedienteActoError(400, 'EXPEDIENTE_ACT_OPERATION_INVALID', 'Selecciona una operación de acto válida.');
    await this.assertExpediente(db, actor, expedienteId);
    const expediente = await db.expediente.findFirst({
      where: { id: expedienteId, organization_id: actor.organizationId },
      select: {
        id: true, estatus: true, version: true, updated_at: true,
        actos: { where: { estatus: 'ACTIVO', removed_at: null }, orderBy: { created_at: 'asc' }, select: { id: true, tipo_acto_id: true, updated_at: true } },
        _count: { select: { etapas: true, tareas: true, expedienteDocumentos: true, requisitos_docs: true } },
      },
    });
    if (!expediente) throw new ExpedienteActoError(404, 'EXPEDIENTE_NOT_FOUND', 'Expediente no encontrado.');
    const currentSlots: ActSlot[] = expediente.actos.map((act) => ({ id: act.id, tipo_acto_id: act.tipo_acto_id }));
    const targetCurrent = command.expediente_acto_id
      ? currentSlots.find((act) => act.id === command.expediente_acto_id)
      : undefined;
    if (command.operation !== 'ADD' && !targetCurrent) throw new ExpedienteActoError(404, 'EXPEDIENTE_ACT_NOT_FOUND', 'El acto ya no está activo en este expediente.');

    let targetAct: { id: string; nombre: string } | null = null;
    if (command.operation !== 'REMOVE') {
      const targetId = clean(command.tipo_acto_id, 64);
      if (!targetId) throw new ExpedienteActoError(400, 'EXPEDIENTE_ACT_TYPE_REQUIRED', 'Selecciona el tipo de acto.');
      targetAct = await db.tipoActo.findFirst({
        where: { id: targetId, activo: true, archived_at: null, OR: [{ organization_id: null }, { organization_id: actor.organizationId }] },
        select: { id: true, nombre: true },
      });
      if (!targetAct) throw new ExpedienteActoError(404, 'EXPEDIENTE_ACT_TYPE_INVALID', 'El tipo de acto no está disponible para esta organización.');
    }

    const proposedId = `proposed:${command.operation}:${targetAct?.id || ''}`;
    const projectedSlots = command.operation === 'ADD'
      ? [...currentSlots, { id: proposedId, tipo_acto_id: targetAct!.id }]
      : command.operation === 'CHANGE'
        ? currentSlots.map((slot) => slot.id === targetCurrent!.id ? { id: proposedId, tipo_acto_id: targetAct!.id } : slot)
        : currentSlots.filter((slot) => slot.id !== targetCurrent!.id);

    const [currentImpact, projectedImpact] = await Promise.all([
      this.resolveConfiguredImpact(db, actor.organizationId, currentSlots),
      this.resolveConfiguredImpact(db, actor.organizationId, projectedSlots),
    ]);
    const currentMap = new Map(currentImpact.map((item) => [item.key, item]));
    const projectedMap = new Map(projectedImpact.map((item) => [item.key, item]));
    const added = [...projectedMap.values()].filter((item) => !currentMap.has(item.key));
    const removed = [...currentMap.values()].filter((item) => !projectedMap.has(item.key));
    const retained = [...projectedMap.values()].filter((item) => currentMap.has(item.key));
    const protectedCount = Object.values(expediente._count).reduce((sum, count) => sum + count, 0);
    const affectsExisting = command.operation !== 'ADD' && protectedCount > 0 && removed.length > 0;
    const immutablePhase = ['FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'ENTREGADO'].includes(expediente.estatus);
    const classification = affectsExisting && immutablePhase ? 'BLOCKED' : affectsExisting ? 'REVIEW_REQUIRED' : 'SAFE';
    const fingerprint = createHash('sha256').update(JSON.stringify({
      expediente_id: expediente.id, version: expediente.version, updated_at: expediente.updated_at.toISOString(),
      acts: expediente.actos.map((act) => [act.id, act.tipo_acto_id, act.updated_at.toISOString()]),
      operation: command.operation, target: command.expediente_acto_id || null, type: targetAct?.id || null,
      impact: {
        current: currentImpact.map((item) => [item.key, item.name]),
        projected: projectedImpact.map((item) => [item.key, item.name]),
      },
    })).digest('hex');
    return {
      fingerprint,
      classification,
      target_tipo_acto: targetAct,
      impact: {
        added,
        removed_or_no_longer_applicable: removed,
        retained,
        protected_work: affectsExisting ? { count: protectedCount, requires_human_confirmation: classification === 'REVIEW_REQUIRED' } : { count: 0, requires_human_confirmation: false },
        sources: { cfg001: true, cfg002: true },
      },
    };
  }

  private async resolveConfiguredImpact(db: Db, organizationId: string, slots: ActSlot[]): Promise<ImpactItem[]> {
    if (!slots.length) return [];
    const typeIds = [...new Set(slots.map((slot) => slot.tipo_acto_id))];
    const [configurations, artifacts] = await Promise.all([
      db.configuracionActo.findMany({
        where: { organization_id: organizationId, tipo_acto_id: { in: typeIds }, activa: true },
        select: { tipo_acto_id: true, etapas: { where: { activa: true }, select: { id: true, nombre: true, actividades: { where: { activa: true }, select: { id: true, nombre: true, dependencias: { select: { depende_actividad_id: true } } } } } } },
      }),
      db.catalogoArtefacto.findMany({
        where: { organization_id: organizationId, activo: true, actos: { some: { tipo_acto_id: { in: typeIds } } } },
        select: { id: true, nombre: true, actos: { where: { tipo_acto_id: { in: typeIds } }, select: { tipo_acto_id: true } }, reglas: { where: { activa: true }, select: { multiplicidad: true } } },
      }),
    ]);
    const configByType = new Map(configurations.map((config) => [config.tipo_acto_id, config]));
    const output: ImpactItem[] = [];
    for (const slot of slots) {
      const config = configByType.get(slot.tipo_acto_id);
      for (const stage of config?.etapas || []) {
        output.push({ key: `cfg001:${slot.id}:stage:${stage.id}`, id: stage.id, name: stage.nombre, source: 'CFG-001' });
        for (const activity of stage.actividades) output.push({ key: `cfg001:${slot.id}:activity:${activity.id}`, id: activity.id, name: activity.nombre, source: 'CFG-001' });
      }
      for (const artifact of artifacts.filter((item) => item.actos.some((act) => act.tipo_acto_id === slot.tipo_acto_id))) {
        const perExpediente = !artifact.reglas.length || artifact.reglas.every((rule) => rule.multiplicidad === 'EXPEDIENTE');
        output.push({ key: `cfg002:${perExpediente ? 'expediente' : slot.id}:artifact:${artifact.id}`, id: artifact.id, name: artifact.nombre, source: 'CFG-002' });
      }
    }
    return [...new Map(output.map((item) => [item.key, item])).values()];
  }
}
