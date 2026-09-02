import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3ScreeningProvider } from '../domain/complianceScreening';

const storage = vi.hoisted(() => ({ uploadFile: vi.fn(), deleteFile: vi.fn() }));
vi.mock('./supabase.service', () => ({ uploadFile: storage.uploadFile, deleteFile: storage.deleteFile }));

import { ComplianceScreeningService, queueMasterScreeningTx } from './complianceScreening.service';

const org = '00000000-0000-4000-8000-000000004001';
const user = '00000000-0000-4000-8000-000000004002';
const party = '00000000-0000-4000-8000-000000004003';
const queryId = '00000000-0000-4000-8000-000000004004';
const sourceId = '00000000-0000-4000-8000-000000004005';
const versionId = '00000000-0000-4000-8000-000000004006';
const executionId = '00000000-0000-4000-8000-000000004007';
const identity = { tipo_persona: 'FISICA', primary_name: 'PERSONA SINTETICA', aliases: [], birth_date: null, birth_place: null, birth_country: null, nationality: null, curp: null, rfc: null, identification: null, incorporation_date: null, commercial_name: null, commercial_folio: null, corporate_type: null } as const;

function executionDb(providerState: any = 'QUEUED', candidateCreate = vi.fn().mockResolvedValue({})) {
  const execution: any = { id: executionId, organization_id: org, query_id: queryId, source_id: sourceId, source_version_id: versionId, execution_state: providerState, source: { id: sourceId, provider_key: 'SYNTH' }, sourceVersion: { id: versionId, adapter_key: 'SYNTH', adapter_version: '1.0' } };
  const query: any = { id: queryId, organization_id: org, execution_state: providerState === 'RUNNING' ? 'RUNNING' : 'QUEUED', query_snapshot: identity, sourceExecutions: [execution], candidates: [], operationSnapshots: [] };
  const attempts: any[] = [];
  const db: any = {
    complianceScreeningResult: {
      findFirst: vi.fn().mockImplementation(() => Promise.resolve(query)),
      updateMany: vi.fn().mockImplementation(({ data }: any) => { Object.assign(query, data); return Promise.resolve({ count: 1 }); }),
      update: vi.fn().mockImplementation(({ data }: any) => { Object.assign(query, data); return Promise.resolve(query); }),
    },
    screeningSourceExecution: {
      update: vi.fn().mockImplementation(({ data }: any) => { Object.assign(execution, data); return Promise.resolve(execution); }),
      updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
        if (!(where.execution_state.in as string[]).includes(execution.execution_state)) return Promise.resolve({ count: 0 });
        Object.assign(execution, data); return Promise.resolve({ count: 1 });
      }),
      findMany: vi.fn().mockImplementation(() => Promise.resolve([execution])),
    },
    screeningSourceExecutionAttempt: {
      findFirst: vi.fn().mockImplementation(() => Promise.resolve(attempts.at(-1) || null)),
      create: vi.fn().mockImplementation(({ data }: any) => { const attempt = { id: `attempt-${attempts.length + 1}`, ...data }; attempts.push(attempt); return Promise.resolve(attempt); }),
      update: vi.fn().mockImplementation(({ where, data }: any) => { const attempt = attempts.find((item) => item.id === where.id); Object.assign(attempt, data); return Promise.resolve(attempt); }),
    },
    screeningCandidate: { findFirst: vi.fn().mockResolvedValue(null), create: candidateCreate },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    complianceRequirement: { findFirst: vi.fn(), findMany: vi.fn() },
    expedienteComplianceState: { update: vi.fn() },
    $transaction: vi.fn(async (callback: any) => callback(db)),
  };
  return { db, query, execution, attempts };
}

const provider = (execute: H3ScreeningProvider['execute']): H3ScreeningProvider => ({ key: 'SYNTH', execute });

