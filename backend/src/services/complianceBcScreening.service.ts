import type { Prisma } from '@prisma/client';
import { linkOperationSnapshotTx, queueMasterScreeningTx } from './complianceScreening.service';
import type { Request } from 'express';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { ensureOperationScreeningForPartyTx } from './operationScreening.service';
import { comparecienteObjectWhere } from './objectAccess.service';
import { bcResultExecutions, bcLogicalHash } from '../domain/beneficialController';

type Actor = NonNullable<Request['user']>;
type IdentifiedBcInput = {
  actor: Actor;
  organizationId: string;
  expedienteId: string;
  reviewId: string;
  expedienteActoId: string | null;
  targetPersonaMoralId: string;
  evaluationId: string;
  resultId: string;
  comparecienteId: string;
  actorUserId: string;
  correlationId?: string;
};

/** The only H4 screening dispatcher. No party or legal role is manufactured. */
export class ComplianceBcScreeningAdapter {
  static async ensureForIdentifiedBcTx(tx: Prisma.TransactionClient, input: IdentifiedBcInput) {
    const fail = (): never => { throw new Error('H4_BC_SCREENING_LINEAGE_MISMATCH'); };
    if (input.actor.id !== input.actorUserId || input.actor.organizationId !== input.organizationId
      || !input.actor.permissions.includes('compliance.write')) fail();
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `h4:screening:${input.organizationId}:${input.expedienteId}:${input.resultId}`);
    const expediente = await tx.expediente.findFirst({ where: { AND: [
      { id: input.expedienteId, organization_id: input.organizationId, archived_at: null }, expedienteAccessWhere(input.actor),
    ] } });
    const state = await tx.expedienteComplianceState.findFirst({ where: {
      organization_id: input.organizationId, expediente_id: input.expedienteId, current_review_id: input.reviewId,
    } });
    const result = await tx.complianceBcResult.findFirst({ where: {
      id: input.resultId, organization_id: input.organizationId, evaluation_id: input.evaluationId,
      subject_compareciente_id: input.comparecienteId,
    }, include: { evaluation: { include: { snapshot: true } } } });
    if (!result) throw new Error('H4_BC_SCREENING_LINEAGE_MISMATCH');
    const evaluation = result.evaluation;
    if (!expediente || !state || !evaluation || evaluation.status !== 'EVALUATED' || result.determination !== 'IDENTIFIED'
      || evaluation.review_id !== input.reviewId || evaluation.expediente_id !== input.expedienteId
      || evaluation.target_persona_moral_id !== input.targetPersonaMoralId
      || evaluation.expediente_acto_id !== input.expedienteActoId) fail();
    const person = await tx.compareciente.findFirst({ where: { AND: [
      { id: input.comparecienteId, organization_id: input.organizationId, archived_at: null }, comparecienteObjectWhere(input.actor),
    ] } });
    const executions = bcResultExecutions(result, evaluation.result_snapshot);
    if (!person || !executions.length) fail();
    const graph = evaluation.snapshot.graph_snapshot as any;
    for (const execution of executions) {
      const node = graph.nodes?.find((item: any) => item.id === execution.bc_subject_node_id);
      if (!node || bcLogicalHash(node) !== bcLogicalHash(execution.bc_facts!.subject)
        || !await tx.complianceRuleResult.findFirst({ where: {
          id: execution.h1_rule_result_id, organization_id: input.organizationId, review_id: input.reviewId,
          rule_revision_id: execution.ruleRevisionId, expediente_acto_id: input.expedienteActoId,
        } })) fail();
    }
    if (input.expedienteActoId && !await tx.expedienteActo.findFirst({ where: {
      id: input.expedienteActoId, organization_id: input.organizationId, expediente_id: input.expedienteId, estatus: 'ACTIVO', removed_at: null,
    } })) fail();
    const relation = await tx.expedienteCompareciente.findFirst({ where: {
      organization_id: input.organizationId, expediente_id: input.expedienteId, compareciente_id: input.comparecienteId,
      estatus: 'ACTIVO', archived_at: null,
      OR: [{ expediente_acto_id: input.expedienteActoId }, { expediente_acto_id: null }],
    } });
    if (relation) {
      return ensureOperationScreeningForPartyTx(tx, { ...input, relationId: relation.id });
    }
    const key = `H4:${input.evaluationId}:${input.resultId}:${input.expedienteActoId || 'GENERAL'}:${input.comparecienteId}`;
    const source = { contract: 'CUM-BC-001', evaluation_id: input.evaluationId, result_id: input.resultId,
      expediente_acto_id: input.expedienteActoId, target_persona_moral_id: input.targetPersonaMoralId };
    const requirement = await tx.complianceRequirement.upsert({
      where: { organization_id_review_id_provider_requirement_key: {
        organization_id: input.organizationId, review_id: input.reviewId, provider: 'LST', requirement_key: key,
      } },
      create: { organization_id: input.organizationId, expediente_id: input.expedienteId, state_id: state!.id,
        review_id: input.reviewId, provider: 'LST', requirement_key: key, label: 'Consulta nominal del beneficiario controlador',
        status: 'PENDIENTE', target_compareciente_id: input.comparecienteId, blocks_completion: true,
        requires_human_validation: true, source_snapshot: source }, update: {},
    });
    const provenance = requirement.source_snapshot as Record<string, unknown>;
    if (requirement.target_compareciente_id !== input.comparecienteId || requirement.expediente_id !== input.expedienteId
      || requirement.review_id !== input.reviewId || requirement.state_id !== state!.id
      || Object.entries(source).some(([key, value]) => provenance[key] !== value)) fail();
    const queued = await queueMasterScreeningTx(tx, { organizationId: input.organizationId,
      comparecienteId: input.comparecienteId, requestedById: input.actorUserId,
      triggerReason: 'VULNERABLE_OPERATION', triggerKey: key, reviewId: input.reviewId, correlationId: input.correlationId });
    const query = await tx.complianceScreeningResult.findFirst({ where: { id: queued.query.id,
      organization_id: input.organizationId, compareciente_id: input.comparecienteId, review_id: input.reviewId,
      query_kind: 'MASTER', contract_version: 'CUM-LST-001' } });
    if (!query) fail();
    const snapshot = await linkOperationSnapshotTx(tx, { organizationId: input.organizationId,
      requirementId: requirement.id, queryId: query!.id, capturedById: input.actorUserId });
    return { eligible: true as const, requirement, query: query!, snapshot, queryIdempotent: queued.idempotent };
  }
}

/**
 * Narrow H4→H3 seam. H3 remains the only screening engine. This adapter rejects
 * tenant, person and requirement/query lineage mismatches before invoking H3.
 */
export async function linkBeneficialControllerScreeningTx(tx: Prisma.TransactionClient, input: {
  organizationId: string;
  expedienteId: string;
  reviewId: string;
  requirementId: string;
  comparecienteId: string;
  actorUserId: string;
  correlationId?: string;
  actor?: Actor;
  evaluationId?: string;
  resultId?: string;
  targetPersonaMoralId?: string;
  expedienteActoId?: string | null;
}) {
  // Compatibility name only: incomplete legacy inputs must never reach H3.
  if (!input.actor || !input.evaluationId || !input.resultId || !input.targetPersonaMoralId) {
    throw new Error('H4_BC_SCREENING_LINEAGE_REQUIRED');
  }
  return ComplianceBcScreeningAdapter.ensureForIdentifiedBcTx(tx, {
    ...input, actor: input.actor, evaluationId: input.evaluationId, resultId: input.resultId,
    targetPersonaMoralId: input.targetPersonaMoralId, expedienteActoId: input.expedienteActoId ?? null,
  });
}
