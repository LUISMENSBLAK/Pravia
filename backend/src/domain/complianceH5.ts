import { createHash, createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ComplianceError } from "./compliance";

export type QuestionnaireScope = "GENERAL" | "PERSONAL";

/** Read-time freshness only: never rewrites a certified historical snapshot. */
export function paymentVerificationIsStale(verification: any, current: {
  currentReview: boolean;
  paymentRevisionId: string;
  paymentFingerprint: string;
  project: { id: string; checksum: string | null } | null;
  payments: Array<{ id: string; fingerprint: string }>;
  evidence: Array<{ id: string; document_id: string; version: string | null; checksum: string | null }>;
  rules: Array<{ id: string; revision_id: string; checksum: string }>;
  ruleConfigurationFingerprint?: string;
}) {
  const snapshot = verification.comparison_snapshot;
  if (!snapshot || !current.currentReview || verification.payment_revision_id !== current.paymentRevisionId ||
    snapshot.payment_revision_fingerprint !== current.paymentFingerprint || !current.project ||
    verification.project_document_id !== current.project.id || !current.project.checksum ||
    verification.project_document_checksum !== current.project.checksum) return true;
  if (current.ruleConfigurationFingerprint && snapshot.rule_configuration_fingerprint !== current.ruleConfigurationFingerprint) return true;
  const ordered = (items: Array<{ id: string }>) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  return !Array.isArray(snapshot.confirmed_payments) || !Array.isArray(snapshot.evidence) || !Array.isArray(snapshot.rules) ||
    semanticFingerprint(ordered(snapshot.confirmed_payments)) !== semanticFingerprint(ordered(current.payments)) ||
    semanticFingerprint(ordered(snapshot.evidence)) !== semanticFingerprint(ordered(current.evidence)) ||
    semanticFingerprint(ordered(snapshot.rules)) !== semanticFingerprint(ordered(current.rules));
}
export type QuestionType =
  | "TEXT"
  | "NUMBER"
  | "BOOLEAN"
  | "DATE"
  | "CHOICE"
  | "MULTI_CHOICE";
export type QuestionnaireCondition = {
  question_id: string;
  op: "EQUALS" | "NOT_EQUALS" | "IN" | "EXISTS";
  value?: unknown;
  values?: unknown[];
};
export type QuestionnaireQuestion = {
  id: string;
  label: string;
  type: QuestionType;
  required?: boolean;
  required_when?: QuestionnaireCondition;
  options?: Array<{ code: string; label: string }>;
  validation?: {
    min?: string;
    max?: string;
    pattern?: string;
    min_items?: number;
    max_items?: number;
  };
};
export type QuestionnaireDefinition = {
  schema_version: 1;
  scope: QuestionnaireScope;
  sections: Array<{
    id: string;
    label: string;
    questions?: QuestionnaireQuestion[];
    repeatable_groups?: Array<{
      id: string;
      label: string;
      min_items?: number;
      max_items?: number;
      questions: QuestionnaireQuestion[];
    }>;
  }>;
};

export type RiskCondition =
  | { op: "ALL" | "ANY"; conditions: RiskCondition[] }
  | { op: "NOT"; condition: RiskCondition }
  | { op: "EXISTS"; question_id: string }
  | { op: "EQUALS" | "GTE" | "LTE"; question_id: string; value: unknown }
  | { op: "IN"; question_id: string; values: unknown[] };

export type RiskMethodologyDsl = {
  schema_version: 1;
  outputs: Array<{
    code: string;
    label: string;
    when: RiskCondition;
    factors?: Record<string, unknown>;
  }>;
};

const QUESTION_TYPES = new Set<QuestionType>([
  "TEXT",
  "NUMBER",
  "BOOLEAN",
  "DATE",
  "CHOICE",
  "MULTI_CHOICE",
]);
const CONDITION_OPS = new Set(["EQUALS", "NOT_EQUALS", "IN", "EXISTS"]);

export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Prisma.Decimal.isDecimal(value)) return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const semanticFingerprint = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

function allQuestions(definition: QuestionnaireDefinition) {
  return definition.sections.flatMap((section) => [
    ...(section.questions || []).map((question) => ({
      ...question,
      group_id: null as string | null,
    })),
    ...(section.repeatable_groups || []).flatMap((group) =>
      group.questions.map((question) => ({ ...question, group_id: group.id })),
    ),
  ]);
}

