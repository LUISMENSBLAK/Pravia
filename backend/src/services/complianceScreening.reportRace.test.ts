import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => {
  const objects = new Map<string, Buffer>();
  let arrivals = 0;
  let target = 2;
  let release: (() => void) | null = null;
  let barrier = new Promise<void>((resolve) => { release = resolve; });
  return {
    objects,
    failDelete: false,
    reset() { objects.clear(); arrivals = 0; target = 2; this.failDelete = false; barrier = new Promise<void>((resolve) => { release = resolve; }); },
    releaseAfter(count: number) { target = count; if (arrivals >= target) release?.(); },
    uploadFile: vi.fn(async (buffer: Buffer, key: string) => {
      objects.set(key, buffer); arrivals += 1;
      if (arrivals >= target) release?.();
      await barrier;
    }),
    deleteFile: vi.fn(async (key: string) => {
      if (storage.failDelete) throw new Error('SYNTHETIC_DELETE_FAILURE');
      objects.delete(key);
    }),
  };
});

vi.mock('./supabase.service', () => ({ uploadFile: storage.uploadFile, deleteFile: storage.deleteFile }));

import {
  buildScreeningReportSnapshot,
  ComplianceScreeningService,
  renderScreeningReportSnapshotPdf,
  screeningReportSemanticFingerprint,
} from './complianceScreening.service';

const organizationId = '00000000-0000-4000-8000-00000000b001';
const actorId = '00000000-0000-4000-8000-00000000b002';
const comparecienteId = '00000000-0000-4000-8000-00000000b003';
const queryId = '00000000-0000-4000-8000-00000000b004';
const actor: any = { id: actorId, organizationId, rol: 'ADMINISTRACION', scope: 'GLOBAL', permissions: ['comparecientes.read', 'compliance.read', 'compliance.review', 'compliance.sensitive.read', 'documentos.write'] };

const tiedAt = new Date('2026-09-02T11:59:59.000Z');
const reportCollections = () => ({
  sourceExecutions: [
    { id: 'execution-b', source_id: 'source-b', source_version_id: 'version-b', execution_state: 'SUCCEEDED', created_at: tiedAt, source: { id: 'source-b', display_name: 'Fuente B' }, sourceVersion: { id: 'version-b', version: 2 } },
    { id: 'execution-a', source_id: 'source-a', source_version_id: 'version-a', execution_state: 'SUCCEEDED', created_at: tiedAt, source: { id: 'source-a', display_name: 'Fuente A' }, sourceVersion: { id: 'version-a', version: 1 } },
  ],
  candidates: [
    { id: 'candidate-b', source_execution_id: 'execution-b', stable_candidate_id: 'stable-b', source_record_ref: 'REF-B', display_name: 'PERSONA B', score: 0.85, created_at: tiedAt, resolutions: [] as any[] },
    { id: 'candidate-a', source_execution_id: 'execution-a', stable_candidate_id: 'stable-a', source_record_ref: 'REF-A', display_name: 'PERSONA A', score: 0.95, created_at: tiedAt, resolutions: [] as any[] },
  ],
});

