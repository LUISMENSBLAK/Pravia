import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(
  resolve(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260903010000_create_h5_questionnaires_payments_provider/migration.sql",
  ),
  "utf8",
);
const service = readFileSync(
  resolve(process.cwd(), "src/services/complianceH5.service.ts"),
  "utf8",
);
const domain = readFileSync(
  resolve(process.cwd(), "src/domain/complianceH5.ts"),
  "utf8",
);
const routes = readFileSync(
  resolve(process.cwd(), "src/routes/compliance.routes.ts"),
  "utf8",
);
const partiesService = readFileSync(
  resolve(process.cwd(), "src/services/expedienteParties.service.ts"),
  "utf8",
);
const tenant = readFileSync(
  resolve(process.cwd(), "src/config/tenantPrisma.ts"),
  "utf8",
);
const traceability = readFileSync(
  resolve(
    process.cwd(),
    "../docs/requirements/h5-cum-cue-pag-provider-traceability.md",
  ),
  "utf8",
);

const deferred = [
  "NCUE-016",
  "NPAG-033",
  "NXINT-009",
  "NXINT-010",
  "NXINT-011",
];
const blockedLegal = ["NPAG-012", "NPAG-020", "NPAG-026", "NPRV-004"];
const blockedConfig = ["NCUE-022", "NCUE-023", "NCUE-029", "NPAG-014"];
const modelNames = [
  "ComplianceQuestionnaireAssessment",
  "ComplianceQuestionnaireAssessmentRevision",
  "ComplianceRiskMethodology",
  "ComplianceRiskMethodologyRevision",
  "ComplianceOperationPayment",
  "ComplianceOperationPaymentRevision",
  "ComplianceOperationPaymentAct",
  "ComplianceOperationPaymentParty",
  "ComplianceOperationPaymentEvidence",
  "ComplianceOperationPaymentVerification",
  "ComplianceOperationPaymentVerificationRule",
];