export function validateQuestionnaireDefinition(
  input: unknown,
): QuestionnaireDefinition {
  const definition = input as QuestionnaireDefinition;
  if (
    !definition ||
    definition.schema_version !== 1 ||
    !["GENERAL", "PERSONAL"].includes(definition.scope) ||
    !Array.isArray(definition.sections) ||
    !definition.sections.length
  ) {
    throw new ComplianceError(
      "La definición estructurada del cuestionario no es válida.",
      "QUESTIONNAIRE_DEFINITION_INVALID",
    );
  }
  const ids = new Set<string>();
  const sectionIds = new Set<string>();
  if (definition.sections.some((section) => !section ||
    section.questions !== undefined && !Array.isArray(section.questions) ||
    section.repeatable_groups !== undefined && (!Array.isArray(section.repeatable_groups) ||
      section.repeatable_groups.some((group) => !group || !Array.isArray(group.questions)))))
    throw new ComplianceError("Las secciones estructuradas no son válidas.", "QUESTIONNAIRE_DEFINITION_INVALID");
  const questions = allQuestions(definition);
  for (const section of definition.sections) {
    if (
      !section.id?.trim() ||
      !section.label?.trim() ||
      sectionIds.has(section.id)
    )
      throw new ComplianceError(
        "Las secciones requieren IDs estables únicos.",
        "QUESTIONNAIRE_SECTION_ID_INVALID",
      );
    sectionIds.add(section.id);
    for (const group of section.repeatable_groups || []) {
      if (
        !group.id?.trim() ||
        ids.has(group.id) ||
        (group.min_items ?? 0) < 0 ||
        (group.max_items ?? Infinity) < (group.min_items ?? 0)
      )
        throw new ComplianceError(
          "El grupo repetible no es válido.",
          "QUESTIONNAIRE_REPEATABLE_INVALID",
        );
      ids.add(group.id);
    }
  }
  for (const question of questions) {
    if (
      !question.id?.trim() ||
      ids.has(question.id) ||
      !question.label?.trim() ||
      !QUESTION_TYPES.has(question.type)
    )
      throw new ComplianceError(
        "Las preguntas requieren IDs estables únicos y tipos soportados.",
        "QUESTIONNAIRE_QUESTION_INVALID",
      );
    ids.add(question.id);
    if (question.type === "CHOICE" || question.type === "MULTI_CHOICE") {
      if (
        !question.options?.length ||
        new Set(question.options.map((option) => option.code)).size !==
          question.options.length
      )
        throw new ComplianceError(
          "Las opciones configuradas no son válidas.",
          "QUESTIONNAIRE_OPTIONS_INVALID",
        );
      if (question.options.some((option) => !option.code?.trim() || !option.label?.trim()))
        throw new ComplianceError("Las opciones requieren código y etiqueta.", "QUESTIONNAIRE_OPTIONS_INVALID");
    }
    const validation = question.validation;
    if (validation) {
      try {
        for (const value of [validation.min, validation.max])
          if (value !== undefined && !new Prisma.Decimal(value).isFinite()) throw new Error("bound");
        if (validation.min !== undefined && validation.max !== undefined && new Prisma.Decimal(validation.min).gt(validation.max)) throw new Error("range");
        for (const value of [validation.min_items, validation.max_items])
          if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error("items");
        if (validation.min_items !== undefined && validation.max_items !== undefined && validation.min_items > validation.max_items) throw new Error("range");
        // A single anchored character class is linear-time; no arbitrary regex execution.
        if (validation.pattern !== undefined && !/^\^\[[A-Za-z0-9\\\- ]+\](?:[+*?]|\{\d+(?:,\d*)?\})?\$$/.test(validation.pattern)) throw new Error("pattern");
        if (validation.pattern) new RegExp(validation.pattern, "u");
      } catch {
        throw new ComplianceError("Las restricciones de validación no son compatibles.", "QUESTIONNAIRE_VALIDATION_INVALID");
      }
    }
  }
  const questionIds = new Set(questions.map((question) => question.id));
  for (const question of questions) {
    const condition = question.required_when;
    if (!condition) continue;
    if (
      !questionIds.has(condition.question_id) ||
      condition.question_id === question.id ||
      !CONDITION_OPS.has(condition.op) ||
      questions.some((referenced) => referenced.id === condition.question_id && referenced.group_id && referenced.group_id !== question.group_id) ||
      (condition.op === "IN" && !Array.isArray(condition.values))
    ) {
      throw new ComplianceError(
        "Una condición referencia una pregunta inválida.",
        "QUESTIONNAIRE_CONDITION_INVALID",
      );
    }
  }
  const dependencies = new Map(
    questions.map((question) => [
      question.id,
      question.required_when?.question_id
        ? [question.required_when.question_id]
        : [],
    ]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id))
      throw new ComplianceError(
        "Las condiciones del cuestionario contienen un ciclo.",
        "QUESTIONNAIRE_CONDITION_CYCLE",
      );
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of dependencies.keys()) visit(id);
  return definition;
}

