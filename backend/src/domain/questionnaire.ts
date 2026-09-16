import { createHash } from 'crypto';

export const QUESTION_TYPES = ['SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'CURRENCY', 'PERCENTAGE', 'DATE', 'YES_NO', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'CATALOG', 'PERSON', 'INSTITUTION', 'SUPPORT_FILE', 'REPEATABLE_TABLE'] as const;
export type QuestionType = typeof QUESTION_TYPES[number];
export type QuestionnaireDefinition = {
  title: string;
  description?: string;
  purpose?: string;
  scope: 'EXPEDIENTE' | 'COMPARECIENTE' | 'INMUEBLE';
  applicableActIds?: string[];
  stageId?: string | null;
  formatMappings?: Array<{ formatId: string; mappings: Record<string, string[]> }>;
  sections: Array<{ id: string; title: string; order: number; questions: Array<{
    id: string; label: string; type: QuestionType; order: number; required?: boolean; help?: string;
    validation?: { min?: number; max?: number; pattern?: string }; options?: string[];
    condition?: { questionId: string; operator: 'EQUALS' | 'NOT_EQUALS' | 'INCLUDES' | 'NOT_EMPTY'; value?: unknown };
    prefill?: 'EXPEDIENTE_FOLIO' | 'EXPEDIENTE_CLIENTE' | 'COMPARECIENTE_NOMBRE' | 'INMUEBLE_CLAVE_CATASTRAL';
    mappings?: string[];
  }> }>;
};

export class QuestionnaireError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function validateQuestionnaireDefinition(input: unknown): QuestionnaireDefinition {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new QuestionnaireError(400, 'QUESTIONNAIRE_DEFINITION_REQUIRED', 'La definición del cuestionario es obligatoria.');
  const value = input as QuestionnaireDefinition;
  if (!String(value.title || '').trim() || !['EXPEDIENTE', 'COMPARECIENTE', 'INMUEBLE'].includes(value.scope) || !Array.isArray(value.sections) || !value.sections.length) throw new QuestionnaireError(400, 'QUESTIONNAIRE_DEFINITION_INVALID', 'Completa nombre, alcance y al menos una sección del cuestionario.');
  if (value.applicableActIds && (!Array.isArray(value.applicableActIds) || value.applicableActIds.some((id) => typeof id !== 'string' || !id.trim()))) throw new QuestionnaireError(400, 'QUESTIONNAIRE_ACTS_INVALID', 'Los actos aplicables no son válidos.');
  if (value.formatMappings && (!Array.isArray(value.formatMappings) || value.formatMappings.some((link) => !link?.formatId || !link.mappings || typeof link.mappings !== 'object' || Array.isArray(link.mappings)))) throw new QuestionnaireError(400, 'QUESTIONNAIRE_FORMAT_MAPPING_INVALID', 'Los formatos vinculados no son válidos.');
  const ids = new Set<string>();
  value.sections.forEach((section, sectionIndex) => {
    if (!section.id || !section.title?.trim() || !Array.isArray(section.questions)) throw new QuestionnaireError(400, 'QUESTIONNAIRE_SECTION_INVALID', `La sección ${sectionIndex + 1} no es válida.`);
    section.questions.forEach((question, questionIndex) => {
      if (!question.id || ids.has(question.id) || !question.label?.trim() || !QUESTION_TYPES.includes(question.type)) throw new QuestionnaireError(400, 'QUESTIONNAIRE_QUESTION_INVALID', `La pregunta ${questionIndex + 1} de ${section.title} no es válida.`);
      ids.add(question.id);
      if (question.condition && (!question.condition.questionId || !['EQUALS', 'NOT_EQUALS', 'INCLUDES', 'NOT_EMPTY'].includes(question.condition.operator))) throw new QuestionnaireError(400, 'QUESTIONNAIRE_CONDITION_INVALID', `La condición de ${question.label} no es declarativa válida.`);
      if (question.mappings && (!Array.isArray(question.mappings) || question.mappings.some((item) => typeof item !== 'string' || !item.trim()))) throw new QuestionnaireError(400, 'QUESTIONNAIRE_MAPPING_INVALID', `El mapeo de ${question.label} no es válido.`);
      if (question.validation?.pattern) { try { new RegExp(question.validation.pattern); } catch { throw new QuestionnaireError(400, 'QUESTIONNAIRE_VALIDATION_INVALID', `La validación de ${question.label} no es válida.`); } }
    });
  });
  for (const section of value.sections) for (const question of section.questions) if (question.condition && !ids.has(question.condition.questionId)) throw new QuestionnaireError(400, 'QUESTIONNAIRE_CONDITION_TARGET_MISSING', `La condición de ${question.label} referencia una pregunta inexistente.`);
  return JSON.parse(JSON.stringify(value));
}

export const questionnaireChecksum = (definition: QuestionnaireDefinition) => createHash('sha256').update(JSON.stringify(definition)).digest('hex');
export const questionVisible = (question: any, answers: Record<string, unknown>) => {
  const condition = question.condition; if (!condition) return true; const current = answers[condition.questionId];
  if (condition.operator === 'NOT_EMPTY') return current !== undefined && current !== null && current !== '';
  if (condition.operator === 'EQUALS') return current === condition.value;
  if (condition.operator === 'NOT_EQUALS') return current !== condition.value;
  return Array.isArray(current) && current.includes(condition.value);
};
export function evaluateQuestionnaire(definition: QuestionnaireDefinition, answers: Record<string, unknown>) {
  const missing: string[] = []; const mapped: Record<string, unknown> = {};
  for (const section of definition.sections) for (const question of section.questions) {
    if (!questionVisible(question, answers)) continue;
    const answer = answers[question.id];
    if (question.required && (answer === undefined || answer === null || answer === '' || (Array.isArray(answer) && !answer.length))) missing.push(question.id);
    if (answer !== undefined && answer !== null && answer !== '' && question.validation) {
      const numeric = typeof answer === 'number' ? answer : Number(answer);
      if (question.validation.min !== undefined && Number.isFinite(numeric) && numeric < question.validation.min) missing.push(question.id);
      if (question.validation.max !== undefined && Number.isFinite(numeric) && numeric > question.validation.max) missing.push(question.id);
      if (question.validation.pattern && !new RegExp(question.validation.pattern).test(String(answer))) missing.push(question.id);
    }
    for (const target of question.mappings || []) mapped[target] = answer;
  }
  return { complete: missing.length === 0, missing: [...new Set(missing)], mapped };
}
