import { describe, expect, it } from "vitest";
import {
  accountSafeValues,
  canonicalJson,
  comparePaymentFacts,
  evaluateRiskMethodology,
  mergePaymentDocumentExtractions,
  paymentSemanticFingerprint,
  paymentVerificationIsStale,
  questionnaireCompleteness,
  semanticFingerprint,
  validateQuestionnaireDefinition,
  validateRiskMethodology,
} from "./complianceH5";

const definition = {
  schema_version: 1 as const,
  scope: "GENERAL" as const,
  sections: [
    {
      id: "identity",
      label: "Identidad",
      questions: [
        {
          id: "has_origin",
          label: "¿Existe origen?",
          type: "BOOLEAN" as const,
          required: true,
        },
        {
          id: "origin",
          label: "Origen",
          type: "TEXT" as const,
          required_when: {
            question_id: "has_origin",
            op: "EQUALS" as const,
            value: true,
          },
        },
      ],
      repeatable_groups: [
        {
          id: "transfers",
          label: "Transferencias",
          min_items: 1,
          max_items: 2,
          questions: [
            {
              id: "amount",
              label: "Importe",
              type: "NUMBER" as const,
              required: true,
            },
          ],
        },
      ],
    },
  ],
};

describe("H5 historical verification freshness", () => {
  const current = { currentReview: true, paymentRevisionId: "revision-a", paymentFingerprint: "fingerprint-a",
    project: { id: "project-a", checksum: "checksum-a" }, payments: [{ id: "revision-a", fingerprint: "fingerprint-a" }],
    evidence: [{ id: "evidence-a", document_id: "receipt-a", version: "v1", checksum: "checksum-r" }],
    rules: [{ id: "result-a", revision_id: "rule-a", checksum: "checksum-rule" }] };
  const record = { payment_revision_id: "revision-a", project_document_id: "project-a", project_document_checksum: "checksum-a",
    comparison_snapshot: { payment_revision_fingerprint: "fingerprint-a", confirmed_payments: current.payments, evidence: current.evidence, rules: current.rules } };
  it("retains current verification without mutating the stored snapshot", () => {
    const before = JSON.stringify(record);
    expect(paymentVerificationIsStale(record, current)).toBe(false);
    expect(JSON.stringify(record)).toBe(before);
  });
  it("detects a newly configured legal revision even before a new rule result is materialized", () => {
    const stored = { ...record, comparison_snapshot: { ...record.comparison_snapshot, rule_configuration_fingerprint: "old-config" } };
    expect(paymentVerificationIsStale(stored, { ...current, ruleConfigurationFingerprint: "new-config" })).toBe(true);
    expect(paymentVerificationIsStale(stored, { ...current, ruleConfigurationFingerprint: "old-config" })).toBe(false);
  });
  it.each([
    { currentReview: false }, { paymentRevisionId: "revision-b" }, { paymentFingerprint: "changed" },
    { project: null }, { project: { id: "project-a", checksum: "changed" } },
    { payments: [] }, { evidence: [] }, { rules: [] },
    { evidence: [{ ...current.evidence[0], version: "v2" }] },
    { rules: [{ ...current.rules[0], checksum: "changed" }] },
  ])("marks changed semantic inputs stale: %j", (change) => {
    expect(paymentVerificationIsStale(record, { ...current, ...change })).toBe(true);
  });
});