function conditionMatches(
  condition: QuestionnaireCondition | undefined,
  answers: Record<string, unknown>,
): boolean {
  if (!condition) return false;
  const actual = answers[condition.question_id];
  if (condition.op === "EXISTS")
    return actual !== undefined && actual !== null && actual !== "";
  if (condition.op === "EQUALS")
    return canonicalJson(actual) === canonicalJson(condition.value);
  if (condition.op === "NOT_EQUALS")
    return canonicalJson(actual) !== canonicalJson(condition.value);
  return (condition.values || []).some(
    (value) => canonicalJson(value) === canonicalJson(actual),
  );
}

function answered(question: QuestionnaireQuestion, value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (question.type === "MULTI_CHOICE")
    return Array.isArray(value) && value.length > 0 &&
      new Set(value).size === value.length &&
      value.every((item) => question.options?.some((option) => option.code === item)) &&
      value.length >= (question.validation?.min_items ?? 0) &&
      value.length <= (question.validation?.max_items ?? Infinity);
  if (question.type === "NUMBER") {
    try {
      if (typeof value !== "string" && typeof value !== "number") return false;
      const numeric = new Prisma.Decimal(String(value));
      return numeric.isFinite() &&
        (question.validation?.min === undefined || numeric.gte(question.validation.min)) &&
        (question.validation?.max === undefined || numeric.lte(question.validation.max));
    } catch {
      return false;
    }
  }
  if (question.type === "BOOLEAN") return typeof value === "boolean";
  if (question.type === "DATE")
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(new Date(value).getTime()) && new Date(value).toISOString().slice(0, 10) === value;
  if (question.type === "CHOICE") return question.options?.some((option) => option.code === value) === true;
  if (typeof value !== "string" || !value.trim() || value.length > 10000) return false;
  if (question.validation?.min !== undefined && new Prisma.Decimal(value.length).lt(question.validation.min)) return false;
  if (question.validation?.max !== undefined && new Prisma.Decimal(value.length).gt(question.validation.max)) return false;
  return !question.validation?.pattern || new RegExp(question.validation.pattern, "u").test(value);
}

export function questionnaireCompleteness(
  definitionInput: unknown,
  answersInput: unknown,
) {
  const definition = validateQuestionnaireDefinition(definitionInput);
  const answers = (
    answersInput &&
    typeof answersInput === "object" &&
    !Array.isArray(answersInput)
      ? answersInput
      : {}
  ) as Record<string, unknown>;
  const missing = new Set<string>();
  const declaredIds = new Set(definition.sections.flatMap((section) => [
    ...(section.questions || []).map((question) => question.id),
    ...(section.repeatable_groups || []).map((group) => group.id),
  ]));
  if (Object.keys(answers).some((id) => !declaredIds.has(id)))
    throw new ComplianceError("Hay respuestas ajenas a la definición fijada.", "QUESTIONNAIRE_ANSWER_ID_INVALID");
  for (const section of definition.sections) {
    for (const question of section.questions || []) {
      if (
        (question.required || answers[question.id] !== undefined && answers[question.id] !== null && answers[question.id] !== "" ||
          conditionMatches(question.required_when, answers)) &&
        !answered(question, answers[question.id])
      )
        missing.add(question.id);
    }
    for (const group of section.repeatable_groups || []) {
      if (answers[group.id] != null && !Array.isArray(answers[group.id]))
        throw new ComplianceError("El grupo de respuestas debe contener filas.", "QUESTIONNAIRE_REPEATABLE_INVALID");
      const rows = Array.isArray(answers[group.id])
        ? (answers[group.id] as Record<string, unknown>[])
        : [];
      if (rows.length < (group.min_items || 0)) missing.add(group.id);
      if (group.max_items !== undefined && rows.length > group.max_items)
        throw new ComplianceError(
          "El grupo repetible excede el máximo configurado.",
          "QUESTIONNAIRE_REPEATABLE_MAX",
        );
      rows.forEach((row, index) => {
        if (!row || typeof row !== "object" || Array.isArray(row) ||
          Object.keys(row).some((id) => !group.questions.some((question) => question.id === id)))
          throw new ComplianceError("Una fila contiene respuestas ajenas a su definición.", "QUESTIONNAIRE_ANSWER_ID_INVALID");
        group.questions.forEach((question) => {
          if (
            (question.required || row[question.id] !== undefined && row[question.id] !== null && row[question.id] !== "" ||
              conditionMatches(question.required_when, { ...answers, ...row })) &&
            !answered(question, row[question.id])
          )
            missing.add(`${group.id}[${index}].${question.id}`);
        });
      });
    }
  }
  return {
    completeness: missing.size
      ? ("INCOMPLETE" as const)
      : ("COMPLETE" as const),
    missing_question_ids: [...missing].sort(),
  };
}

