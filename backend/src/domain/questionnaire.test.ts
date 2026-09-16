import { describe, expect, it } from 'vitest';
import {
  QUESTION_TYPES,
  evaluateQuestionnaire,
  questionnaireChecksum,
  questionVisible,
  validateQuestionnaireDefinition,
  type QuestionnaireDefinition,
} from './questionnaire';

const definition: QuestionnaireDefinition = {
  title: 'Identificación y recursos',
  scope: 'EXPEDIENTE',
  sections: [{
    id: 'general',
    title: 'General',
    order: 1,
    questions: [
      { id: 'provider', label: '¿Existe proveedor de recursos?', type: 'YES_NO', order: 1, required: true, mappings: ['compliance.provider.exists'] },
      { id: 'provider_name', label: 'Nombre del proveedor', type: 'SHORT_TEXT', order: 2, required: true, condition: { questionId: 'provider', operator: 'EQUALS', value: true }, mappings: ['compliance.provider.name', 'document.provider_name'] },
    ],
  }],
};

describe('CFG-001 catálogo canónico de cuestionarios', () => {
  it('incluye los catorce tipos mínimos del contrato', () => expect(QUESTION_TYPES).toHaveLength(14));

  it('acepta una definición versionable con condición y mapeo uno a varios', () => {
    const result = validateQuestionnaireDefinition(definition);
    expect(result.sections[0].questions[1].mappings).toEqual(['compliance.provider.name', 'document.provider_name']);
  });

  it('rechaza ids duplicados y condiciones que apuntan a preguntas inexistentes', () => {
    const duplicated = structuredClone(definition);
    duplicated.sections[0].questions[1].id = 'provider';
    expect(() => validateQuestionnaireDefinition(duplicated)).toThrow(/no es válida/i);
    const orphan = structuredClone(definition);
    orphan.sections[0].questions[1].condition!.questionId = 'missing';
    expect(() => validateQuestionnaireDefinition(orphan)).toThrow(/inexistente/i);
  });

  it('muestra y exige la pregunta condicional sólo cuando corresponde', () => {
    const conditional = definition.sections[0].questions[1];
    expect(questionVisible(conditional, { provider: false })).toBe(false);
    expect(evaluateQuestionnaire(definition, { provider: false })).toMatchObject({ complete: true, mapped: { 'compliance.provider.exists': false } });
    expect(evaluateQuestionnaire(definition, { provider: true })).toMatchObject({ complete: false, missing: ['provider_name'] });
    expect(evaluateQuestionnaire(definition, { provider: true, provider_name: 'Persona QA' })).toMatchObject({ complete: true, mapped: { 'compliance.provider.exists': true, 'compliance.provider.name': 'Persona QA', 'document.provider_name': 'Persona QA' } });
  });

  it('produce checksum determinista para fijar la versión histórica', () => {
    expect(questionnaireChecksum(definition)).toBe(questionnaireChecksum(structuredClone(definition)));
  });
});
