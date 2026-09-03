import { Prisma } from '@prisma/client';

export type TruthValue = 'TRUE' | 'FALSE' | 'UNKNOWN';

export type LegalCondition =
  | { op: 'all' | 'any'; rules: LegalCondition[] }
  | { op: 'not'; rule: LegalCondition }
  | { op: 'exists'; path: string }
  | { op: 'equals' | 'gte' | 'lte'; path: string; value: unknown }
  | { op: 'in'; path: string; values: unknown[] }
  | { op: 'array_some'; path: string; rule: LegalCondition };

export type LegalRuleOutcome = {
  /** Optional CUM-BC-001 routing, versioned and verified with the H1 revision. */
  bc?: { regime: 'LFPIORPI' | 'CFF_RMF'; purpose: 'APPLICABILITY' | 'DETERMINATION'; requires_screening?: boolean };
  when_true: {
    applicability: 'APLICA_SIN_AVISO' | 'APLICA_CON_AVISO';
    vulnerable_activity?: boolean;
    notice_required?: boolean;
    notice_type?: string;
    notice_channel?: string;
    requirement_label?: string;
    obligation?: {
      key: string;
      type: string;
      channel: string;
      deadline?: { kind: 'DAYS_AFTER_LEGAL_DATE'; days: number } | { kind: 'FIXED_DATE'; date: string };
    };
    document_requirements?: ComplianceDocumentRequirementDefinition[];
  };
};

export type ComplianceDocumentRequirementDefinition = {
  key: string;
  label: string;
  category: 'IDENTIFICACION' | 'PERSONAS_MORALES' | 'FORMATOS' | 'CUESTIONARIOS_RIESGO' | 'BENEFICIARIO_CONTROLADOR' | 'PAGOS_EVIDENCIAS' | 'AVISOS_ACUSES' | 'REVISIONES';
  source: 'COMPARECIENTE' | 'EXPEDIENTE' | 'FORMAT_GENERATED' | 'FUTURE_MODULE';
  target_scope: 'EXPEDIENTE' | 'EACH_RELEVANT_COMPARECIENTE';
  expected_document_type?: string;
  requires_signed_document?: boolean;
  requires_human_validation?: boolean;
  action: 'GO_TO_COMPARECIENTE' | 'GO_TO_QUESTIONNAIRE' | 'GO_TO_BENEFICIAL_OWNER' | 'UPLOAD_SIGNED' | 'UPLOAD_DOCUMENT' | 'GO_TO_PAYMENT_EVIDENCE' | 'GO_TO_NOTICE';
  action_target?: Record<string, unknown>;
};

export type LegalRuleRevisionInput = {
  id: string;
  rule_id: string;
  stable_key: string;
  family: string;
  version: number;
  checksum: string;
  legal_basis: string;
  conditions: LegalCondition;
  outcome: LegalRuleOutcome;
};

export type RuleEvaluation = {
  ruleRevisionId: string;
  ruleId: string;
  stableKey: string;
  family: string;
  version: number;
  checksum: string;
  truth: TruthValue;
  missingPaths: string[];
  applicability: 'NO_APLICA' | 'APLICA_SIN_AVISO' | 'APLICA_CON_AVISO' | 'INFORMACION_INCOMPLETA';
  vulnerableActivity: boolean | null;
  noticeRequired: boolean | null;
  noticeType: string | null;
  noticeChannel: string | null;
  requirementLabel: string;
  obligation: LegalRuleOutcome['when_true']['obligation'] | null;
  documentRequirements: ComplianceDocumentRequirementDefinition[];
  legalBasis: string;
};

export function selectEffectiveRuleRevisions<T extends { rule_id: string; version: number }>(revisions: T[]): T[] {
  const selected = new Map<string, T>();
  for (const revision of revisions) {
    const current = selected.get(revision.rule_id);
    if (!current || revision.version > current.version) selected.set(revision.rule_id, revision);
  }
  return [...selected.values()].sort((left, right) => left.rule_id.localeCompare(right.rule_id));
}

type Evaluation = { value: TruthValue; missing: Set<string> };

const missing = (path: string): Evaluation => ({ value: 'UNKNOWN', missing: new Set([path]) });
const known = (value: boolean): Evaluation => ({ value: value ? 'TRUE' : 'FALSE', missing: new Set() });

export function valueAtPath(source: unknown, path: string): { found: boolean; value?: unknown } {
  if (!path.trim()) return { found: true, value: source };
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object' || !(part in current)) return { found: false };
    current = (current as Record<string, unknown>)[part];
  }
  return current === undefined || current === null ? { found: false } : { found: true, value: current };
}

function compare(condition: Exclude<Extract<LegalCondition, { path: string }>, { op: 'array_some' }>, context: unknown): Evaluation {
  const resolved = valueAtPath(context, condition.path);
  if (!resolved.found) return missing(condition.path);
  if (condition.op === 'exists') return known(true);
  if (condition.op === 'equals') return known(Object.is(resolved.value, condition.value));
  if (condition.op === 'in') return known(condition.values.some((value) => Object.is(value, resolved.value)));
  // H4 facts carry Decimal values; do not pass them through display/Number rounding.
  if (Prisma.Decimal.isDecimal(resolved.value) && typeof condition.value === 'number') {
    return known(condition.op === 'gte' ? resolved.value.gte(condition.value) : resolved.value.lte(condition.value));
  }
  if (typeof resolved.value !== 'number' || typeof condition.value !== 'number') return missing(condition.path);
  return known(condition.op === 'gte' ? resolved.value >= condition.value : resolved.value <= condition.value);
}

