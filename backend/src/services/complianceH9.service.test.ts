import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ failure: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./aiUsage.service', async () => {
  const actual = await vi.importActual<any>('./aiUsage.service');
  return { ...actual, recordAIFailure: mocks.failure };
});

import { ComplianceH9Service } from './complianceH9.service';

const org = '00000000-0000-4000-8000-00000000a901';
const exp = '00000000-0000-4000-8000-00000000a902';
const userId = '00000000-0000-4000-8000-00000000a903';
const actor: any = { id: userId, organizationId: org, sessionId: 's', rol: 'ABOGADO', permissions: ['compliance.read', 'compliance.review', 'ia.execute'] };
const party = { id: 'rel-1', expediente_acto_id: null, compareciente_id: 'p-1', datos_validados: true, caracter: { clave: 'COMPRADOR', nombre: 'Comprador' }, compareciente: { id: 'p-1', version: 2, tipo_persona: 'FISICA', nombre_busqueda: 'Persona Sintética', personaFisica: { nombre_completo_calculado: 'Persona Sintética', rfc: 'SINT000000XX0', curp: 'SINT000000HNTSXX00', fecha_nacimiento: null }, personaMoral: null, domicilios: [] } };

function createDb() {
  const tx: any = {
    $executeRaw: vi.fn(), complianceAssistedReview: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    aIUsageLog: { upsert: vi.fn() }, auditLog: { create: vi.fn() }, expedienteActividad: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const db: any = {
    expediente: { findFirst: vi.fn().mockResolvedValue({ id: exp, numero_pravia: 'EXP-0001-2026', numero_notaria: null, estatus: 'ABIERTO', version: 1, fecha_apertura: new Date('2026-09-01'), fecha_estimada_firma: null, fecha_real_firma: null, valor_operacion: null, datos_operacion: {}, actos: [], comparecientes: [party] }) },
    expedienteComplianceState: { findFirst: vi.fn().mockResolvedValue({ id: 'state-1', current_review_id: 'review-1', state: 'PENDIENTE', version: 1 }) },
    complianceRequirement: { findMany: vi.fn().mockResolvedValue([]) }, complianceScreeningResult: { findMany: vi.fn().mockResolvedValue([]) },
    complianceQuestionnaireAssessment: { findMany: vi.fn().mockResolvedValue([]) }, complianceOperationPayment: { findMany: vi.fn().mockResolvedValue([]) },
    complianceBcEvaluation: { findMany: vi.fn().mockResolvedValue([]) }, complianceObligation: { findMany: vi.fn().mockResolvedValue([]) }, expedienteDocumento: { findMany: vi.fn().mockResolvedValue([]) },
    complianceAssistedReview: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) }, user: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (callback: any) => callback(tx)), _tx: tx,
  };
  tx.complianceAssistedReview.create.mockImplementation(async ({ data }: any) => ({ id: 'h9-1', result_checksum: data.result_checksum, ...data }));
  return db;
}

const ai: any = vi.fn().mockResolvedValue({ provider: 'OPENAI', model: 'gpt-5.4-mini', prompt_version: 'CUM-AUD-001-v1', schema_version: 'cum-aud-result-v1', usage: { modelo: 'gpt-5.4-mini', input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_tokens: 0, total_tokens: 15, duracion_ms: 5, documentos_enviados: 0, costo_estimado_usd: 0.001, precios_version: 'test', escalamiento_utilizado: false }, result: { verification_checks: [{ check_key: 'IDENTITY_MATCH', category: 'IDENTIDAD', status: 'CORRECT', message: 'Identidad consistente', source_refs: ['EXPEDIENTE_COMPARECIENTE:rel-1:comparecientes.identity-role-address'], affected_block: 'IDENTIFICACION_COMPARECIENTES', action_target: '#comparecientes', confidence: 'HIGH', provenance: 'fuente canónica' }], correct_count: 1, observations: [], critical_inconsistencies: [] } });

describe('H9 assisted compliance service', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('is manual, persists one append-only completed review and keeps technical audit/activity separate', async () => {
    const db = createDb(); const service = new ComplianceH9Service(db, ai);
    const result = await service.run(actor, exp, { idempotency_key: 'manual-run-001' }, '00000000-0000-4000-8000-00000000a904');
    expect(result.idempotent).toBe(false); expect(db._tx.complianceAssistedReview.create).toHaveBeenCalledTimes(1);
    expect(db._tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entidad: 'ComplianceAssistedReview' }) }));
    expect(db._tx.expedienteActividad.createMany).toHaveBeenCalledTimes(1);
    expect(db._tx.aIUsageLog.upsert).toHaveBeenCalledTimes(1);
  });
  it('returns a technical retry without invoking AI or duplicating history/activity', async () => {
    const db = createDb(); db.complianceAssistedReview.findFirst.mockResolvedValue({ id: 'existing' }); const localAi = vi.fn();
    expect(await new ComplianceH9Service(db, localAi).run(actor, exp, { idempotency_key: 'manual-run-001' })).toMatchObject({ idempotent: true });
    expect(localAi).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects insufficient readiness without creating a review', async () => {
    const db = createDb(); db.expedienteComplianceState.findFirst.mockResolvedValue(null);
    await expect(new ComplianceH9Service(db, ai).run(actor, exp, { idempotency_key: 'manual-run-002' })).rejects.toMatchObject({ code: 'H9_NOT_READY' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('enforces tenant and object access in the backend authority', async () => {
    const db = createDb(); db.expediente.findFirst.mockResolvedValue(null);
    await expect(new ComplianceH9Service(db, ai).workspace(actor, exp)).rejects.toMatchObject({ code: 'H9_CASE_ACCESS_DENIED', status: 403 });
  });
  it('uses only physical ExpedienteActo fields when building the canonical dataset', async () => {
    const db = createDb();
    await new ComplianceH9Service(db, ai).workspace(actor, exp);
    const select = db.expediente.findFirst.mock.calls[0][0].select.actos.select;
    expect(select).toMatchObject({ id: true, updated_at: true });
    expect(select).not.toHaveProperty('version');
    const paymentPartySelect = db.complianceOperationPayment.findMany.mock.calls[0][0].select.currentRevision.select.parties.select;
    expect(paymentPartySelect).toMatchObject({ role: true, expediente_compareciente_id: true, compareciente_id: true });
    expect(paymentPartySelect).not.toHaveProperty('display_name_snapshot');
  });
  it('does not persist a clean result when the AI seam fails', async () => {
    const db = createDb(); const failedAi = vi.fn().mockRejectedValue(new Error('network'));
    await expect(new ComplianceH9Service(db, failedAi).run(actor, exp, { idempotency_key: 'manual-run-003' })).rejects.toMatchObject({ code: 'H9_AI_FAILED' });
    expect(db.$transaction).not.toHaveBeenCalled(); expect(mocks.failure).toHaveBeenCalled();
  });
  it('requires both the canonical compliance review and IA execution permissions', async () => {
    const db = createDb();
    await expect(new ComplianceH9Service(db, ai).run({ ...actor, permissions: ['compliance.review'] }, exp, { idempotency_key: 'manual-run-004' })).rejects.toMatchObject({ code: 'H9_PERMISSION_DENIED' });
  });
});
