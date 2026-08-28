import crypto, { createHash } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { predioObjectWhere } from './objectAccess.service';
import { PredioError } from './predios.service';

type Actor = NonNullable<Request['user']>;
type Db = PrismaClient | Prisma.TransactionClient;
export type ExpedientePredioOperation = 'LINK' | 'UPDATE' | 'UNLINK';
export type ExpedientePredioCommand = {
  operation: ExpedientePredioOperation;
  relation_id?: string;
  predio_id?: string;
  expediente_acto_ids?: string[];
  reason?: string;
  idempotency_key?: string;
  preview_fingerprint?: string;
  confirm_protected_work?: boolean;
};

const clean = (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max);
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const relationInclude = {
  predio: { select: { id: true, apodo: true, clave_catastral: true, cuenta_predial: true, folio_real: true, ubicacion_texto: true, calle: true, numero_exterior: true, colonia: true, municipio: true, estado: true } },
  actos: { where: { estatus: 'ACTIVO' as const }, include: { expedienteActo: { include: { tipo_acto: { select: { id: true, nombre: true } } } } }, orderBy: { created_at: 'asc' as const } },
} as const;

export class ExpedientePrediosService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(actor: Actor, expedienteId: string) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const data = await this.prisma.expedientePredio.findMany({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO' }, include: relationInclude, orderBy: { created_at: 'asc' },
    });
    return { data, canonical_source: 'Predio+ExpedientePredio+ExpedienteActoPredio' };
  }

  async catalogs(actor: Actor, expedienteId: string) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const acts = await this.prisma.expedienteActo.findMany({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', removed_at: null },
      include: { tipo_acto: { select: { id: true, nombre: true } } }, orderBy: { created_at: 'asc' },
    });
    return { acts };
  }

  async search(actor: Actor, expedienteId: string, search: string) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const q = clean(search, 120);
    const data = await this.prisma.predio.findMany({
      where: {
        organization_id: actor.organizationId, archived_at: null, ...predioObjectWhere(actor),
        expedientes: { none: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO' } },
        ...(q ? { OR: [
          { apodo: { contains: q, mode: 'insensitive' } }, { clave_catastral: { contains: q, mode: 'insensitive' } },
          { cuenta_predial: { contains: q, mode: 'insensitive' } }, { folio_real: { contains: q, mode: 'insensitive' } },
          { ubicacion_texto: { contains: q, mode: 'insensitive' } }, { calle: { contains: q, mode: 'insensitive' } },
        ] } : {}),
      },
      select: { id: true, apodo: true, clave_catastral: true, cuenta_predial: true, folio_real: true, ubicacion_texto: true, calle: true, numero_exterior: true, colonia: true, municipio: true, estado: true },
      take: 25, orderBy: { updated_at: 'desc' },
    });
    return { data };
  }

  async preview(actor: Actor, expedienteId: string, command: ExpedientePredioCommand) {
    return this.buildPreview(this.prisma, actor, expedienteId, command);
  }

  async apply(actor: Actor, expedienteId: string, command: ExpedientePredioCommand) {
    const idempotencyKey = clean(command.idempotency_key, 160);
    if (!idempotencyKey) throw new PredioError(400, 'PREDIO_RELATION_IDEMPOTENCY_REQUIRED', 'La operación requiere una clave de idempotencia.');
    if (!clean(command.preview_fingerprint, 128)) throw new PredioError(400, 'PREDIO_RELATION_PREVIEW_REQUIRED', 'Primero revisa el impacto de este cambio.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:expediente-predios:${expedienteId}`}))`);
      const prior = await tx.expedientePredio.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, idempotency_key: idempotencyKey }, include: relationInclude });
      if (prior) return { relation: prior, idempotent: true };
      const preview = await this.buildPreview(tx, actor, expedienteId, command);
      if (preview.fingerprint !== command.preview_fingerprint) throw new PredioError(409, 'PREDIO_RELATION_PREVIEW_STALE', 'El expediente o sus relaciones cambiaron. Revisa nuevamente el impacto.');
      if (preview.classification === 'BLOCKED') throw new PredioError(409, 'PREDIO_RELATION_CHANGE_BLOCKED', 'La relación no puede retirarse porque existe trabajo jurídico protegido.');
      if (preview.classification === 'REVIEW_REQUIRED' && command.confirm_protected_work !== true) throw new PredioError(409, 'PREDIO_RELATION_CONFIRMATION_REQUIRED', 'Confirma expresamente el impacto sobre el trabajo existente.');

      let relation = preview.current_relation_id ? await tx.expedientePredio.findFirst({ where: { id: preview.current_relation_id, organization_id: actor.organizationId, expediente_id: expedienteId } }) : null;
      if (command.operation === 'LINK') {
        relation = await tx.expedientePredio.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, predio_id: preview.predio_id } });
        if (relation) relation = await tx.expedientePredio.update({ where: { id: relation.id }, data: { estatus: 'ACTIVO', removed_at: null, removed_by: null, removed_reason: null, idempotency_key: idempotencyKey, created_by: actor.id } });
        else relation = await tx.expedientePredio.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, predio_id: preview.predio_id, created_by: actor.id, idempotency_key: idempotencyKey } });
      }
      if (!relation) throw new PredioError(404, 'PREDIO_RELATION_NOT_FOUND', 'La relación ya no está disponible.');

      const now = new Date();
      const targetActIds = command.operation === 'UNLINK' ? [] : preview.target_act_ids;
      const currentLinks = await tx.expedienteActoPredio.findMany({ where: { organization_id: actor.organizationId, expediente_predio_id: relation.id } });
      for (const link of currentLinks) {
        if (!targetActIds.includes(link.expediente_acto_id) && link.estatus === 'ACTIVO') await tx.expedienteActoPredio.update({ where: { id: link.id }, data: { estatus: 'INACTIVO', removed_at: now } });
      }
      for (const actId of targetActIds) {
        const existing = currentLinks.find((item) => item.expediente_acto_id === actId);
        if (existing) {
          if (existing.estatus !== 'ACTIVO') await tx.expedienteActoPredio.update({ where: { id: existing.id }, data: { estatus: 'ACTIVO', removed_at: null } });
        } else await tx.expedienteActoPredio.create({ data: { organization_id: actor.organizationId, expediente_predio_id: relation.id, expediente_acto_id: actId } });
      }
      if (command.operation === 'UNLINK') {
        const reason = clean(command.reason, 500);
        if (!reason) throw new PredioError(400, 'PREDIO_RELATION_REASON_REQUIRED', 'Indica el motivo de la desvinculación.');
        relation = await tx.expedientePredio.update({ where: { id: relation.id }, data: { estatus: 'INACTIVO', removed_at: now, removed_by: actor.id, removed_reason: reason, idempotency_key: idempotencyKey } });
      } else if (command.operation === 'UPDATE') {
        relation = await tx.expedientePredio.update({ where: { id: relation.id }, data: { idempotency_key: idempotencyKey } });
      }
      const version = await tx.expediente.update({ where: { id: expedienteId }, data: { version: { increment: 1 } }, select: { version: true } });
      const action = command.operation === 'LINK' ? 'LINK_PROPERTY_TO_EXPEDIENT' : command.operation === 'UPDATE' ? 'UPDATE_PROPERTY_ACT_LINKS' : 'UNLINK_PROPERTY_FROM_EXPEDIENT';
      const summary = { operation: command.operation, predio_id: relation.predio_id, expediente_predio_id: relation.id, act_ids: targetActIds, impact: preview.impact, version: version.version, master_deleted: false };
      const correlationId = crypto.randomUUID();
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: action, entidad: 'ExpedientePredio', entidad_id: relation.id, valores_nuevos: json(summary), correlation_id: correlationId, session_id: actor.sessionId } });
      await tx.expedienteActividad.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, usuario_id: actor.id, tipo: 'AUDITORIA', titulo: command.operation === 'UNLINK' ? 'Inmueble desvinculado' : 'Relación inmobiliaria actualizada', descripcion: `Predio ${relation.predio_id}`, metadatos: json(summary) } });
      await tx.domainEventOutbox.create({ data: { organization_id: actor.organizationId, event_type: `ExpedientePredio${command.operation === 'LINK' ? 'Vinculado' : command.operation === 'UPDATE' ? 'Actualizado' : 'Desvinculado'}`, aggregate_type: 'Expediente', aggregate_id: expedienteId, actor_user_id: actor.id, correlation_id: correlationId, payload: json(summary) } });
      return { relation: await tx.expedientePredio.findUniqueOrThrow({ where: { id: relation.id }, include: relationInclude }), idempotent: false, version: version.version };
    }, { timeout: 20_000 });
  }

  private async assertExpediente(db: Db, actor: Actor, expedienteId: string) {
    const record = await db.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor) }, select: { id: true } });
    if (!record) throw new PredioError(403, 'EXPEDIENTE_ACCESS_DENIED', 'No tienes acceso a este expediente.');
    return record;
  }

  private async buildPreview(db: Db, actor: Actor, expedienteId: string, command: ExpedientePredioCommand) {
    if (!['LINK', 'UPDATE', 'UNLINK'].includes(command.operation)) throw new PredioError(400, 'PREDIO_RELATION_OPERATION_INVALID', 'Selecciona una operación válida.');
    await this.assertExpediente(db, actor, expedienteId);
    const expediente = await db.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId }, select: {
      id: true, version: true, estatus: true, updated_at: true,
      _count: { select: { expedienteDocumentos: true, requisitos_docs: true } },
      predios: { where: { estatus: 'ACTIVO' }, select: { id: true, predio_id: true, updated_at: true, actos: { where: { estatus: 'ACTIVO' }, select: { expediente_acto_id: true } } } },
    } });
    if (!expediente) throw new PredioError(404, 'EXPEDIENTE_NOT_FOUND', 'Expediente no encontrado.');
    const current = command.relation_id ? expediente.predios.find((item) => item.id === command.relation_id) : undefined;
    if (command.operation !== 'LINK' && !current) throw new PredioError(404, 'PREDIO_RELATION_NOT_FOUND', 'La relación ya no está activa.');
    const predioId = command.operation === 'LINK' ? clean(command.predio_id, 64) : current!.predio_id;
    const predio = await db.predio.findFirst({ where: { id: predioId, organization_id: actor.organizationId, archived_at: null, ...predioObjectWhere(actor) }, select: { id: true } });
    if (!predio) throw new PredioError(403, 'PREDIO_ACCESS_DENIED', 'No tienes acceso al inmueble seleccionado.');
    if (command.operation === 'LINK' && expediente.predios.some((item) => item.predio_id === predioId)) throw new PredioError(409, 'PREDIO_RELATION_DUPLICATE', 'Este inmueble ya está vinculado al expediente.');
    const targetActIds = command.operation === 'UNLINK' ? [] : [...new Set((command.expediente_acto_ids || []).map((id) => clean(id, 64)).filter(Boolean))];
    if (command.operation !== 'UNLINK' && !targetActIds.length) throw new PredioError(400, 'PREDIO_ACT_REQUIRED', 'Selecciona al menos un acto para este inmueble.');
    const acts = targetActIds.length ? await db.expedienteActo.findMany({ where: { id: { in: targetActIds }, organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', removed_at: null }, select: { id: true, tipo_acto_id: true, updated_at: true } }) : [];
    if (acts.length !== targetActIds.length) throw new PredioError(403, 'PREDIO_ACT_ACCESS_DENIED', 'Uno de los actos no pertenece a este expediente.');
    const currentActIds = current?.actos.map((item) => item.expediente_acto_id) || [];
    const currentActs = currentActIds.length ? await db.expedienteActo.findMany({ where: { id: { in: currentActIds }, organization_id: actor.organizationId }, select: { id: true, tipo_acto_id: true } }) : [];
    const [currentImpact, targetImpact] = await Promise.all([this.resolveCfg002(db, actor.organizationId, currentActs, predioId), this.resolveCfg002(db, actor.organizationId, acts, predioId)]);
    const currentMap = new Map(currentImpact.map((item) => [item.key, item]));
    const targetMap = new Map(targetImpact.map((item) => [item.key, item]));
    const removed = [...currentMap.values()].filter((item) => !targetMap.has(item.key));
    const added = [...targetMap.values()].filter((item) => !currentMap.has(item.key));
    const retained = [...targetMap.values()].filter((item) => currentMap.has(item.key));
    const protectedCount = expediente._count.expedienteDocumentos + expediente._count.requisitos_docs;
    const affectsProtected = removed.length > 0 && protectedCount > 0;
    const immutable = ['FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'ENTREGADO'].includes(expediente.estatus);
    const classification = affectsProtected && immutable ? 'BLOCKED' : affectsProtected ? 'REVIEW_REQUIRED' : 'SAFE';
    const fingerprint = createHash('sha256').update(JSON.stringify({
      expediente: [expediente.id, expediente.version, expediente.updated_at.toISOString()], operation: command.operation,
      relation: current ? [current.id, current.predio_id, current.updated_at.toISOString(), currentActIds.sort()] : null,
      predio_id: predioId, target_act_ids: [...targetActIds].sort(), impact: { current: currentImpact.map((item) => item.key).sort(), target: targetImpact.map((item) => item.key).sort() },
    })).digest('hex');
    return { fingerprint, classification, predio_id: predioId, current_relation_id: current?.id || null, target_act_ids: targetActIds, impact: {
      added, removed_or_no_longer_applicable: removed, retained,
      protected_work: affectsProtected ? { count: protectedCount, requires_human_confirmation: classification === 'REVIEW_REQUIRED' } : { count: 0, requires_human_confirmation: false },
      sources: { cfg002: true }, automatic_document_generation: false,
    } };
  }

  private async resolveCfg002(db: Db, organizationId: string, acts: Array<{ id: string; tipo_acto_id: string }>, predioId: string) {
    if (!acts.length) return [];
    const artifacts = await db.catalogoArtefacto.findMany({
      where: { organization_id: organizationId, activo: true, actos: { some: { tipo_acto_id: { in: acts.map((item) => item.tipo_acto_id) } } }, reglas: { some: { activa: true, multiplicidad: 'INMUEBLE' } } },
      select: { id: true, nombre: true, actos: { select: { tipo_acto_id: true } } },
    });
    return artifacts.flatMap((artifact) => acts.filter((act) => artifact.actos.some((item) => item.tipo_acto_id === act.tipo_acto_id)).map((act) => ({ key: `cfg002:predio:${predioId}:act:${act.id}:artifact:${artifact.id}`, id: artifact.id, name: artifact.nombre, source: 'CFG-002' as const })));
  }
}
