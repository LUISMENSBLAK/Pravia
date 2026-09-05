import { describe, expect, it, vi } from 'vitest';
import { ComplianceH6Service } from './complianceH6.service';

const id = {
  org: '10000000-0000-4000-8000-000000000001',
  user: '10000000-0000-4000-8000-000000000002',
  exp: '10000000-0000-4000-8000-000000000003',
  review: '10000000-0000-4000-8000-000000000004',
  state: '10000000-0000-4000-8000-000000000005',
  result: '10000000-0000-4000-8000-000000000006',
  revision: '10000000-0000-4000-8000-000000000007',
  actA: '10000000-0000-4000-8000-000000000008',
  actB: '10000000-0000-4000-8000-000000000009',
};

const actor = { id: id.user, organizationId: id.org, rol: 'DIRECCION', permissions: ['compliance.write'] } as any;
const input = (scopeActIds: string[]) => ({
  expedienteId: id.exp, reviewId: id.review, stateId: id.state, ruleResultId: id.result,
  ruleRevisionId: id.revision, expedienteActoId: id.actA, legalDate: new Date('2026-09-05'),
  deadline: null, deadlineSource: null,
  result: {
    applicability: 'APLICA_CON_AVISO', legalBasis: 'SYNTHETIC TEST ONLY', version: 1,
    stableKey: 'SYNTHETIC', checksum: 'a'.repeat(64), missingPaths: [],
    obligation: { legal_obligation_key: 'SYNTHETIC', key: 'SYNTHETIC', channel: 'TEST', type: 'NOTICE', scope_kind: 'ACT_SET', scope_act_ids: scopeActIds },
  },
});

function transaction(caseAllowed = true, actCount = 2) {
  const master = { id: '10000000-0000-4000-8000-000000000010', avi_state: 'PENDIENTE', status: 'POR_DETERMINAR', freshness: 'CURRENT' };
  return {
    expediente: { findFirst: vi.fn().mockResolvedValue(caseAllowed ? { id: id.exp } : null) },
    expedienteActo: { count: vi.fn().mockResolvedValue(actCount) },
    complianceObligation: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(master),
      update: vi.fn().mockResolvedValue(master),
    },
    complianceObligationTrigger: { upsert: vi.fn().mockResolvedValue({ id: 'trigger' }) },
    complianceRequirement: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'requirement' }),
      update: vi.fn(),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
  } as any;
}

describe('H6 remediation service boundaries', () => {
  it('rejects an inaccessible expediente before creating a canonical obligation', async () => {
    const tx = transaction(false);
    await expect(ComplianceH6Service.materializeObligationTx(tx, actor, input([id.actA]))).rejects.toMatchObject({ code: 'H6_CASE_NOT_FOUND', status: 404 });
    expect(tx.complianceObligation.create).not.toHaveBeenCalled();
  });

  it('rejects a missing, foreign-tenant or same-tenant wrong-case act set before identity persistence', async () => {
    const tx = transaction(true, 1);
    await expect(ComplianceH6Service.materializeObligationTx(tx, actor, input([id.actA, id.actB]))).rejects.toMatchObject({ code: 'H6_SCOPE_ACT_MEMBERSHIP_INVALID' });
    expect(tx.expedienteActo.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organization_id: id.org, expediente_id: id.exp }) }));
    expect(tx.complianceObligation.create).not.toHaveBeenCalled();
  });

  it('accepts a valid multi-act scope and uses the same trigger identity on retry', async () => {
    const tx = transaction(true, 2);
    await ComplianceH6Service.materializeObligationTx(tx, actor, input([id.actB, id.actA]));
    tx.complianceObligation.findFirst.mockResolvedValue({ id: '10000000-0000-4000-8000-000000000010', avi_state: 'PENDIENTE', status: 'POR_DETERMINAR', freshness: 'CURRENT' });
    tx.complianceRequirement.findFirst.mockResolvedValue({ id: 'requirement' });
    await ComplianceH6Service.materializeObligationTx(tx, actor, input([id.actA, id.actB]));
    const first = tx.complianceObligationTrigger.upsert.mock.calls[0][0].where.organization_id_obligation_id_trigger_identity_hash;
    const second = tx.complianceObligationTrigger.upsert.mock.calls[1][0].where.organization_id_obligation_id_trigger_identity_hash;
    expect(first).toEqual(second);
    expect(tx.complianceObligationTrigger.upsert).toHaveBeenCalledTimes(2);
  });
});