function reportDb() {
  const reports: any[] = [];
  const documents: any[] = [];
  const jobs: any[] = [];
  let externalWinner: any = null;
  let resolutionSequence = 0;
  let transactionTail = Promise.resolve();
  const query = {
    id: queryId, organization_id: organizationId, compareciente_id: comparecienteId,
    query_kind: 'MASTER', contract_version: 'CUM-LST-001', execution_state: 'SUCCEEDED',
    identity_fingerprint: 'a'.repeat(64), query_snapshot: { primary_name: 'PERSONA SINTETICA' }, sourceExecutions: [], candidates: [], reports: [], operationSnapshots: [],
  };
  const findReport = (where: any) => [...reports, ...(externalWinner ? [externalWinner] : [])].find((report) => {
    if (where.organization_id && report.organization_id !== where.organization_id) return false;
    if (where.query_id && report.query_id !== where.query_id) return false;
    if (where.idempotency_key && report.idempotency_key !== where.idempotency_key) return false;
    if (where.content_checksum && report.content_checksum !== where.content_checksum) return false;
    if (where.semantic_fingerprint && report.semantic_fingerprint !== where.semantic_fingerprint) return false;
    if (where.OR && !where.OR.some((clause: any) =>
      (!clause.semantic_fingerprint || report.semantic_fingerprint === clause.semantic_fingerprint)
      && (!clause.idempotency_key || report.idempotency_key === clause.idempotency_key))) return false;
    return true;
  });
  const db: any = {
    reports, documents, jobs, query, failNextReportTransaction: false, forceP2002: false,
    compareciente: { findFirst: vi.fn().mockResolvedValue({ id: comparecienteId }) },
    complianceScreeningResult: { findFirst: vi.fn().mockResolvedValue(query) },
    screeningCandidate: { findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(query.candidates.find((candidate: any) => candidate.id === where.id) || null)) },
    screeningHumanResolution: { create: vi.fn().mockImplementation(({ data }: any) => {
      resolutionSequence += 1;
      const resolution = { id: `resolution-${String(resolutionSequence).padStart(4, '0')}`, ...data, created_at: new Date() };
      query.candidates.find((candidate: any) => candidate.id === data.candidate_id)?.resolutions.push(resolution);
      return Promise.resolve(resolution);
    }) },
    screeningReport: { findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(findReport(where) || null)) },
    documento: { create: vi.fn().mockImplementation(({ data }: any) => { const document = { id: `document-${documents.length + 1}`, ...data }; documents.push(document); return Promise.resolve(document); }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    storageCompensationJob: { create: vi.fn().mockImplementation(({ data }: any) => { const job = { id: `job-${jobs.length + 1}`, ...data }; jobs.push(job); return Promise.resolve(job); }) },
    $transaction: vi.fn((callback: any) => {
      const result = transactionTail.then(async () => {
        const lengths = { reports: reports.length, documents: documents.length, jobs: jobs.length };
        try {
          if (db.failNextReportTransaction) { db.failNextReportTransaction = false; throw new Error('SYNTHETIC_DB_FAILURE'); }
          return await callback(db);
        } catch (error) {
          reports.length = lengths.reports; documents.length = lengths.documents; jobs.length = lengths.jobs;
          throw error;
        }
      });
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    }),
  };
  db.screeningReport.create = vi.fn().mockImplementation(({ data }: any) => {
    if (db.forceP2002) {
      db.forceP2002 = false;
      const winnerStorageKey = `organizations/${organizationId}/screening/${queryId}/WINNER_Reporte_consulta_${queryId}.pdf`;
      storage.objects.set(winnerStorageKey, Buffer.from('winner'));
      externalWinner = { id: 'external-winner', ...data, idempotency_key: 'external-winner', documento: { storage_key: winnerStorageKey } };
      throw Object.assign(new Error('duplicate'), { code: 'P2002' });
    }
    if (findReport({ organization_id: data.organization_id, query_id: data.query_id, semantic_fingerprint: data.semantic_fingerprint })) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
    const report = { id: `report-${reports.length + 1}`, ...data, documento: { storage_key: documents.find((item) => item.id === data.documento_id)?.storage_key } };
    reports.push(report); return Promise.resolve(report);
  });
  return db;
}

async function waitForUploads(count: number) {
  for (let index = 0; index < 30 && storage.uploadFile.mock.calls.length < count; index += 1) await Promise.resolve();
  expect(storage.uploadFile).toHaveBeenCalledTimes(count);
}

