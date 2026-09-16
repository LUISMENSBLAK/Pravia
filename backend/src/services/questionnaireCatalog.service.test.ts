import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  tipoActo: { findMany: vi.fn() },
  configuracionEtapa: { findMany: vi.fn() },
  catalogoArtefacto: { findMany: vi.fn(), count: vi.fn() },
  catalogoArtefactoVersion: { findFirst: vi.fn() },
  expediente: { findFirst: vi.fn() },
  expedienteCompareciente: { findFirst: vi.fn() },
  expedientePredio: { findFirst: vi.fn() },
  expedienteCuestionarioRespuesta: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock('../config/prisma', () => ({ default: db }));

import { QuestionnaireCatalogService } from './questionnaireCatalog.service';

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

  it('materializa una instancia por compareciente y prellena sólo los datos existentes', async () => {
    db.expediente.findFirst.mockResolvedValue({
      id: 'exp-1', numero_pravia: 'EXP-0001-2026', cliente_alias: 'Cliente', tipo_acto_id: null, actos: [], predios: [],
      comparecientes: [
        { compareciente_id: 'party-1', compareciente: { nombre_busqueda: 'Persona Uno' } },
        { compareciente_id: 'party-2', compareciente: { nombre_busqueda: '' } },
      ],
    });
    db.catalogoArtefacto.findMany.mockResolvedValue([{
      id: 'questionnaire-1', nombre: 'Identificación por compareciente', cuestionarioFormatos: [],
      versiones: [{ id: 'version-2', version: 2, definition_json: {
        title: 'Identificación por compareciente', scope: 'COMPARECIENTE', sections: [{ id: 'general', title: 'General', order: 0, questions: [
          { id: 'name', label: 'Nombre', type: 'SHORT_TEXT', order: 0, required: true, mappings: [], prefill: 'COMPARECIENTE_NOMBRE' },
          { id: 'pending', label: 'Dato pendiente', type: 'SHORT_TEXT', order: 1, required: false, mappings: [] },
        ] }],
      } }],
    }]);
    db.expedienteCuestionarioRespuesta.findMany.mockResolvedValue([]);

    const result = await new QuestionnaireCatalogService().listApplicable(actor, 'exp-1');

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.subject.key)).toEqual(['party-1', 'party-2']);
    expect(result[0].prefill).toEqual({ name: 'Persona Uno' });
    expect(result[1].prefill).toEqual({ name: '' });
  });

  it('serializa por expediente, versión, alcance y sujeto antes de asignar la revisión', async () => {
    db.expedienteCuestionarioRespuesta.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ revision: 4, answers_json: {} });
    db.expedienteCuestionarioRespuesta.create.mockResolvedValue({ id: 'response-5', revision: 5 });

    await new QuestionnaireCatalogService().saveAnswers(actor, 'exp-1', {
      versionId: 'version-1',
      scope: 'EXPEDIENTE',
      subjectKey: 'exp-1',
      answers: { dato: 'Valor' },
      idempotencyKey: 'attempt-0001',
    });

    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(db.expedienteCuestionarioRespuesta.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ revision: 5, idempotency_key: 'attempt-0001' }),
    }));
  });

  it('rechaza reutilizar una clave idempotente para otro contexto', async () => {
    db.expedienteCuestionarioRespuesta.findFirst.mockResolvedValueOnce({
      id: 'response-other',
      expediente_id: 'exp-other',
      artefacto_version_id: 'version-1',
      scope: 'EXPEDIENTE',
      subject_key: 'exp-other',
    });

    await expect(new QuestionnaireCatalogService().saveAnswers(actor, 'exp-1', {
      versionId: 'version-1',
      scope: 'EXPEDIENTE',
      subjectKey: 'exp-1',
      answers: {},
      idempotencyKey: 'attempt-0002',
    })).rejects.toMatchObject({ code: 'QUESTIONNAIRE_KEY_REUSED', status: 409 });
    expect(db.expedienteCuestionarioRespuesta.create).not.toHaveBeenCalled();
  });
});
