import type { Prisma, PrismaClient } from '@prisma/client';
import { linkOperationSnapshotTx, queueMasterScreeningTx } from './complianceScreening.service';

type Db = PrismaClient | Prisma.TransactionClient;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export type EnsureOperationScreeningInput = {
  organizationId: string;
  expedienteId: string;
  relationId?: string | null;
  comparecienteId?: string | null;
  expedienteActoId?: string | null;
  reviewId?: string | null;
  actorUserId: string;
  correlationId?: string | null;
  triggerEventId?: string | null;
};

export async function ensureOperationScreeningForPartyTx(db: Db, input: EnsureOperationScreeningInput) {
  const relation = input.relationId
    ? await db.expedienteCompareciente.findFirst({ where: {
        id: input.relationId, organization_id: input.organizationId, expediente_id: input.expedienteId,
        estatus: 'ACTIVO', archived_at: null,
      }, select: { id: true, compareciente_id: true, expediente_acto_id: true } })
    : await db.expedienteCompareciente.findFirst({ where: {
        organization_id: input.organizationId, expediente_id: input.expedienteId,
        compareciente_id: input.comparecienteId || undefined,
        ...(input.expedienteActoId ? { OR: [{ expediente_acto_id: input.expedienteActoId }, { expediente_acto_id: null }] } : {}),
        estatus: 'ACTIVO', archived_at: null,
      }, select: { id: true, compareciente_id: true, expediente_acto_id: true } });
  const expedienteActoId = relation?.expediente_acto_id || input.expedienteActoId || null;
  if (!relation?.compareciente_id || !expedienteActoId) return { eligible: false as const, reason: 'ACTIVE_RELATION_NOT_FOUND' as const };

  await db.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    `h3:operation:${input.organizationId}:${input.expedienteId}:${expedienteActoId}:${relation.compareciente_id}`,
  );
  const state = await db.expedienteComplianceState.findFirst({ where: {
    organization_id: input.organizationId, expediente_id: input.expedienteId,
    ...(input.reviewId ? { current_review_id: input.reviewId } : { current_review_id: { not: null } }),
  }, select: { id: true, current_review_id: true } });
  const reviewId = input.reviewId || state?.current_review_id;
  if (!state || !reviewId || state.current_review_id !== reviewId) return { eligible: false as const, reason: 'CURRENT_REVIEW_NOT_FOUND' as const };

  const vulnerable = await db.complianceRuleResult.findFirst({ where: {
    organization_id: input.organizationId, review_id: reviewId,
    expediente_acto_id: expedienteActoId, vulnerable_activity: true,
  }, select: { id: true } });
  if (!vulnerable) return { eligible: false as const, reason: 'NON_VULNERABLE_OPERATION' as const };

  const requirementKey = `LST:${expedienteActoId}:${relation.compareciente_id}`;
  let requirement = await db.complianceRequirement.findFirst({ where: {
    organization_id: input.organizationId, review_id: reviewId, provider: 'LST', requirement_key: requirementKey,
  } });
  let requirementCreated = false;
  if (!requirement) {
    requirement = await db.complianceRequirement.create({ data: {
      organization_id: input.organizationId, expediente_id: input.expedienteId, state_id: state.id, review_id: reviewId,
      provider: 'LST', requirement_key: requirementKey, label: 'Consulta nominal del compareciente', status: 'PENDIENTE',
      blocks_completion: true, source_snapshot: json({ trigger: 'VULNERABLE_OPERATION', expediente_acto_id: expedienteActoId, consequence: null }),
      target_compareciente_id: relation.compareciente_id, requires_human_validation: true,
      missing_action: 'GO_TO_COMPARECIENTE', action_target: json({ compareciente_id: relation.compareciente_id, section: 'screening' }),
    } });
    requirementCreated = true;
  }

  const triggerKey = `operation:${reviewId}:${expedienteActoId}:${relation.compareciente_id}`;
  const queued = await queueMasterScreeningTx(db, {
    organizationId: input.organizationId, comparecienteId: relation.compareciente_id, requestedById: input.actorUserId,
    triggerReason: 'VULNERABLE_OPERATION', triggerKey, triggerEventId: input.triggerEventId || null,
    correlationId: input.correlationId, reviewId,
  });
  const snapshot = await linkOperationSnapshotTx(db, {
    organizationId: input.organizationId, requirementId: requirement.id, queryId: queued.query.id, capturedById: input.actorUserId,
  });
  await db.complianceRequirement.update({ where: { id: requirement.id }, data: { source_snapshot: json({
    trigger: 'VULNERABLE_OPERATION', expediente_acto_id: expedienteActoId,
    query_id: queued.query.id, execution_state: queued.query.execution_state, consequence: null,
  }) } });
  return { eligible: true as const, requirement, requirementCreated, query: queued.query, queryIdempotent: queued.idempotent, snapshot };
}