function riskCondition(
  condition: RiskCondition,
  answers: Record<string, unknown>,
  depth = 0,
): boolean {
  if (depth > 20 || !condition || typeof condition !== "object")
    throw new ComplianceError(
      "La metodología contiene una condición inválida.",
      "RISK_METHODOLOGY_INVALID",
    );
  if (condition.op === "ALL" || condition.op === "ANY") {
    if (!Array.isArray(condition.conditions) || !condition.conditions.length)
      throw new ComplianceError(
        "La condición compuesta no puede estar vacía.",
        "RISK_METHODOLOGY_INVALID",
      );
    const values = condition.conditions.map((item) =>
      riskCondition(item, answers, depth + 1),
    );
    return condition.op === "ALL"
      ? values.every(Boolean)
      : values.some(Boolean);
  }
  if (condition.op === "NOT")
    return !riskCondition(condition.condition, answers, depth + 1);
  const leaf = condition as Exclude<
    RiskCondition,
    { op: "ALL" | "ANY" } | { op: "NOT" }
  >;
  const actual = answers[leaf.question_id];
  if (leaf.op === "EXISTS")
    return actual !== undefined && actual !== null && actual !== "";
  if (leaf.op === "EQUALS")
    return canonicalJson(actual) === canonicalJson(leaf.value);
  if (leaf.op === "IN")
    return leaf.values.some(
      (value) => canonicalJson(value) === canonicalJson(actual),
    );
  try {
    const left = new Prisma.Decimal(String(actual));
    const right = new Prisma.Decimal(String(leaf.value));
    return leaf.op === "GTE"
      ? left.greaterThanOrEqualTo(right)
      : left.lessThanOrEqualTo(right);
  } catch {
    return false;
  }
}

export function evaluateRiskMethodology(
  input: unknown,
  answers: Record<string, unknown>,
) {
  const methodology = validateRiskMethodology(input);
  if (
    !methodology ||
    methodology.schema_version !== 1 ||
    !Array.isArray(methodology.outputs) ||
    !methodology.outputs.length
  )
    throw new ComplianceError(
      "La metodología de riesgo no es válida.",
      "RISK_METHODOLOGY_INVALID",
    );
  const codes = new Set<string>();
  for (const output of methodology.outputs) {
    if (!output.code?.trim() || !output.label?.trim() || codes.has(output.code))
      throw new ComplianceError(
        "Las salidas de metodología no son válidas.",
        "RISK_METHODOLOGY_OUTPUT_INVALID",
      );
    codes.add(output.code);
  }
  const matches = methodology.outputs.filter((output) =>
    riskCondition(output.when, answers),
  );
  if (matches.length === 0)
    throw new ComplianceError(
      "La metodología no produjo una salida.",
      "RISK_METHODOLOGY_ZERO_OUTPUT",
      409,
    );
  if (matches.length > 1)
    throw new ComplianceError(
      "La metodología produjo resultados ambiguos.",
      "RISK_METHODOLOGY_MULTIPLE_OUTPUTS",
      409,
    );
  return {
    output_code: matches[0].code,
    output_label: matches[0].label,
    factor_breakdown: matches[0].factors || {},
  };
}