describe('H3-F-007 · identidad semántica y compensación durable', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z')); storage.reset(); vi.clearAllMocks(); });
  afterEach(() => vi.useRealTimers());

  it('canoniza permutaciones de sources, executions y candidates y produce el mismo PDF con el mismo reloj', () => {
    const db = reportDb(); const collections = reportCollections();
    const forward = { ...db.query, sourceExecutions: collections.sourceExecutions, candidates: collections.candidates };
    const reversed = { ...db.query, sourceExecutions: [...collections.sourceExecutions].reverse(), candidates: [...collections.candidates].reverse() };
    const snapshotA = buildScreeningReportSnapshot(forward);
    const snapshotB = buildScreeningReportSnapshot(reversed);
    expect(snapshotB).toEqual(snapshotA);
    expect(screeningReportSemanticFingerprint(snapshotB)).toBe(screeningReportSemanticFingerprint(snapshotA));
    expect(renderScreeningReportSnapshotPdf(snapshotB, tiedAt.toISOString()).equals(renderScreeningReportSnapshotPdf(snapshotA, tiedAt.toISOString()))).toBe(true);
  });

  it('selecciona la resolución vigente por created_at DESC e id DESC aunque el input venga invertido', () => {
    const db = reportDb(); const collections = reportCollections();
    const resolutions = [
      { id: 'resolution-0001', created_at: tiedAt, decision: 'REVISION_ADICIONAL' },
      { id: 'resolution-0002', created_at: tiedAt, decision: 'NO_CORRESPONDE' },
    ];
    collections.candidates[0].resolutions = resolutions;
    const snapshotA = buildScreeningReportSnapshot({ ...db.query, sourceExecutions: collections.sourceExecutions, candidates: collections.candidates });
    collections.candidates[0].resolutions = [...resolutions].reverse();
    const snapshotB = buildScreeningReportSnapshot({ ...db.query, sourceExecutions: [...collections.sourceExecutions].reverse(), candidates: [...collections.candidates].reverse() });
    expect(snapshotB).toEqual(snapshotA);
    expect(snapshotA.candidates.find((candidate) => candidate.candidate_id === 'candidate-b')?.latest_decision).toBe('NO_CORRESPONDE');
  });

  it('mismo estado con relojes, idempotency keys y orden de arrays distintos deja un reporte, documento y blob', async () => {
    const db = reportDb(); const service = new ComplianceScreeningService(db);
    const collections = reportCollections(); db.query.sourceExecutions = collections.sourceExecutions; db.query.candidates = collections.candidates;
    const firstPromise = service.generateReport(actor, comparecienteId, queryId, 'client-a');
    await waitForUploads(1);
    db.query.sourceExecutions = [...db.query.sourceExecutions].reverse();
    db.query.candidates = [...db.query.candidates].reverse();
    vi.setSystemTime(new Date('2026-09-02T12:00:00.001Z'));
    const secondPromise = service.generateReport(actor, comparecienteId, queryId, 'client-b');
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first.report.id).toBe(second.report.id);
    expect(first.report.semantic_fingerprint).toBe(second.report.semantic_fingerprint);
    expect(db.reports).toHaveLength(1); expect(db.documents).toHaveLength(1); expect(storage.objects.size).toBe(1);
    expect([...storage.objects.keys()][0]).toContain('CLIENT-A_');
    expect(storage.deleteFile).toHaveBeenCalledTimes(1);
  });

  it('un cambio de resolución produce otro fingerprint y reporte sin mutar el histórico anterior', async () => {
    storage.releaseAfter(1);
    const db = reportDb(); const service = new ComplianceScreeningService(db);
    const collections = reportCollections(); const candidate = collections.candidates[0]; db.query.candidates.push(candidate);
    const first = await service.generateReport(actor, comparecienteId, queryId, 'state-a');
    const firstChecksum = first.report.content_checksum;
    const resolution = await service.resolve(actor, comparecienteId, queryId, candidate.id, 'NO_CORRESPONDE', 'Resolución humana sintética');
    const second = await service.generateReport(actor, comparecienteId, queryId, 'state-b');
    expect(resolution).toMatchObject({ candidate_id: candidate.id, decision: 'NO_CORRESPONDE' });
    expect(candidate.resolutions).toContainEqual(expect.objectContaining({ id: resolution.id, decision: 'NO_CORRESPONDE' }));
    expect(second.report.semantic_fingerprint).not.toBe(first.report.semantic_fingerprint);
    expect(db.reports).toHaveLength(2); expect(db.documents).toHaveLength(2); expect(storage.objects.size).toBe(2);
    expect(first.report.content_checksum).toBe(firstChecksum);
  });

  it('un fallo DB genérico posterior al upload elimina directamente el blob', async () => {
    storage.releaseAfter(1);
    const db = reportDb(); db.failNextReportTransaction = true;
    await expect(new ComplianceScreeningService(db).generateReport(actor, comparecienteId, queryId, 'db-failure')).rejects.toThrow('SYNTHETIC_DB_FAILURE');
    expect(storage.objects.size).toBe(0); expect(db.reports).toHaveLength(0); expect(db.documents).toHaveLength(0); expect(db.jobs).toHaveLength(0);
  });

  it('un fallo DB genérico más fallo de delete crea compensación durable sin Report ganador', async () => {
    storage.releaseAfter(1);
    const db = reportDb(); db.failNextReportTransaction = true; storage.failDelete = true;
    await expect(new ComplianceScreeningService(db).generateReport(actor, comparecienteId, queryId, 'db-storage-failure')).rejects.toThrow('SYNTHETIC_DB_FAILURE');
    expect(db.jobs).toHaveLength(1);
    expect(db.jobs[0]).toMatchObject({ organization_id: organizationId, screening_report_id: null, tipo_operacion: 'ELIMINAR_REPORTE_SCREENING_HUERFANO' });
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'SCREENING_REPORT_STORAGE_CLEANUP_QUEUED', entidad: 'ComplianceScreeningResult', entidad_id: queryId }) }));
  });

  it('si falla el delete del loser semántico conserva ganador y encola compensación auditada', async () => {
    const db = reportDb(); const service = new ComplianceScreeningService(db); storage.failDelete = true;
    const results = await Promise.all([
      service.generateReport(actor, comparecienteId, queryId, 'client-a'),
      service.generateReport(actor, comparecienteId, queryId, 'client-b'),
    ]);
    expect(db.reports).toHaveLength(1); expect(db.jobs).toHaveLength(1);
    expect(db.jobs[0]).toMatchObject({ tipo_operacion: 'ELIMINAR_REPORTE_SCREENING_HUERFANO', screening_report_id: db.reports[0].id });
    expect(results[0].report.id).toBe(results[1].report.id);
    expect(results.some((item) => item.cleanup_queued === true)).toBe(true);
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'SCREENING_REPORT_STORAGE_CLEANUP_QUEUED' }) }));
  });

  it('P2002 semántico más fallo de delete conserva el ganador y crea compensación durable', async () => {
    storage.releaseAfter(1);
    const db = reportDb(); db.forceP2002 = true; storage.failDelete = true;
    const result = await new ComplianceScreeningService(db).generateReport(actor, comparecienteId, queryId, 'p2002-loser');
    expect(result).toMatchObject({ report: { id: 'external-winner' }, idempotent: true, cleanup_queued: true });
    expect(db.jobs).toHaveLength(1);
    expect(db.jobs[0]).toMatchObject({ screening_report_id: 'external-winner', tipo_operacion: 'ELIMINAR_REPORTE_SCREENING_HUERFANO' });
    expect([...storage.objects.keys()]).toContain(result.report.documento.storage_key);
  });
});
