import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  tipoActo: { findMany: vi.fn() },
  configuracionEtapa: { findMany: vi.fn() },
  catalogoArtefacto: { findMany: vi.fn(), count: vi.fn() },
  catalogoArtefactoVersion: { findFirst: vi.fn() },
  expediente: { findFirst: vi.fn() },
  expedienteComplianceState: { findFirst: vi.fn() },
  complianceQuestionnaireAssessment: { findFirst: vi.fn() },
  expedienteCompareciente: { findFirst: vi.fn() },
  expedientePredio: { findFirst: vi.fn() },
  expedienteCuestionarioRespuesta: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock('../config/prisma', () => ({ default: db }));

import { QuestionnaireCatalogService } from './questionnaireCatalog.service';
import { ComplianceH5Service } from './complianceH5.service';

const definition = {
  title: 'Datos del expediente',
  scope: 'EXPEDIENTE',
  sections: [{
    id: 'general',
    title: 'General',
    order: 1,
    questions: [{ id: 'dato', label: 'Dato', type: 'SHORT_TEXT', order: 1, required: false, mappings: [] }],
  }],
};

const actor: any = {
  id: 'user-1',
  organizationId: 'org-1',
  sessionId: 'session-1',
  permissions: [],
};

describe('CFG-001 persistencia de cuestionarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.catalogoArtefactoVersion.findFirst.mockResolvedValue({ id: 'version-1', definition_json: definition });
    db.expediente.findFirst.mockResolvedValue({ id: 'exp-1' });
    db.$executeRaw.mockResolvedValue(1);
    db.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    db.$transaction.mockImplementation((work: (tx: typeof db) => unknown) => work(db));
  });

  it('incluye formatos CFG-002 estándar cuyo purpose canónico es nulo', async () => {
    db.tipoActo.findMany.mockResolvedValue([]);
    db.configuracionEtapa.findMany.mockResolvedValue([]);
    db.catalogoArtefacto.findMany.mockResolvedValue([{ id: 'adm-001', nombre: 'ADM-001 Cotización' }]);

    const result = await new QuestionnaireCatalogService().supporting(actor);

    expect(result.formats).toEqual([{ id: 'adm-001', nombre: 'ADM-001 Cotización' }]);
    expect(db.catalogoArtefacto.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tipo: 'FORMATO',
        OR: [{ purpose: null }, { purpose: { not: 'QUESTIONNAIRE' } }],
      }),
    }));
  });

  it('consume exclusivamente las evaluaciones que Cumplimiento marcó aplicables', async () => {
    db.expedienteComplianceState.findFirst.mockResolvedValue({ current_review_id: 'review-1' });
    vi.spyOn(ComplianceH5Service, 'readWorkspace').mockResolvedValue({ questionnaires: [{
      id: 'assessment-1', scope: 'PERSONAL', identity_key: 'PERSONAL:party-1',
      definition_version_id: 'version-2', definitionVersion: { id: 'version-2', version: 2, definition_json: definition },
      targetCompareciente: { nombre_busqueda: 'Persona Uno' }, requirement: { label: 'Cuestionario personal' }, currentRevision: null,
    }] } as any);

    const result = await new QuestionnaireCatalogService().listApplicable(actor, 'exp-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ assessmentId: 'assessment-1', bank: 'PERSONAL', subject: { key: 'PERSONAL:party-1', label: 'Persona Uno' } });
  });

  it('guarda respuestas mediante la revisión inmutable de Cumplimiento', async () => {
    db.complianceQuestionnaireAssessment.findFirst.mockResolvedValue({ id: 'assessment-1' });
    const save = vi.spyOn(ComplianceH5Service, 'saveQuestionnaire').mockResolvedValue({ id: 'revision-2' } as any);

    await new QuestionnaireCatalogService().saveAnswers(actor, 'exp-1', {
      assessmentId: 'assessment-1', answers: { dato: 'Valor' }, baseFingerprint: 'base-1', idempotencyKey: 'attempt-0001', finalize: false,
    });

    expect(save).toHaveBeenCalledWith(actor, 'assessment-1', {
      answers: { dato: 'Valor' }, base_fingerprint: 'base-1', idempotency_key: 'attempt-0001',
    }, false);
  });

  it('rechaza guardar una evaluación ajena al expediente u organización', async () => {
    db.complianceQuestionnaireAssessment.findFirst.mockResolvedValue(null);
    await expect(new QuestionnaireCatalogService().saveAnswers(actor, 'exp-1', {
      assessmentId: 'assessment-foreign', answers: {}, baseFingerprint: 'base-1', idempotencyKey: 'attempt-0002',
    })).rejects.toMatchObject({ code: 'QUESTIONNAIRE_CONTEXT_NOT_FOUND', status: 404 });
  });
});