describe("H5 frozen 96-atomic contract", () => {
  it("materializes all 96 normalized IDs exactly once and preserves frozen partitions", () => {
    const expected = [
      ...Array.from(
        { length: 34 },
        (_, i) => `NCUE-${String(i + 1).padStart(3, "0")}`,
      ),
      ...Array.from(
        { length: 34 },
        (_, i) => `NPAG-${String(i + 1).padStart(3, "0")}`,
      ),
      ...Array.from(
        { length: 17 },
        (_, i) => `NPRV-${String(i + 1).padStart(3, "0")}`,
      ),
      ...Array.from(
        { length: 11 },
        (_, i) => `NXINT-${String(i + 1).padStart(3, "0")}`,
      ),
    ];
    const ids = Array.from(
      traceability.matchAll(/^\| ((?:NCUE|NPAG|NPRV|NXINT)-\d{3}) \|/gm),
      (match) => match[1],
    );
    expect(expected).toHaveLength(96);
    for (const id of expected)
      expect(
        ids.filter((candidate) => candidate === id),
        id,
      ).toHaveLength(1);
    for (const id of deferred)
      expect(traceability).toMatch(new RegExp(`\\| ${id} \\|.*DEFERRED`));
    for (const id of blockedLegal)
      expect(traceability).toMatch(
        new RegExp(`\\| ${id} \\|.*BLOCKED LEGAL DATA`),
      );
    for (const id of blockedConfig)
      expect(traceability).toMatch(
        new RegExp(`\\| ${id} \\|.*BLOCKED CONFIG/FORMAT DATA`),
      );
    expect(
      expected.filter(
        (id) => ![...deferred, ...blockedLegal, ...blockedConfig].includes(id),
      ),
    ).toHaveLength(83);
  });

  it("adds exactly eleven H5 tenant-owned models and registers every one", () => {
    for (const model of modelNames) {
      expect(schema).toMatch(
        new RegExp(`model ${model} \\{[\\s\\S]*?organization_id\\s+String`),
      );
      expect(tenant).toContain(`'${model}'`);
    }
    expect(modelNames).toHaveLength(11);
  });

  it("uses one additive H5 migration without legal/configured content seeds", () => {
    expect(migration).toContain("H5 · CUM-CUE-001 + CUM-PAG-001");
    expect(migration).not.toMatch(/8[,.]?025|\bUMA\b/iu);
    expect(migration).not.toMatch(
      /INSERT\s+INTO\s+"CatalogoArtefactoVersion"/i,
    );
    expect(migration).not.toMatch(
      /INSERT\s+INTO\s+"ComplianceLegalRuleRevision"/i,
    );
  });

  it("enforces questionnaire scope XOR, finalized immutability and monotonic revisions physically", () => {
    for (const token of [
      "h5_questionnaire_scope_target_check",
      "H5_FINALIZED_QUESTIONNAIRE_IMMUTABLE",
      "h5_questionnaire_revision_number_key",
    ])
      expect(migration).toContain(token);
    expect(service).toContain("H5_QUESTIONNAIRE_STALE");
    expect(service).toContain("H5_QUESTIONNAIRE_INCOMPLETE");
    expect(service).toContain("H5_RISK_METHODOLOGY_NOT_CONFIGURED");
  });

  it("deduplicates general and personal assessments independently of acts and preserves trigger lineage", () => {
    expect(service).toContain("GENERAL");
    expect(service).toContain("PERSONAL:");
    expect(service).toContain(
      "target_compareciente_id: requirement.target_compareciente_id",
    );
    expect(service).toContain("trigger_snapshot");
    expect(service).not.toContain("QUESTIONNAIRE_PER_ACT");
  });

  it("keeps the risk methodology closed, deterministic and fail-closed", () => {
    for (const token of [
      "RISK_METHODOLOGY_ZERO_OUTPUT",
      "RISK_METHODOLOGY_MULTIPLE_OUTPUTS",
      "RISK_METHODOLOGY_INVALID",
    ])
      expect(domain).toContain(token);
    expect(service).toContain("evaluateRiskMethodology");
  });

  it("models payment masters, immutable revisions, multi-act scope and canonical document evidence", () => {
    for (const model of modelNames.slice(4))
      expect(schema).toContain(`model ${model}`);
    for (const token of [
      "H5_CONFIRMED_PAYMENT_REVISION_IMMUTABLE",
      "H5_EXPLICIT_PAYMENT_REQUIRES_ACT",
      "h5_operation_payment_evidence_evidence_fkey",
    ])
      expect(migration).toContain(token);
    expect(service).toContain("canAccessDocumento");
    expect(service).toContain("account_fingerprint");
    expect(service).not.toMatch(/account_number:\s*(?:text|String)/);
  });

  it("reuses H1, H2, H3, CUM-EST, AuditLog and the existing AI proposal master", () => {
    expect(service).toContain("ensureOperationScreeningForPartyTx");
    expect(service).toContain("complianceAiProposal");
    expect(service).toContain("deriveComplianceState");
    expect(service).toContain("auditLog.create");
    expect(service).not.toContain("ComplianceH5AiProposal");
    expect(service).toContain("extraerFinanzasDesdeDocumento");
    expect(service).toContain("recordAIUsages");
    expect(service).toContain("questionnaire_answers_sent: false");
  });

  it("keeps sensitive H5 reads permission-gated and provider role additive", () => {
    expect(routes.match(/compliance\.sensitive\.read/g)?.length).toBeGreaterThanOrEqual(10);
    expect(partiesService).toContain("linkAdditionalProviderRoleInTransaction");
    expect(partiesService).toContain("PROVEEDOR_RECURSOS");
    expect(service).not.toContain("data: { es_proveedor_recursos: true }");
  });

  it("evaluates H5 legal contexts in H1 without colliding with activity results", () => {
    expect(service).toContain("evaluateLegalRule");
    expect(service).toContain('contextKind: "PAYMENT"');
    expect(service).toContain('contextKind: "PAYMENT_PARTY"');
    expect(service).toContain('outcomePurpose: "PAYMENT_RESTRICTION"');
    expect(service).toContain('outcomePurpose: "PROVIDER_IDENTIFICATION"');
    expect(migration).toContain("h5_rule_results_context_identity_key");
    expect(migration).not.toContain('CREATE UNIQUE INDEX "h5_rule_results_context_key"');
  });

  it("disables the legacy payment writer and exposes only the canonical H5 routes", () => {
    expect(service).toContain("H5_LEGACY_PAYMENT_ENDPOINT_RETIRED");
    expect(routes).toContain("/revisiones/:id/pagos");
    expect(routes).toContain("/revisiones/:id/h5/pagos");
  });

  it("contains physical tenant/object guards for the H5 lineage graph", () => {
    for (const token of [
      "organization_id",
      "h5_questionnaire_assessment_review_fkey",
      "h5_operation_payment_party_case_party_fkey",
      "h5_payment_verification_revision_fkey",
    ])
      expect(migration).toContain(token);
  });
});
