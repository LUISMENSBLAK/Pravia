import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../config/prisma', () => ({ default: { $transaction: vi.fn() } }));
import prisma from '../config/prisma';
import { BeneficialControllerService } from './beneficialController.service';
import { ComplianceLegalEngineService } from './complianceLegalEngine.service';
import { bcResultExecutions, bcGraphFingerprint, type BcGraphInput, type BcVerifiedRevision } from '../domain/beneficialController';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor: any = { id: id(90), organizationId: id(91), rol: 'ADMINISTRACION', permissions: ['compliance.write'] };
const revision = (n: number, purpose: 'APPLICABILITY' | 'DETERMINATION'): BcVerifiedRevision => ({
  id: id(n), rule_id: id(n + 10), stable_key: `SYNTHETIC_${n}`, family: 'CUM_MAT_002', version: 1,
  status: 'ACTIVE', verified_at: '2026-01-01', source_name: 'SYNTHETIC ONLY', source_url: 'https://example.invalid',
  source_checksum: 'a'.repeat(64), source_published_at: '2026-01-01', checksum: 'b'.repeat(64), legal_basis: 'SYNTHETIC ONLY',
  conditions: purpose === 'APPLICABILITY' ? { op: 'equals', path: 'enabled', value: true } : { op: 'equals', path: 'subject.party_kind', value: 'PF' },
  outcome: { bc: { regime: 'LFPIORPI', purpose }, when_true: { applicability: 'APLICA_SIN_AVISO', vulnerable_activity: true } },
});
function fixture() {
  const graph: BcGraphInput = { root_node_id: id(1), nodes: [
    { id: id(1), party_kind: 'PM', identity_mode: 'LINKED', linked_compareciente_id: id(10) },
    { id: id(2), party_kind: 'PF', identity_mode: 'STRUCTURED_ONLY', display_name: 'Synthetic P1' },
    { id: id(3), party_kind: 'PF', identity_mode: 'STRUCTURED_ONLY', display_name: 'Synthetic P2' },
  ], edges: [{ id: id(4), owner_node_id: id(2), owned_node_id: id(1), percentage: '40' },
    { id: id(5), owner_node_id: id(3), owned_node_id: id(1), percentage: '60' }], controls: [] };
  const rows = { h1: [] as any[], evaluations: [] as any[], results: [] as any[], requirements: [] as any[] };
  let sequence = 200;
  const create = (list: any[]) => vi.fn(async ({ data }: any) => { const row = { id: id(sequence++), ...data }; list.push(row); return row; });
  const tx: any = { $executeRawUnsafe: vi.fn(), complianceRuleResult: { create: create(rows.h1) },
    complianceBcEvaluation: { findMany: async () => rows.evaluations, findFirst: async () => null, create: create(rows.evaluations) },
    complianceBcStructureSnapshot: { create: create([]) }, complianceBcResult: { create: create(rows.results) },
    complianceRequirement: { create: create(rows.requirements), findMany: async () => rows.requirements }, auditLog: { create: create([]) } };
  const input: any = { organizationId: actor.organizationId, expedienteId: id(92), reviewId: id(93), stateId: id(94), actorUserId: actor.id,
    actor, plan: { targets: [{ personaMoralId: id(95), actId: id(96), structure: { id: id(97), revision: 1 }, graph, fingerprint: bcGraphFingerprint(graph) }] },
    legalDate: new Date('2026-01-01'), requestHash: 'c'.repeat(64), context: { enabled: true }, previousReviewId: null,
    revisions: [revision(20, 'APPLICABILITY'), revision(21, 'DETERMINATION')] };
  return { rows, tx, input };
}
afterEach(() => vi.restoreAllMocks());
describe('H4 F001-F003 materialization service', () => {
  it('writes one H1 row per rule/act, ordered facts and separate subject executions', async () => {
    const { tx, input, rows } = fixture();
    await BeneficialControllerService.materializeForReviewTx(tx, input);
    expect(rows.h1).toHaveLength(2); expect(rows.results).toHaveLength(2);
    expect(rows.evaluations[0].result_snapshot.subject_executions).toHaveLength(3);
    for (const result of rows.results) expect(bcResultExecutions(result, rows.evaluations[0].result_snapshot)).toHaveLength(1);
    await BeneficialControllerService.materializeForReviewTx(tx, input);
    expect(rows.h1).toHaveLength(2); expect(rows.results).toHaveLength(2); expect(rows.evaluations).toHaveLength(2);
  });
  it('rejects subject swaps and altered facts in the independent consumer guard', async () => {
    const { tx, input, rows } = fixture(); await BeneficialControllerService.materializeForReviewTx(tx, input);
    const first = rows.results[0], second = rows.results[1], evaluation = rows.evaluations[0].result_snapshot;
    expect(bcResultExecutions({ ...first, subject_snapshot_node_id: second.subject_snapshot_node_id }, evaluation)).toEqual([]);
    expect(bcResultExecutions({ ...second, subject_snapshot_node_id: first.subject_snapshot_node_id }, evaluation)).toEqual([]);
    expect(bcResultExecutions({ ...first, facts_snapshot: [] }, evaluation)).toEqual([]);
  });
});
describe('H4 F005 historical review reuse', () => {
  it.each(['PENDIENTE', 'EN_PROCESO', 'BLOQUEADO_POR_FALTA_DATOS'])('derives %s requirements instead of restoring historical COMPLETO', async status => {
    const current = { id: id(94), current_review_id: id(12), state: 'PENDIENTE', pending_count: 1 };
    const snapshot = { state: 'CUMPLIMIENTO_COMPLETO', pending_count: 0 };
    const tx: any = { $executeRawUnsafe: vi.fn(), expediente: { findFirst: async () => ({ id: id(92), actos: [], comparecientes: [], predios: [], calculosISR: [] }) },
      complianceReview: { findFirst: async (args: any) => args.where.idempotency_key ? null : { id: id(11), canonical_state_snapshot: snapshot } },
      expedienteComplianceState: { findFirst: async () => current, update: vi.fn(async ({ data }) => Object.assign(current, data)) },
      complianceRequirement: { findMany: vi.fn(async () => [{ status, deadline: null }]) }, auditLog: { create: vi.fn() } };
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: any) => fn(tx)) as any);
    vi.spyOn(BeneficialControllerService, 'prepareReviewTx').mockResolvedValue({ targets: [{}] as any, identity: [] });
    vi.spyOn(ComplianceLegalEngineService as any, 'readCanonicalEvaluation').mockResolvedValue({});
    await ComplianceLegalEngineService.evaluateCase(actor, id(92), { idempotency_key: 'synthetic-reuse' });
    expect(current.state).not.toBe('CUMPLIMIENTO_COMPLETO'); expect(current.pending_count).toBe(1);
    expect(current.current_review_id).toBe(id(11)); expect(snapshot).toEqual({ state: 'CUMPLIMIENTO_COMPLETO', pending_count: 0 });
    expect(tx.complianceRequirement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ review_id: id(11) }) }));
  });
});
