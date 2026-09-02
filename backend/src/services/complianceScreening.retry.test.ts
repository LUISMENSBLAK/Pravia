import { describe, expect, it, vi } from 'vitest';
import type { H3ScreeningProvider } from '../domain/complianceScreening';
import { ComplianceScreeningService } from './complianceScreening.service';

const organizationId = '00000000-0000-4000-8000-00000000a001';
const actorId = '00000000-0000-4000-8000-00000000a002';
const comparecienteId = '00000000-0000-4000-8000-00000000a003';
const queryId = '00000000-0000-4000-8000-00000000a004';
const actor: any = {
  id: actorId, organizationId, rol: 'ADMINISTRACION', scope: 'GLOBAL',
  permissions: ['comparecientes.read', 'comparecientes.write', 'compliance.read', 'compliance.write', 'compliance.sensitive.read'],
};
const identity = { tipo_persona: 'FISICA', primary_name: 'PERSONA SINTETICA', aliases: [], birth_date: null, birth_place: null, birth_country: null, nationality: null, curp: null, rfc: null, identification: null, incorporation_date: null, commercial_name: null, commercial_folio: null, corporate_type: null } as const;

function retryDb(initial: ['SUCCEEDED', 'ERROR'] | ['ERROR', 'ERROR']) {
  const attempts = [
    { id: 'attempt-a-1', organization_id: organizationId, source_execution_id: 'execution-a', attempt_number: 1, execution_state: initial[0] },
    { id: 'attempt-b-1', organization_id: organizationId, source_execution_id: 'execution-b', attempt_number: 1, execution_state: initial[1] },
  ];
  const executions: any[] = [
    { id: 'execution-a', organization_id: organizationId, query_id: queryId, source_id: 'source-a', source_version_id: 'version-a', execution_state: initial[0], source: { id: 'source-a' }, sourceVersion: { id: 'version-a', adapter_key: 'SOURCE_A' } },
    { id: 'execution-b', organization_id: organizationId, query_id: queryId, source_id: 'source-b', source_version_id: 'version-b', execution_state: initial[1], source: { id: 'source-b' }, sourceVersion: { id: 'version-b', adapter_key: 'SOURCE_B' } },
  ];
  const requirement: any = { id: 'requirement-1', organization_id: organizationId, state_id: 'state-1', review_id: 'review-1', provider: 'LST', status: initial.every((state) => state === 'ERROR') ? 'PENDIENTE' : 'EN_PROCESO', deadline: null };
  const query: any = { id: queryId, organization_id: organizationId, compareciente_id: comparecienteId, query_kind: 'MASTER', contract_version: 'CUM-LST-001', execution_state: initial.every((state) => state === 'ERROR') ? 'ERROR' : 'PARTIAL', status: initial.every((state) => state === 'ERROR') ? 'ERROR' : 'PARTIAL', query_snapshot: identity, sourceExecutions: executions, candidates: [], operationSnapshots: [{ requirement_id: requirement.id }] };
  const db: any = {
    query, executions, attempts, requirement,
    compareciente: { findFirst: vi.fn().mockResolvedValue({ id: comparecienteId }) },
    complianceScreeningResult: {
      findFirst: vi.fn().mockImplementation(() => Promise.resolve(query)),
      updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
        if (!(where.execution_state.in as string[]).includes(query.execution_state)) return Promise.resolve({ count: 0 });
        Object.assign(query, data); return Promise.resolve({ count: 1 });
      }),
      update: vi.fn().mockImplementation(({ data }: any) => { Object.assign(query, data); return Promise.resolve(query); }),
    },
    screeningSourceExecution: {
      updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
        const execution = executions.find((item) => item.id === where.id);
        if (!execution || !(where.execution_state.in as string[]).includes(execution.execution_state)) return Promise.resolve({ count: 0 });
        Object.assign(execution, data); return Promise.resolve({ count: 1 });
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => { const execution = executions.find((item) => item.id === where.id); Object.assign(execution, data); return Promise.resolve(execution); }),
      findMany: vi.fn().mockImplementation(() => Promise.resolve(executions)),
    },
    screeningSourceExecutionAttempt: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve([...attempts].reverse().find((item) => item.source_execution_id === where.source_execution_id) || null)),
      create: vi.fn().mockImplementation(({ data }: any) => { const attempt = { id: `attempt-${data.source_execution_id}-${data.attempt_number}`, ...data }; attempts.push(attempt); return Promise.resolve(attempt); }),
      update: vi.fn().mockImplementation(({ where, data }: any) => { const attempt = attempts.find((item) => item.id === where.id)!; Object.assign(attempt, data); return Promise.resolve(attempt); }),
    },
    screeningCandidate: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    complianceRequirement: {
      findFirst: vi.fn().mockResolvedValue(requirement),
      findMany: vi.fn().mockImplementation(() => Promise.resolve([requirement])),
      update: vi.fn().mockImplementation(({ data }: any) => { Object.assign(requirement, data); return Promise.resolve(requirement); }),
    },
    expedienteComplianceState: { update: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (callback: any) => callback(db)),
  };
  return db;
}

const provider = (key: string, execute: H3ScreeningProvider['execute']): H3ScreeningProvider => ({ key, execute });
const success = async () => ({ status: 'SUCCEEDED' as const, candidates: [], summary: { synthetic: true } });
const deferredProvider = () => {
  let resolve!: (value: Awaited<ReturnType<H3ScreeningProvider['execute']>>) => void;
  let reject!: (reason: Error) => void;
  const pending = new Promise<Awaited<ReturnType<H3ScreeningProvider['execute']>>>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  const execute = vi.fn(() => pending);
  return { execute, resolve, reject };
};