export function evaluateCondition(condition: LegalCondition, context: unknown): Evaluation {
  if (condition.op === 'exists' || condition.op === 'equals' || condition.op === 'in' || condition.op === 'gte' || condition.op === 'lte') {
    return compare(condition, context);
  }
  if (condition.op === 'not') {
    const evaluated = evaluateCondition(condition.rule, context);
    return { value: evaluated.value === 'UNKNOWN' ? 'UNKNOWN' : evaluated.value === 'TRUE' ? 'FALSE' : 'TRUE', missing: evaluated.missing };
  }
  if (condition.op === 'array_some') {
    const resolved = valueAtPath(context, condition.path);
    if (!resolved.found || !Array.isArray(resolved.value)) return missing(condition.path);
    const results = resolved.value.map((item) => evaluateCondition(condition.rule, item));
    if (results.some((result) => result.value === 'TRUE')) return known(true);
    const unknown = results.filter((result) => result.value === 'UNKNOWN');
    return unknown.length ? { value: 'UNKNOWN', missing: new Set(unknown.flatMap((item) => [...item.missing].map((path) => `${condition.path}[].${path}`))) } : known(false);
  }
  if (condition.op !== 'all' && condition.op !== 'any') throw new Error('Unsupported legal condition');
  const results: Evaluation[] = condition.rules.map((rule: LegalCondition) => evaluateCondition(rule, context));
  const collected = new Set(results.flatMap((result) => [...result.missing]));
  if (condition.op === 'all') {
    if (results.some((result) => result.value === 'FALSE')) return known(false);
    return results.some((result) => result.value === 'UNKNOWN') ? { value: 'UNKNOWN', missing: collected } : known(true);
  }
  if (results.some((result) => result.value === 'TRUE')) return known(true);
  return results.some((result) => result.value === 'UNKNOWN') ? { value: 'UNKNOWN', missing: collected } : known(false);
}

export function evaluateLegalRule(revision: LegalRuleRevisionInput, context: unknown): RuleEvaluation {
  const evaluated = evaluateCondition(revision.conditions, context);
  const outcome = revision.outcome.when_true;
  const applicable = evaluated.value === 'TRUE';
  return {
    ruleRevisionId: revision.id,
    ruleId: revision.rule_id,
    stableKey: revision.stable_key,
    family: revision.family,
    version: revision.version,
    checksum: revision.checksum,
    truth: evaluated.value,
    missingPaths: [...evaluated.missing].sort(),
    applicability: evaluated.value === 'UNKNOWN' ? 'INFORMACION_INCOMPLETA' : applicable ? outcome.applicability : 'NO_APLICA',
    vulnerableActivity: evaluated.value === 'UNKNOWN' ? null : applicable ? Boolean(outcome.vulnerable_activity) : false,
    noticeRequired: evaluated.value === 'UNKNOWN' ? null : applicable ? Boolean(outcome.notice_required) : false,
    noticeType: applicable ? outcome.notice_type || null : null,
    noticeChannel: applicable ? outcome.notice_channel || null : null,
    requirementLabel: outcome.requirement_label || `Revisar ${revision.stable_key}`,
    obligation: applicable ? outcome.obligation || null : null,
    documentRequirements: applicable && Boolean(outcome.vulnerable_activity) ? outcome.document_requirements || [] : [],
    legalBasis: revision.legal_basis,
  };
}

export function calculateLegalDeadline(
  deadline: NonNullable<NonNullable<LegalRuleOutcome['when_true']['obligation']>['deadline']> | undefined,
  legalDate: Date | null,
): { deadline: Date | null; source: string | null } {
  if (!deadline) return { deadline: null, source: null };
  if (deadline.kind === 'FIXED_DATE') {
    const date = new Date(`${deadline.date}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? { deadline: null, source: null } : { deadline: date, source: 'REGLA_LEGAL_FECHA_FIJA' };
  }
  if (!legalDate || !Number.isInteger(deadline.days) || deadline.days < 0) return { deadline: null, source: null };
  const date = new Date(legalDate);
  date.setUTCDate(date.getUTCDate() + deadline.days);
  return { deadline: date, source: 'REGLA_LEGAL_DIAS_DESDE_FECHA_JURIDICA' };
}

export function deriveComplianceState(statuses: string[], deadlines: Array<Date | null>, now = new Date()): string {
  if (!statuses.length || statuses.every((status) => status === 'NO_APLICA')) return 'NO_APLICA';
  if (deadlines.some((deadline) => deadline && deadline.getTime() < now.getTime()) && statuses.some((status) => !['CUMPLIDO', 'NO_APLICA'].includes(status))) return 'VENCIDO';
  if (statuses.some((status) => status === 'BLOQUEADO_POR_FALTA_DATOS' || status === 'PENDIENTE')) return 'PENDIENTE';
  if (statuses.some((status) => status === 'EN_PROCESO')) return 'EN_PROCESO';
  if (statuses.every((status) => ['CUMPLIDO', 'NO_APLICA'].includes(status))) return 'CUMPLIMIENTO_COMPLETO';
  return 'LISTO';
}

export const complianceHumanLabels: Record<string, string> = {
  NO_APLICA: 'No aplica', PENDIENTE: 'Pendiente', EN_PROCESO: 'En proceso', LISTO: 'Listo',
  CUMPLIMIENTO_COMPLETO: 'Cumplimiento completo', VENCIDO: 'Vencido',
  APLICA_SIN_AVISO: 'Aplica sin aviso', APLICA_CON_AVISO: 'Aplica con aviso',
  INFORMACION_INCOMPLETA: 'Información incompleta', BLOQUEADO_POR_FALTA_DATOS: 'Pendiente de información',
};