export function validateRiskMethodology(input: unknown, definitionInput?: unknown) {
  const methodology = input as RiskMethodologyDsl;
  const definition = definitionInput ? validateQuestionnaireDefinition(definitionInput) : null;
  const questions = definition ? allQuestions(definition) : null;
  if (
    !methodology ||
    methodology.schema_version !== 1 ||
    !Array.isArray(methodology.outputs) ||
    !methodology.outputs.length
  )
    throw new ComplianceError(
      "La metodología de riesgo no es válida.",
      "RISK_METHODOLOGY_INVALID",
    );
  const codes = new Set<string>();
  const validateCondition = (condition: RiskCondition, depth = 0): void => {
    if (!condition || typeof condition !== "object" || depth > 20)
      throw new ComplianceError(
        "La metodología contiene una condición inválida.",
        "RISK_METHODOLOGY_INVALID",
      );
    if (condition.op === "ALL" || condition.op === "ANY") {
      if (!Array.isArray(condition.conditions) || !condition.conditions.length)
        throw new ComplianceError(
          "La condición compuesta no puede estar vacía.",
          "RISK_METHODOLOGY_INVALID",
        );
      condition.conditions.forEach((item) =>
        validateCondition(item, depth + 1),
      );
      return;
    }
    if (condition.op === "NOT") {
      validateCondition(condition.condition, depth + 1);
      return;
    }
    const leaf = condition as Exclude<
      RiskCondition,
      { op: "ALL" | "ANY" } | { op: "NOT" }
    >;
    if (
      !leaf.question_id?.trim() ||
      !["EXISTS", "EQUALS", "GTE", "LTE", "IN"].includes(leaf.op)
    )
      throw new ComplianceError(
        "La condición usa un operador no soportado.",
        "RISK_METHODOLOGY_INVALID",
      );
    if (leaf.op === "IN" && !Array.isArray(leaf.values))
      throw new ComplianceError(
        "La condición IN requiere valores.",
        "RISK_METHODOLOGY_INVALID",
      );
    if (questions && !questions.some((question) => question.id === leaf.question_id))
      throw new ComplianceError("La metodología referencia una pregunta no declarada.", "RISK_METHODOLOGY_QUESTION_INVALID");
    if (questions?.some((question) => question.id === leaf.question_id && question.group_id))
      throw new ComplianceError("Una respuesta repetible requiere una semántica de agregación explícita; no puede evaluarse como respuesta única.", "RISK_METHODOLOGY_REPEATABLE_REFERENCE_UNSUPPORTED");
  };
  for (const output of methodology.outputs) {
    if (!output.code?.trim() || !output.label?.trim() || codes.has(output.code))
      throw new ComplianceError(
        "Las salidas de metodología no son válidas.",
        "RISK_METHODOLOGY_OUTPUT_INVALID",
      );
    codes.add(output.code);
    validateCondition(output.when);
  }
  return methodology;
}

export function accountSafeValues(raw: unknown, secret: string) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return { account_last4: null, account_fingerprint: null };
  return {
    account_last4: digits.slice(-4).padStart(4, "0"),
    account_fingerprint: createHmac("sha256", secret)
      .update(digits)
      .digest("hex"),
  };
}

export function comparePaymentFacts(input: {
  consideration?: Prisma.Decimal | string | null;
  payments: Array<Prisma.Decimal | string>;
  instrument_paid?: Prisma.Decimal | string | null;
  instrument_pending?: Prisma.Decimal | string | null;
}) {
  const sum = input.payments.reduce<Prisma.Decimal>(
    (total, value) => total.plus(new Prisma.Decimal(value)),
    new Prisma.Decimal(0),
  );
  const consideration =
    input.consideration == null
      ? null
      : new Prisma.Decimal(input.consideration);
  const declaredPaid =
    input.instrument_paid == null
      ? null
      : new Prisma.Decimal(input.instrument_paid);
  const declaredPending =
    input.instrument_pending == null
      ? null
      : new Prisma.Decimal(input.instrument_pending);
  const observations: string[] = [];
  if (consideration && !consideration.equals(sum))
    observations.push("PAYMENTS_DIFFER_FROM_CONFIRMED_CONSIDERATION");
  if (declaredPaid && !declaredPaid.equals(sum))
    observations.push("PAYMENTS_DIFFER_FROM_INSTRUMENT_PAID");
  if (
    consideration &&
    declaredPaid &&
    declaredPending &&
    !declaredPaid.plus(declaredPending).equals(consideration)
  )
    observations.push("INSTRUMENT_BALANCE_DOES_NOT_RECONCILE");
  return {
    payments_total: sum.toFixed(6),
    status: observations.length ? ("OBSERVATION" as const) : ("MATCH" as const),
    observations,
  };
}