describe('H3-F-006 · reintento técnico con historia append-only', () => {
  it('ERROR publica Query, SourceExecution, Attempt y Requirement EN_PROCESO antes de esperar al proveedor', async () => {
    const db = retryDb(['ERROR', 'ERROR']);
    const controlled = deferredProvider();
    const sourceB = vi.fn(success);
    const service = new ComplianceScreeningService(db, new Map([['SOURCE_A', provider('SOURCE_A', controlled.execute)], ['SOURCE_B', provider('SOURCE_B', sourceB)]]));
    const retry = service.technicalRetry(actor, comparecienteId, queryId);
    await vi.waitFor(() => expect(controlled.execute).toHaveBeenCalledOnce());
    expect(db.query.execution_state).toBe('RUNNING');
    expect(db.executions[0].execution_state).toBe('RUNNING');
    expect(db.attempts).toContainEqual(expect.objectContaining({ source_execution_id: 'execution-a', attempt_number: 2, execution_state: 'RUNNING' }));
    expect(db.requirement.status).toBe('EN_PROCESO');
    expect(db.requirement.status).not.toBe('CUMPLIDO');
    controlled.resolve(await success());
    await retry;
  });

  it('PARTIAL mantiene el Requirement EN_PROCESO durante el retry y no reejecuta la fuente exitosa', async () => {
    const db = retryDb(['SUCCEEDED', 'ERROR']);
    const controlled = deferredProvider();
    const sourceA = vi.fn(success);
    const service = new ComplianceScreeningService(db, new Map([['SOURCE_A', provider('SOURCE_A', sourceA)], ['SOURCE_B', provider('SOURCE_B', controlled.execute)]]));
    const retry = service.technicalRetry(actor, comparecienteId, queryId);
    await vi.waitFor(() => expect(controlled.execute).toHaveBeenCalledOnce());
    expect(db.requirement.status).toBe('EN_PROCESO');
    expect(sourceA).not.toHaveBeenCalled();
    controlled.resolve(await success());
    await retry;
  });

  it('deriva el Requirement final después de un retry exitoso', async () => {
    const db = retryDb(['SUCCEEDED', 'ERROR']);
    const service = new ComplianceScreeningService(db, new Map([['SOURCE_B', provider('SOURCE_B', vi.fn(success))]]));
    await service.technicalRetry(actor, comparecienteId, queryId);
    expect(db.requirement.status).toBe('CUMPLIDO');
  });

  it('saca el Requirement de RUNNING y lo deja incompleto cuando el retry vuelve a fallar', async () => {
    const db = retryDb(['SUCCEEDED', 'ERROR']);
    const failingProvider = vi.fn().mockRejectedValue(new Error('SYNTHETIC_PROVIDER_FAILURE'));
    const service = new ComplianceScreeningService(db, new Map([['SOURCE_B', provider('SOURCE_B', failingProvider)]]));
    await service.technicalRetry(actor, comparecienteId, queryId);
    expect(db.query.execution_state).toBe('PARTIAL');
    expect(db.requirement.status).toBe('EN_PROCESO');
    expect(db.requirement.status).not.toBe('CUMPLIDO');
  });

  it('PARTIAL reintenta sólo la fuente fallida, conserva attempt 1 y completa la misma Query', async () => {
    const db = retryDb(['SUCCEEDED', 'ERROR']);
    const sourceA = vi.fn(success); const sourceB = vi.fn(success);
    const service = new ComplianceScreeningService(db, new Map([['SOURCE_A', provider('SOURCE_A', sourceA)], ['SOURCE_B', provider('SOURCE_B', sourceB)]]));
    const result = await service.technicalRetry(actor, comparecienteId, queryId, 'correlation-retry');
    expect(result.id).toBe(queryId); expect(result.execution_state).toBe('SUCCEEDED');
    expect(sourceA).not.toHaveBeenCalled(); expect(sourceB).toHaveBeenCalledTimes(1);
    expect(db.executions).toHaveLength(2);
    expect(db.attempts.filter((item: any) => item.source_execution_id === 'execution-b')).toMatchObject([
      { attempt_number: 1, execution_state: 'ERROR' }, { attempt_number: 2, execution_state: 'SUCCEEDED' },
    ]);
  });

  it('ERROR permite reintentar las fuentes fallidas sin crear Q2', async () => {
    const db = retryDb(['ERROR', 'ERROR']);
    const sourceA = vi.fn(success); const sourceB = vi.fn(success);
    const service = new ComplianceScreeningService(db, new Map([['SOURCE_A', provider('SOURCE_A', sourceA)], ['SOURCE_B', provider('SOURCE_B', sourceB)]]));
    await service.technicalRetry(actor, comparecienteId, queryId);
    expect(sourceA).toHaveBeenCalledTimes(1); expect(sourceB).toHaveBeenCalledTimes(1);
    expect(db.query).toMatchObject({ id: queryId, execution_state: 'SUCCEEDED' });
    expect(db.executions).toHaveLength(2); expect(db.attempts).toHaveLength(4);
  });

  it.each(['SUCCEEDED', 'NOT_CONFIGURED'])('%s es final y no admite reintento técnico', async (state) => {
    const db = retryDb(['ERROR', 'ERROR']); db.query.execution_state = state;
    db.complianceScreeningResult.findFirst.mockImplementation(({ where }: any) => Promise.resolve(where.execution_state ? null : db.query));
    await expect(new ComplianceScreeningService(db).technicalRetry(actor, comparecienteId, queryId)).rejects.toMatchObject({ code: 'SCREENING_QUERY_NOT_RETRYABLE' });
    expect(db.attempts).toHaveLength(2);
  });
});