describe("H5 questionnaire and payment deterministic domain", () => {
  it("rejects a repeatable child as a scalar risk factor instead of silently evaluating an absent root value", () => {
    expect(() => validateRiskMethodology({ schema_version: 1, outputs: [{ code: "TEST", label: "Synthetic only", when: { op: "EXISTS", question_id: "amount" } }] }, definition)).toThrow(/agregación explícita/);
  });
  it("includes exact dates and normalizes Decimal representation in semantic fingerprints", () => {
    expect(semanticFingerprint({ date: new Date("2026-01-01") })).not.toBe(semanticFingerprint({ date: new Date("2026-01-02") }));
    expect(paymentSemanticFingerprint({ payment_date: new Date("2026-01-01"), actor_id: "a" })).toBe(paymentSemanticFingerprint({ payment_date: new Date("2026-01-01"), actor_id: "b" }));
  });
  it("rejects undeclared response IDs", () => {
    expect(() => questionnaireCompleteness(definition, { foreign: true })).toThrow(/ajenas/i);
  });
  it.each(["NaN", "Infinity", {}, true])("does not accept invalid numeric answer %s", (amount) => {
    expect(questionnaireCompleteness(definition, { has_origin: false, transfers: [{ amount }] }).completeness).toBe("INCOMPLETE");
  });
  it("rejects a methodology referencing an undeclared stable question", () => {
    expect(() => validateRiskMethodology({ schema_version: 1, outputs: [{ code: "TEST", label: "Sintético", when: { op: "EXISTS", question_id: "not-declared" } }] }, definition)).toThrow(/no declarada/);
  });
  it("does not evaluate unsupported DSL operators as numeric comparisons", () => {
    expect(() => evaluateRiskMethodology({ schema_version: 1, outputs: [{ code: "TEST", label: "Sintético", when: { op: "EXECUTE", question_id: "amount", value: 10 } }] }, { amount: 1 })).toThrow(/no soportado/);
  });
  it("canonicalizes objects independently of key insertion order", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(semanticFingerprint({ b: 2, a: 1 })).toBe(
      semanticFingerprint({ a: 1, b: 2 }),
    );
  });

  it("accepts a structured definition with stable IDs and repeatable blocks", () => {
    expect(validateQuestionnaireDefinition(definition)).toEqual(definition);
  });

  it("rejects duplicate stable question IDs", () => {
    const invalid = structuredClone(definition);
    invalid.sections[0].questions.push({
      id: "has_origin",
      label: "Duplicada",
      type: "BOOLEAN",
      required: true,
    } as any);
    expect(() => validateQuestionnaireDefinition(invalid)).toThrow(
      /IDs estables únicos/i,
    );
  });

  it("rejects conditional dependency cycles", () => {
    const invalid = {
      schema_version: 1,
      scope: "GENERAL",
      sections: [
        {
          id: "s",
          label: "S",
          questions: [
            {
              id: "a",
              label: "A",
              type: "TEXT",
              required_when: { question_id: "b", op: "EXISTS" },
            },
            {
              id: "b",
              label: "B",
              type: "TEXT",
              required_when: { question_id: "a", op: "EXISTS" },
            },
          ],
        },
      ],
    };
    expect(() => validateQuestionnaireDefinition(invalid)).toThrow(/ciclo/i);
  });

  it("keeps missing required, conditional and repeatable answers incomplete", () => {
    expect(questionnaireCompleteness(definition, { has_origin: true })).toEqual(
      {
        completeness: "INCOMPLETE",
        missing_question_ids: ["origin", "transfers"],
      },
    );
  });

  it("derives completeness from the exact definition and valid typed answers", () => {
    expect(
      questionnaireCompleteness(definition, {
        has_origin: true,
        origin: "Ahorro",
        transfers: [{ amount: "100.000001" }],
      }),
    ).toEqual({
      completeness: "COMPLETE",
      missing_question_ids: [],
    });
  });

  it("rejects repeatable groups beyond the configured maximum", () => {
    expect(() =>
      questionnaireCompleteness(definition, {
        has_origin: false,
        transfers: [{ amount: 1 }, { amount: 2 }, { amount: 3 }],
      }),
    ).toThrow(/máximo configurado/i);
  });

  it("validates and evaluates a closed deterministic risk DSL", () => {
    const methodology = {
      schema_version: 1,
      outputs: [
        {
          code: "SYNTH_A",
          label: "Sintético A",
          when: { op: "EQUALS", question_id: "flag", value: true },
        },
        {
          code: "SYNTH_B",
          label: "Sintético B",
          when: { op: "EQUALS", question_id: "flag", value: false },
        },
      ],
    };
    expect(validateRiskMethodology(methodology)).toEqual(methodology);
    expect(evaluateRiskMethodology(methodology, { flag: true })).toMatchObject({
      output_code: "SYNTH_A",
      output_label: "Sintético A",
    });
  });

  it("fails closed when the methodology produces zero outputs", () => {
    const methodology = {
      schema_version: 1,
      outputs: [
        {
          code: "A",
          label: "A",
          when: { op: "EQUALS", question_id: "flag", value: true },
        },
      ],
    };
    expect(() => evaluateRiskMethodology(methodology, { flag: false })).toThrow(
      /no produjo una salida/i,
    );
  });

  it("fails closed when the methodology produces multiple outputs", () => {
    const methodology = {
      schema_version: 1,
      outputs: [
        { code: "A", label: "A", when: { op: "EXISTS", question_id: "flag" } },
        {
          code: "B",
          label: "B",
          when: { op: "EQUALS", question_id: "flag", value: true },
        },
      ],
    };
    expect(() => evaluateRiskMethodology(methodology, { flag: true })).toThrow(
      /resultados ambiguos/i,
    );
  });

  it("stores only an HMAC fingerprint and last four account digits", () => {
    const result = accountSafeValues("0123-4567-8901", "synthetic-test-secret");
    expect(result.account_last4).toBe("8901");
    expect(result.account_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("012345678901");
  });

  it("uses Decimal reconciliation and reports observations without legal conclusions", () => {
    expect(
      comparePaymentFacts({
        consideration: "0.300000",
        payments: ["0.100000", "0.200000"],
        instrument_paid: "0.300000",
        instrument_pending: "0",
      }),
    ).toEqual({
      payments_total: "0.300000",
      status: "MATCH",
      observations: [],
    });
    expect(
      comparePaymentFacts({ consideration: "100", payments: ["40"] }),
    ).toMatchObject({
      status: "OBSERVATION",
      observations: ["PAYMENTS_DIFFER_FROM_CONFIRMED_CONSIDERATION"],
    });
  });

  it("excludes volatile transport metadata from payment semantic identity", () => {
    const base = { amount: "10.00", currency: "MXN" };
    expect(
      paymentSemanticFingerprint({ ...base, actor_id: "a", request_id: "one" }),
    ).toBe(
      paymentSemanticFingerprint({ ...base, actor_id: "b", request_id: "two" }),
    );
  });

  it("merges multiple receipt proposals with exact field provenance and no silent conflict choice", () => {
    const merged = mergePaymentDocumentExtractions([
      {
        document_id: "doc-a",
        version: "v1",
        checksum: "a".repeat(64),
        model: "mock-model",
        fields: [
          { campo: "monto", valor: "100.000000", confianza: "LECTURA_CLARA", pagina: 1 },
          { campo: "referencia", valor: "REF-A", confianza: "LECTURA_CLARA" },
        ],
        missing: ["fecha"],
        conflicts: [],
      },
      {
        document_id: "doc-b",
        version: "v2",
        checksum: "b".repeat(64),
        model: "mock-model",
        fields: [
          { campo: "monto", valor: "100.000000", confianza: "LECTURA_CLARA", pagina: 2 },
          { campo: "referencia", valor: "REF-B", confianza: "LECTURA_CLARA" },
        ],
        missing: [],
        conflicts: [],
      },
    ]);
    expect(merged.content).toMatchObject({
      amount_original: "100.000000",
      field_states: {
        amount_original: { state: "PRESENT" },
        reference: { state: "UNCERTAIN" },
        payment_date: { state: "ABSENT" },
      },
    });
    expect(merged.content).not.toHaveProperty("reference");
    expect(merged.provenance.amount_original).toHaveLength(2);
    expect(JSON.stringify(merged)).not.toMatch(/concepto|questionnaire|answers/i);
  });
});