export function paymentSemanticFingerprint(input: Record<string, unknown>) {
  const semantic = { ...input };
  delete semantic.actor_id;
  delete semantic.request_id;
  delete semantic.created_at;
  delete semantic.updated_at;
  return semanticFingerprint(semantic);
}

export type PaymentExtractionField = {
  campo: string;
  valor: string;
  confianza: "LECTURA_CLARA" | "LECTURA_DUDOSA" | "LECTURA_DEFICIENTE";
  pagina?: number | null;
  fragmento?: string | null;
};

export type PaymentExtractionSource = {
  document_id: string;
  version: string;
  checksum: string;
  model: string;
  fields: PaymentExtractionField[];
  missing: string[];
  conflicts: Array<{ campo: string; detalle: string }>;
};

const H5_PAYMENT_AI_FIELD_MAP: Record<string, string> = {
  monto: "amount_original",
  fecha: "payment_date",
  referencia: "reference",
  forma_pago: "method_raw",
  beneficiario: "payee_raw",
  moneda: "currency_original",
  institucion: "institution",
  ordenante: "payer_raw",
  cuenta: "account_number",
  pagado: "declared_paid",
  pendiente: "declared_pending",
};

/**
 * Combina propuestas documentales sin elegir silenciosamente entre valores
 * incompatibles. La salida conserva procedencia por campo y nunca incluye
 * conceptos contables ni respuestas de cuestionarios.
 */
export function mergePaymentDocumentExtractions(
  sources: PaymentExtractionSource[],
) {
  const candidates = new Map<
    string,
    Array<{
      value: string;
      state: "PRESENT";
      document_id: string;
      version: string;
      checksum: string;
      page: number | null;
      locator: string | null;
      confidence: PaymentExtractionField["confianza"];
      model: string;
    }>
  >();
  const uncertain = new Set<string>();
  const explicitlyMissing = new Set<string>();
  for (const source of sources) {
    for (const missing of source.missing) {
      const target = H5_PAYMENT_AI_FIELD_MAP[missing];
      if (target) explicitlyMissing.add(target);
    }
    for (const conflict of source.conflicts) {
      const target = H5_PAYMENT_AI_FIELD_MAP[conflict.campo];
      if (target) uncertain.add(target);
    }
    for (const field of source.fields) {
      const target = H5_PAYMENT_AI_FIELD_MAP[field.campo];
      const value = String(field.valor ?? "").trim();
      if (!target || !value) continue;
      const entries = candidates.get(target) || [];
      entries.push({
        value,
        state: "PRESENT",
        document_id: source.document_id,
        version: source.version,
        checksum: source.checksum,
        page: field.pagina ?? null,
        locator: field.fragmento ?? null,
        confidence: field.confianza,
        model: source.model,
      });
      candidates.set(target, entries);
      if (field.confianza !== "LECTURA_CLARA") uncertain.add(target);
    }
  }
  const content: Record<string, string> = {};
  const fieldStates: Record<string, { state: "PRESENT" | "ABSENT" | "UNCERTAIN" }> = {};
  const provenance: Record<string, unknown[]> = {};
  for (const target of Object.values(H5_PAYMENT_AI_FIELD_MAP)) {
    const entries = candidates.get(target) || [];
    provenance[target] = entries;
    const distinct = [...new Set(entries.map((item) => item.value))];
    if (uncertain.has(target) || distinct.length > 1) {
      fieldStates[target] = { state: "UNCERTAIN" };
    } else if (distinct.length === 1) {
      content[target] = distinct[0];
      fieldStates[target] = { state: "PRESENT" };
    } else if (explicitlyMissing.has(target)) {
      fieldStates[target] = { state: "ABSENT" };
    } else {
      fieldStates[target] = { state: "UNCERTAIN" };
    }
  }
  return { content: { ...content, field_states: fieldStates }, provenance };
}
