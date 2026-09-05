import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import prisma from '../config/prisma';
import { ComplianceError } from '../domain/compliance';
import { deriveH7Closure, H7_EXCEPTION_PERMISSION, H7_EXCEPTION_RESOLUTION } from '../domain/complianceH7';
import { complianceHumanLabels } from '../domain/complianceLegalEngine';
import { expedienteAccessWhere } from '../middleware/auth.middleware';

type User = NonNullable<Request['user']>;
type Db = PrismaClient | Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function requirePermission(user: User, permission: typeof H7_EXCEPTION_PERMISSION) {
  if (!user.permissions.includes(permission)) throw new ComplianceError('No tienes autorización para resolver excepciones de cumplimiento.', 'H7_EXCEPTION_PERMISSION_DENIED', 403);
}
export async function recordComplianceActivityTx(db: Db, input: {
  organizationId: string;
  expedienteId: string;
  actorUserId: string;
  action: string;
  entity: string;
  entityId: string;
  title: string;
  description: string;
  idempotencyKey: string;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const result = await db.expedienteActividad.createMany({ data: [{
    organization_id: input.organizationId,
    expediente_id: input.expedienteId,
    usuario_id: input.actorUserId,
    tipo: 'AUDITORIA',
    categoria: 'SISTEMA',
    titulo: input.title,
    descripcion: input.description,
    metadatos: json({ source: 'H7-CUM-CIE', action: input.action, ...(input.metadata || {}) }),
    seccion_relacionada: 'cumplimiento',
    entidad_relacionada: input.entity,
    entidad_relacionada_id: input.entityId,
    correlation_id: input.correlationId || null,
    idempotency_key: input.idempotencyKey.slice(0, 160),
  }], skipDuplicates: true });
  return result.count === 1;
}

export class ComplianceH7Service {
  static async recomputeStateTx(tx: Db, user: Pick<User, 'id' | 'organizationId'>, stateId: string) {
    const state = await tx.expedienteComplianceState.findFirst({ where: { id: stateId, organization_id: user.organizationId } });
    if (!state) throw new ComplianceError('El estado de cumplimiento no está disponible.', 'H7_STATE_NOT_FOUND', 404);
    const requirements = state.current_review_id ? await tx.complianceRequirement.findMany({
      where: { organization_id: user.organizationId, state_id: state.id, review_id: state.current_review_id },
      select: { id: true, provider: true, status: true, deadline: true, blocks_completion: true, missing_action: true },
    }) : [];
    const derived = deriveH7Closure(requirements);
    return tx.expedienteComplianceState.update({ where: { id: state.id }, data: {
      state: derived.state as any,
      pending_count: derived.pendingCount,
      next_deadline: derived.nextDeadline,
      updated_by_id: user.id,
    } });
  }

  static async readWorkspace(user: User, expedienteId: string) {
    const expediente = await prisma.expediente.findFirst({
      where: { id: expedienteId, organization_id: user.organizationId, archived_at: null, ...expedienteAccessWhere(user) },
      select: { id: true, estatus: true },
    });
    if (!expediente) throw new ComplianceError('Expediente no encontrado.', 'H7_CASE_NOT_FOUND', 404);
    const state = await prisma.expedienteComplianceState.findFirst({ where: { organization_id: user.organizationId, expediente_id: expediente.id } });
    if (!state?.current_review_id) return {
      state: null, state_label: 'Sin evaluación', pending_count: 0, actionable_missing_count: 0,
      requirements: [], providers: [], operational_status: expediente.estatus,
    };
    const requirements = await prisma.complianceRequirement.findMany({
      where: { organization_id: user.organizationId, expediente_id: expediente.id, state_id: state.id, review_id: state.current_review_id },
      include: { exceptions: { where: { superseded_at: null }, orderBy: { created_at: 'desc' }, take: 1 } },
      orderBy: [{ provider: 'asc' }, { created_at: 'asc' }],
    });
    const derived = deriveH7Closure(requirements);
    const serialized = requirements.map((item) => ({
      id: item.id, provider: item.provider, key: item.requirement_key, label: item.label, status: item.status,
      deadline: item.deadline, blocks_completion: item.blocks_completion, missing_action: item.missing_action,
      action_target: item.action_target, resolution: item.exceptions[0] ? {
        type: item.exceptions[0].resolution,
        label: 'No aplica por excepción autorizada',
        reason: item.exceptions[0].reason,
        authorized_at: item.exceptions[0].created_at,
      } : null,
    }));
    return {
      state: derived.state,
      state_label: complianceHumanLabels[derived.state] || derived.state,
      pending_count: derived.pendingCount,
      actionable_missing_count: derived.actionableCount,
      requirements: serialized,
      providers: [...new Set(requirements.map((item) => item.provider))],
      operational_status: expediente.estatus,
    };
  }

  static async authorizeException(user: User, expedienteId: string, requirementId: string, body: any, correlationId?: string) {
    requirePermission(user, H7_EXCEPTION_PERMISSION);
    const reason = String(body.reason || '').trim();
    if (reason.length < 10) throw new ComplianceError('Documenta un motivo de al menos 10 caracteres.', 'H7_EXCEPTION_REASON_REQUIRED', 400);
    const idempotencyKey = String(body.idempotency_key || '').trim().slice(0, 160);
    if (idempotencyKey.length < 8) throw new ComplianceError('La excepción requiere una clave de idempotencia.', 'H7_EXCEPTION_IDEMPOTENCY_REQUIRED', 400);
    const payloadHash = sha({ resolution: H7_EXCEPTION_RESOLUTION, reason });
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h7:exception:${user.organizationId}:${requirementId}`}))`);
      const expediente = await tx.expediente.findFirst({ where: { id: expedienteId, organization_id: user.organizationId, archived_at: null, ...expedienteAccessWhere(user) }, select: { id: true } });
      if (!expediente) throw new ComplianceError('No tienes acceso a este expediente.', 'H7_CASE_ACCESS_DENIED', 403);
      const requirement = await tx.complianceRequirement.findFirst({ where: {
        id: requirementId, organization_id: user.organizationId, expediente_id: expediente.id,
        state: { current_review_id: { not: null } },
      } });
      if (!requirement) throw new ComplianceError('El requisito actual no está disponible.', 'H7_REQUIREMENT_NOT_FOUND', 404);
      const currentState = await tx.expedienteComplianceState.findFirst({ where: { id: requirement.state_id, organization_id: user.organizationId, current_review_id: requirement.review_id } });
      if (!currentState) throw new ComplianceError('El requisito ya no pertenece a la evaluación vigente.', 'H7_REQUIREMENT_STALE', 409);
      const repeated = await tx.complianceRequirementException.findFirst({ where: { organization_id: user.organizationId, requirement_id: requirement.id, idempotency_key: idempotencyKey } });
      if (repeated) {
        if (repeated.payload_hash !== payloadHash) throw new ComplianceError('La clave de idempotencia corresponde a otra resolución.', 'H7_EXCEPTION_IDEMPOTENCY_CONFLICT', 409);
        return { exception: repeated, idempotent: true, state: currentState };
      }
      const prior = await tx.complianceRequirementException.findFirst({ where: { organization_id: user.organizationId, requirement_id: requirement.id, superseded_at: null }, orderBy: { created_at: 'desc' } });
      const now = new Date();
      if (prior) await tx.complianceRequirementException.update({ where: { id: prior.id }, data: { superseded_at: now } });
      const created = await tx.complianceRequirementException.create({ data: {
        organization_id: user.organizationId, expediente_id: expediente.id, review_id: requirement.review_id,
        requirement_id: requirement.id, resolution: H7_EXCEPTION_RESOLUTION, reason,
        authorization_permission: H7_EXCEPTION_PERMISSION, authorized_by_id: user.id,
        idempotency_key: idempotencyKey, payload_hash: payloadHash, supersedes_id: prior?.id || null,
      } });
      await tx.complianceRequirement.update({ where: { id: requirement.id }, data: { status: 'NO_APLICA' } });
      const updatedState = await this.recomputeStateTx(tx, user, currentState.id);
      await tx.auditLog.create({ data: {
        organization_id: user.organizationId, user_id: user.id, accion: 'H7_AUTHORIZE_REQUIREMENT_EXCEPTION',
        entidad: 'ComplianceRequirementException', entidad_id: created.id,
        detalles: json({ expediente_id: expediente.id, review_id: requirement.review_id, requirement_id: requirement.id, resolution: H7_EXCEPTION_RESOLUTION, supersedes_id: prior?.id || null }),
        correlation_id: correlationId, session_id: user.sessionId,
      } });
      await recordComplianceActivityTx(tx, {
        organizationId: user.organizationId, expedienteId: expediente.id, actorUserId: user.id,
        action: 'AUTHORIZED_REQUIREMENT_EXCEPTION', entity: 'ComplianceRequirementException', entityId: created.id,
        title: 'Excepción de cumplimiento autorizada', description: `${requirement.label}: no aplica por excepción autorizada.`,
        idempotencyKey: `h7:exception:${created.id}`, correlationId,
        metadata: { requirement_id: requirement.id, provider: requirement.provider },
      });
      return { exception: created, idempotent: false, state: updatedState };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
