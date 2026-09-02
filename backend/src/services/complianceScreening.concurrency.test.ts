import { describe, expect, it, vi } from 'vitest';
import { ComplianceScreeningService, linkOperationSnapshotTx, queueMasterScreeningTx } from './complianceScreening.service';

const organizationId = '00000000-0000-4000-8000-000000005001';
const actorId = '00000000-0000-4000-8000-000000005002';
const comparecienteId = '00000000-0000-4000-8000-000000005003';
const requirementId = '00000000-0000-4000-8000-000000005004';

const actor: any = {
  id: actorId, email: 'h3-concurrency@example.invalid', nombre: 'H3', apellido: 'Synthetic',
  rol: 'ADMINISTRACION', sessionId: 'h3-test', organizationId,
  membershipId: '00000000-0000-4000-8000-000000005005', scope: 'GLOBAL',
  permissions: ['comparecientes.read', 'comparecientes.write', 'compliance.read', 'compliance.write', 'compliance.review', 'compliance.sensitive.read'],
  requiresPasswordChange: false,
};

function inMemoryDb() {
  const queries: any[] = [];
  const resolutions: any[] = [];
  const snapshots: any[] = [];
  let sequence = 0;
  let transactionTail = Promise.resolve();
  const identityRow = {
    id: comparecienteId, organization_id: organizationId, tipo_persona: 'FISICA', nombre_busqueda: 'PERSONA SINTETICA',
    personaFisica: { nombre_completo_calculado: 'PERSONA SINTETICA', fecha_nacimiento: null, lugar_nacimiento: null, pais_nacimiento: null, nacionalidad: null, curp: null, rfc: null },
    personaMoral: null, aliases: [], identificaciones: [],
  };
  const candidate: any = { id: '00000000-0000-4000-8000-000000005006', organization_id: organizationId, query_id: '', resolutions };
  const db: any = {
    queries, resolutions, snapshots, candidate,
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn((callback: any) => {
      const result = transactionTail.then(() => callback(db));
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    }),
    compareciente: { findFirst: vi.fn().mockImplementation(({ where, select }: any) => {
      if (where.id !== comparecienteId || where.organization_id !== organizationId) return Promise.resolve(null);
      return Promise.resolve(select ? { id: comparecienteId } : identityRow);
    }) },
    screeningSource: { findMany: vi.fn().mockResolvedValue([]) },
    screeningSourceExecution: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    complianceScreeningResult: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(queries.find((query) =>
        (!where.id || query.id === where.id) &&
        (!where.organization_id || query.organization_id === where.organization_id) &&
        (!where.trigger_key || query.trigger_key === where.trigger_key) &&
        (!where.contract_version || query.contract_version === where.contract_version) &&
        (!where.compareciente_id || query.compareciente_id === where.compareciente_id)
      ) || null)),
      findMany: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(queries.filter((query) => query.organization_id === where.organization_id && query.compareciente_id === where.compareciente_id))),
      create: vi.fn().mockImplementation(({ data }: any) => {
        const query = { id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`, created_at: new Date(sequence), candidates: [], sourceExecutions: [], reports: [], operationSnapshots: [], ...data };
        queries.push(query); return Promise.resolve(query);
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const query = queries.find((item) => item.id === where.id); Object.assign(query, data); return Promise.resolve(query);
      }),
    },
    screeningCandidate: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(candidate.query_id === where.query_id && candidate.id === where.id ? candidate : null)),
      findMany: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(candidate.query_id === where.query_id ? [{ ...candidate, resolutions: resolutions.slice().reverse().slice(0, 1) }] : [])),
    },
    screeningHumanResolution: { create: vi.fn().mockImplementation(({ data }: any) => {
      const resolution = { id: `resolution-${resolutions.length + 1}`, created_at: new Date(), ...data }; resolutions.push(resolution); return Promise.resolve(resolution);
    }) },
    screeningOperationSnapshot: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(snapshots.find((snapshot) => snapshot.requirement_id === where.requirement_id && (!where.query_id || snapshot.query_id === where.query_id)) || null)),
      create: vi.fn().mockImplementation(({ data }: any) => { const snapshot = { id: `snapshot-${snapshots.length + 1}`, created_at: new Date(), ...data }; snapshots.push(snapshot); return Promise.resolve(snapshot); }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    complianceRequirement: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    expedienteComplianceState: { update: vi.fn() },
  };
  return db;
}

const queue = (db: any, triggerKey: string, triggerReason: any = 'MANUAL_RERUN') => db.$transaction((tx: any) => queueMasterScreeningTx(tx, {
  organizationId, comparecienteId, requestedById: actorId, triggerReason, triggerKey,
}));

describe('CUM-LST-001 · cinco invariantes de concurrencia', () => {
  it('01 serializa creación MASTER duplicada y conserva una sola Query', async () => {
    const db = inMemoryDb();
    const [first, second] = await Promise.all([queue(db, 'event:duplicate'), queue(db, 'event:duplicate')]);
    expect(db.queries).toHaveLength(1);
    expect(new Set([first.query.id, second.query.id])).toHaveLength(1);
    expect([first.idempotent, second.idempotent].sort()).toEqual([false, true]);
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), expect.stringContaining('event:duplicate'));
  });

  it('02 doble clic de reconsulta manual usa la misma clave y no duplica historia', async () => {
    const db = inMemoryDb(); const service = new ComplianceScreeningService(db);
    const [first, second] = await Promise.all([service.manualRerun(actor, comparecienteId, 'same-click'), service.manualRerun(actor, comparecienteId, 'same-click')]);
    expect(db.queries).toHaveLength(1); expect(first.id).toBe(second.id);
    expect(db.queries[0].trigger_reason).toBe('MANUAL_RERUN');
  });

  it('03 cambio de identidad y operación vulnerable conservan Queries distintas', async () => {
    const db = inMemoryDb();
    await Promise.all([
      queue(db, 'event:identity-1', 'RELEVANT_IDENTITY_CHANGED'),
      queue(db, 'event:operation-1', 'VULNERABLE_OPERATION'),
    ]);
    expect(db.queries).toHaveLength(2);
    expect(new Set(db.queries.map((query: any) => query.trigger_reason))).toEqual(new Set(['RELEVANT_IDENTITY_CHANGED', 'VULNERABLE_OPERATION']));
    expect(new Set(db.queries.map((query: any) => query.id)).size).toBe(2);
  });

  it('04 resolución humana concurrente con Q2 permanece append-only en Q1', async () => {
    const db = inMemoryDb(); const q1 = (await queue(db, 'event:q1')).query; db.candidate.query_id = q1.id; q1.candidates = [db.candidate];
    const service = new ComplianceScreeningService(db);
    const [resolution, q2] = await Promise.all([
      service.resolve(actor, comparecienteId, q1.id, db.candidate.id, 'NO_CORRESPONDE', 'Validación humana sintética'),
      queue(db, 'event:q2', 'RELEVANT_IDENTITY_CHANGED'),
    ]);
    expect(resolution.candidate_id).toBe(db.candidate.id); expect(q2.query.id).not.toBe(q1.id);
    expect(db.resolutions).toHaveLength(1); expect(db.candidate.query_id).toBe(q1.id); expect(db.queries).toHaveLength(2);
  });

  it('05 snapshot E1 conserva Q1 aunque Q2 se cree al mismo tiempo', async () => {
    const db = inMemoryDb(); const q1 = (await queue(db, 'event:q1-snapshot')).query;
    const [, q2] = await Promise.all([
      db.$transaction((tx: any) => linkOperationSnapshotTx(tx, { organizationId, requirementId, queryId: q1.id, capturedById: actorId })),
      queue(db, 'event:q2-snapshot', 'RELEVANT_IDENTITY_CHANGED'),
    ]);
    expect(q2.query.id).not.toBe(q1.id); expect(db.snapshots).toHaveLength(1); expect(db.snapshots[0].query_id).toBe(q1.id);
  });
});