describe('CUM-LST-001 · nueve fallos inyectados', () => {
  beforeEach(() => { vi.clearAllMocks(); storage.deleteFile.mockResolvedValue(undefined); });

  it('01 timeout del proveedor termina ERROR y nunca limpio', async () => {
    const { db, query, execution } = executionDb();
    const service = new ComplianceScreeningService(db, new Map([['SYNTH', provider(async () => { throw new Error('PROVIDER_TIMEOUT'); })]]));
    await service.execute(org, queryId, user);
    expect(execution.execution_state).toBe('ERROR'); expect(query.execution_state).toBe('ERROR');
  });

  it('02 resultado malformado termina ERROR', async () => {
    const { db, query } = executionDb();
    const service = new ComplianceScreeningService(db, new Map([['SYNTH', provider(async () => ({ status: 'SUCCEEDED', candidates: null as any }))]]));
    await service.execute(org, queryId, user); expect(query.execution_state).toBe('ERROR');
  });

  it('03 fallo DB después del proveedor no produce clear', async () => {
    const failedCreate = vi.fn().mockRejectedValue(new Error('DB_WRITE_FAILED'));
    const { db, query } = executionDb('QUEUED', failedCreate);
    const service = new ComplianceScreeningService(db, new Map([['SYNTH', provider(async () => ({ status: 'SUCCEEDED', candidates: [{ stableId: 'stable', sourceReference: 'ref', displayName: 'SYNTHETIC', evidence: {} }] }))]]));
    await service.execute(org, queryId, user); expect(query.execution_state).toBe('ERROR');
  });

  it('04 resultado/callback duplicado queda como fallo y no persiste candidatos', async () => {
    const create = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'P2002' }));
    const { db, query } = executionDb('QUEUED', create);
    const service = new ComplianceScreeningService(db, new Map([['SYNTH', provider(async () => ({ status: 'SUCCEEDED', candidates: [
      { stableId: 'same', sourceReference: 'ref', displayName: 'SYNTHETIC', evidence: {} }, { stableId: 'same', sourceReference: 'ref', displayName: 'SYNTHETIC', evidence: {} },
    ] }))]]));
    await service.execute(org, queryId, user); expect(query.execution_state).toBe('ERROR'); expect(create).not.toHaveBeenCalled();
  });

  it('05 retry manual durante ejecución no llama otra vez al proveedor', async () => {
    const { db } = executionDb('RUNNING'); const execute = vi.fn();
    const service = new ComplianceScreeningService(db, new Map([['SYNTH', provider(execute)]]));
    await service.execute(org, queryId, user); expect(execute).not.toHaveBeenCalled(); expect(db.complianceScreeningResult.updateMany).not.toHaveBeenCalled();
  });

  it('06 SourceVersion ausente termina NOT_CONFIGURED', async () => {
    const { db, query, execution } = executionDb(); execution.sourceVersion = null; execution.source_version_id = null;
    const service = new ComplianceScreeningService(db, new Map()); await service.execute(org, queryId, user);
    expect(execution.execution_state).toBe('NOT_CONFIGURED'); expect(query.execution_state).toBe('NOT_CONFIGURED');
  });

  it('07 fuente deshabilitada no entra en el conjunto congelado', async () => {
    const created = { id: queryId, execution_state: 'NOT_CONFIGURED' };
    const db: any = {
      $executeRawUnsafe: vi.fn(),
      complianceScreeningResult: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(created), update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...created, ...data })) },
      compareciente: { findFirst: vi.fn().mockResolvedValue({ id: party, tipo_persona: 'FISICA', nombre_busqueda: 'PERSONA SINTETICA', personaFisica: { nombre_completo_calculado: 'PERSONA SINTETICA' }, personaMoral: null, aliases: [], identificaciones: [] }) },
      screeningSource: { findMany: vi.fn().mockResolvedValue([]) }, screeningSourceExecution: { create: vi.fn() }, auditLog: { create: vi.fn() },
    };
    await queueMasterScreeningTx(db, { organizationId: org, comparecienteId: party, requestedById: user, triggerReason: 'MANUAL_RERUN', triggerKey: 'disabled-only' });
    expect(db.screeningSource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organization_id: org, status: 'ACTIVE' } })); expect(db.screeningSourceExecution.create).not.toHaveBeenCalled();
  });

  it('08 candidato sin stable id termina ERROR', async () => {
    const { db, query } = executionDb();
    const service = new ComplianceScreeningService(db, new Map([['SYNTH', provider(async () => ({ status: 'SUCCEEDED', candidates: [{ stableId: '', sourceReference: 'ref', displayName: 'SYNTHETIC', evidence: {} }] }))]]));
    await service.execute(org, queryId, user); expect(query.execution_state).toBe('ERROR'); expect(db.screeningCandidate.create).not.toHaveBeenCalled();
  });

  it('09 fallo de Storage al generar reporte no crea Documento', async () => {
    storage.uploadFile.mockRejectedValueOnce(new Error('STORAGE_FAILED'));
    const db: any = {
      compareciente: { findFirst: vi.fn().mockResolvedValue({ id: party }) },
      complianceScreeningResult: { findFirst: vi.fn().mockResolvedValue({ id: queryId, query_kind: 'MASTER', execution_state: 'SUCCEEDED', created_at: new Date(), query_snapshot: identity, candidates: [], sourceExecutions: [], reports: [], operationSnapshots: [] }) },
      screeningReport: { findFirst: vi.fn().mockResolvedValue(null) }, documento: { create: vi.fn() },
    };
    const service = new ComplianceScreeningService(db, new Map());
    const actor: any = { id: user, organizationId: org, permissions: ['comparecientes.read', 'compliance.read', 'compliance.sensitive.read', 'documentos.write'], rol: 'ADMINISTRACION', scope: 'GLOBAL' };
    await expect(service.generateReport(actor, party, queryId, 'report-failure')).rejects.toThrow('STORAGE_FAILED'); expect(db.documento.create).not.toHaveBeenCalled();
  });
});
