import { describe, expect, it, vi } from 'vitest';
import { ensureOperationScreeningForPartyTx } from './operationScreening.service';

const organizationId = '00000000-0000-4000-8000-000000008001';
const actorId = '00000000-0000-4000-8000-000000008002';
const expedienteId = '00000000-0000-4000-8000-000000008003';
const comparecienteId = '00000000-0000-4000-8000-000000008004';
const actoId = '00000000-0000-4000-8000-000000008005';
const relationId = '00000000-0000-4000-8000-000000008006';
const reviewId = '00000000-0000-4000-8000-000000008007';

function operationDb(vulnerable = true) {
  const requirements: any[] = [];
  const queries: any[] = [];
  const snapshots: any[] = [];
  const db: any = {
    requirements, queries, snapshots,
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    expedienteCompareciente: { findFirst: vi.fn().mockResolvedValue({ id: relationId, compareciente_id: comparecienteId, expediente_acto_id: actoId }) },
    expedienteComplianceState: { findFirst: vi.fn().mockResolvedValue({ id: 'state-1', current_review_id: reviewId }) },
    complianceRuleResult: { findFirst: vi.fn().mockResolvedValue(vulnerable ? { id: 'result-1' } : null) },
    complianceRequirement: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(requirements.find((item) => item.review_id === where.review_id && item.requirement_key === where.requirement_key) || null)),
      create: vi.fn().mockImplementation(({ data }: any) => { const item = { id: `requirement-${requirements.length + 1}`, ...data }; requirements.push(item); return Promise.resolve(item); }),
      update: vi.fn().mockImplementation(({ where, data }: any) => { const item = requirements.find((entry) => entry.id === where.id); Object.assign(item, data); return Promise.resolve(item); }),
    },
    compareciente: { findFirst: vi.fn().mockResolvedValue({
      id: comparecienteId, tipo_persona: 'FISICA', nombre_busqueda: 'PERSONA SINTETICA',
      personaFisica: { nombre_completo_calculado: 'PERSONA SINTETICA', fecha_nacimiento: null, lugar_nacimiento: null, pais_nacimiento: null, nacionalidad: null, curp: null, rfc: null },
      personaMoral: null, aliases: [], identificaciones: [],
    }) },
    screeningSource: { findMany: vi.fn().mockResolvedValue([]) },
    screeningSourceExecution: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    screeningCandidate: { findMany: vi.fn().mockResolvedValue([]) },
    complianceScreeningResult: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(queries.find((item) => item.organization_id === where.organization_id && item.trigger_key === where.trigger_key && item.contract_version === where.contract_version) || null)),
      create: vi.fn().mockImplementation(({ data }: any) => { const item = { id: `query-${queries.length + 1}`, ...data }; queries.push(item); return Promise.resolve(item); }),
      update: vi.fn().mockImplementation(({ where, data }: any) => { const item = queries.find((entry) => entry.id === where.id); Object.assign(item, data); return Promise.resolve(item); }),
    },
    screeningOperationSnapshot: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(snapshots.find((item) => item.organization_id === where.organization_id && item.requirement_id === where.requirement_id && item.query_id === where.query_id) || null)),
      create: vi.fn().mockImplementation(({ data }: any) => { const item = { id: `snapshot-${snapshots.length + 1}`, ...data }; snapshots.push(item); return Promise.resolve(item); }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  return db;
}

const input = (overrides: Record<string, unknown> = {}) => ({
  organizationId, expedienteId, relationId, comparecienteId, expedienteActoId: actoId,
  reviewId, actorUserId: actorId, correlationId: 'correlation-operation', triggerEventId: 'event-operation',
  ...overrides,
});

describe('H3-F-002 · autoridad única de screening por operación', () => {
  it('Order A (vulnerabilidad y después vínculo) materializa una sola Requirement, Query y Snapshot', async () => {
    const db = operationDb();
    const first = await ensureOperationScreeningForPartyTx(db, input({ triggerEventId: 'event-party-linked' }));
    const retry = await ensureOperationScreeningForPartyTx(db, input({ triggerEventId: 'event-party-linked' }));
    expect(first.eligible).toBe(true); expect(retry.eligible).toBe(true);
    expect(db.requirements).toHaveLength(1); expect(db.queries).toHaveLength(1); expect(db.snapshots).toHaveLength(1);
    expect(retry.queryIdempotent).toBe(true);
  });

  it('Order B (vínculo y después vulnerabilidad) converge en la misma estructura contractual', async () => {
    const db = operationDb();
    const result = await ensureOperationScreeningForPartyTx(db, input({ relationId: null, triggerEventId: 'event-vulnerable' }));
    expect(result).toMatchObject({ eligible: true, requirementCreated: true, queryIdempotent: false });
    expect(db.requirements[0]).toMatchObject({ provider: 'LST', target_compareciente_id: comparecienteId, review_id: reviewId });
    expect(db.queries[0]).toMatchObject({ query_kind: 'MASTER', trigger_reason: 'VULNERABLE_OPERATION', review_id: reviewId, compareciente_id: comparecienteId });
    expect(db.snapshots[0]).toMatchObject({ requirement_id: db.requirements[0].id, query_id: db.queries[0].id });
  });

  it('un vínculo sin vulnerabilidad aplicable no crea Requirement LST', async () => {
    const db = operationDb(false);
    const result = await ensureOperationScreeningForPartyTx(db, input());
    expect(result).toEqual({ eligible: false, reason: 'NON_VULNERABLE_OPERATION' });
    expect(db.requirements).toHaveLength(0); expect(db.queries).toHaveLength(0); expect(db.snapshots).toHaveLength(0);
  });

  it('un evento tenant A no puede resolver una relación de tenant B', async () => {
    const db = operationDb();
    db.expedienteCompareciente.findFirst.mockResolvedValue(null);
    const result = await ensureOperationScreeningForPartyTx(db, input());
    expect(result).toEqual({ eligible: false, reason: 'ACTIVE_RELATION_NOT_FOUND' });
    expect(db.expedienteCompareciente.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organization_id: organizationId, expediente_id: expedienteId }) }));
    expect(db.requirements).toHaveLength(0);
  });
});
