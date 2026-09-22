import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  catalogoArtefacto: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  catalogoArtefactoVersion: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  complianceQuestionnaireAssessmentRevision: { findMany: vi.fn() },
  notaria: { findFirst: vi.fn() },
  auditLog: { create: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock('../config/prisma', () => ({ default: db }));

import { questionnaireBanksService } from './questionnaireBanks.service';

const actor: any = { id: 'user-1', organizationId: 'org-1', sessionId: 'session-1', permissions: ['configuracion.plantillas_formatos.manage'] };
const definition = (scope: 'PERSONAL' | 'GENERAL', label: string) => ({ schema_version: 1, scope, sections: [{ id: scope.toLowerCase(), label, questions: [{ id: `q-${scope}`, label: `Pregunta ${label}`, type: 'TEXT', required: false, active: true, order: 0 }] }] });
const artifact = (purpose: string, scope: 'PERSONAL' | 'GENERAL', label: string) => ({
  id: `artifact-${scope}`, purpose, versiones: [{ id: `version-${scope}`, version: 2, definition_json: definition(scope, label) }],
});

describe('Corrección 012 · dos bancos globales de preguntas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation((work: any) => work(db));
    db.$executeRaw.mockResolvedValue(1); db.catalogoArtefactoVersion.updateMany.mockResolvedValue({ count: 1 });
    db.catalogoArtefacto.update.mockResolvedValue({}); db.auditLog.create.mockResolvedValue({});
  });

  it('expone exactamente Personal y Acto / Operación sin metadatos de aplicabilidad editables', async () => {
    db.catalogoArtefacto.findMany.mockImplementation(async ({ where }: any) => where.purpose === 'CUE_PERSONAL'
      ? [artifact('CUE_PERSONAL', 'PERSONAL', 'Personal')]
      : [artifact('CUE_GENERAL', 'GENERAL', 'Acto / Operación')]);
    const result = await questionnaireBanksService.list(actor);
    expect(result.banks.map((item) => item.label)).toEqual(['Personal', 'Acto / Operación']);
    expect(result.applicability_authority).toBe('CUMPLIMIENTO_PLD_UIF');
    expect(result.editable_metadata).toEqual(['questions']);
    expect(JSON.stringify(result)).not.toMatch(/multiplicidad|etapa|tipo_acto|destino|purpose/i);
  });

  it('agregar una pregunta publica una versión nueva inmutable del banco canónico', async () => {
    db.catalogoArtefacto.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    db.notaria.findFirst.mockResolvedValue({ id: 'notaria-1' });
    db.catalogoArtefacto.create.mockResolvedValue({ id: 'artifact-new', purpose: 'CUE_PERSONAL' });
    db.catalogoArtefactoVersion.findFirst.mockResolvedValue(null);
    db.catalogoArtefactoVersion.create.mockImplementation(async ({ data }: any) => ({ id: 'version-new', ...data }));
    const result = await questionnaireBanksService.add(actor, 'PERSONAL', { label: '¿Cuál es su ocupación?', type: 'TEXT', required: true });
    expect(result.id).toBeTruthy();
    expect(db.catalogoArtefactoVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 1, content_kind: 'STRUCTURED_QUESTIONNAIRE', activa: true }) }));
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'QUESTIONNAIRE_BANK_QUESTION_CREATED' }) }));
  });

  it('rechaza administración sin permiso y bancos distintos de los dos contractuales', async () => {
    await expect(questionnaireBanksService.add({ ...actor, permissions: [] }, 'PERSONAL', { label: 'Pregunta' })).rejects.toMatchObject({ status: 403, code: 'QUESTIONNAIRE_BANK_MANAGE_DENIED' });
    await expect(questionnaireBanksService.add(actor, 'TERCERO', { label: 'Pregunta' })).rejects.toMatchObject({ status: 400, code: 'QUESTIONNAIRE_BANK_INVALID' });
  });

  it('impide eliminar una pregunta usada por una respuesta finalizada y permite inactivarla', async () => {
    db.catalogoArtefacto.findMany.mockResolvedValue([artifact('CUE_PERSONAL', 'PERSONAL', 'Personal')]);
    db.catalogoArtefactoVersion.findMany.mockResolvedValue([{ id: 'version-PERSONAL' }]);
    db.complianceQuestionnaireAssessmentRevision.findMany.mockResolvedValue([{ answers: { 'q-PERSONAL': 'respuesta histórica' } }]);
    await expect(questionnaireBanksService.remove(actor, 'PERSONAL', 'q-PERSONAL')).rejects.toMatchObject({ status: 409, code: 'QUESTIONNAIRE_QUESTION_IN_USE' });

    db.catalogoArtefactoVersion.findFirst.mockResolvedValue({ id: 'version-PERSONAL', version: 2, definition_json: definition('PERSONAL', 'Personal') });
    db.catalogoArtefactoVersion.create.mockImplementation(async ({ data }: any) => ({ id: 'version-3', ...data }));
    await expect(questionnaireBanksService.update(actor, 'PERSONAL', 'q-PERSONAL', { active: false })).resolves.toEqual({ id: 'q-PERSONAL' });
    expect(db.catalogoArtefactoVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ definition_json: expect.objectContaining({ sections: [expect.objectContaining({ questions: [expect.objectContaining({ id: 'q-PERSONAL', active: false })] })] }) }) }));
  });
});
