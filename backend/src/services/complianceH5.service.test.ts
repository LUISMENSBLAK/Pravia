import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const names = ["complianceReview", "expedienteComplianceState", "complianceQuestionnaireAssessment", "complianceQuestionnaireAssessmentRevision",
    "catalogoArtefacto", "catalogoArtefactoVersion", "complianceRiskMethodology", "complianceRiskMethodologyRevision", "complianceRequirement",
    "complianceOperationPayment", "complianceOperationPaymentRevision", "complianceOperationPaymentAct", "complianceOperationPaymentParty",
    "complianceOperationPaymentEvidence", "complianceOperationPaymentVerification", "complianceOperationPaymentVerificationRule", "complianceLegalRuleRevision", "complianceRuleResult",
    "expedienteActo", "expedienteCompareciente", "expedienteDocumento", "expedienteActividad", "compliancePayment", "complianceEvidence", "documento", "complianceAiProposal", "complianceEvent", "auditLog"];
  const db: any = { $executeRaw: vi.fn(), $executeRawUnsafe: vi.fn(), $queryRaw: vi.fn() };
  for (const name of names) db[name] = Object.fromEntries(["findFirst", "findMany", "count", "create", "createMany", "update", "updateMany", "upsert"].map((method) => [method, vi.fn()]));
  db.$transaction = vi.fn();
  return { db, canAccessDocumento: vi.fn(), extract: vi.fn(), download: vi.fn(), upload: vi.fn(), deleteFile: vi.fn(), usage: vi.fn(), failure: vi.fn(), screening: vi.fn(), linkProvider: vi.fn() };
});
vi.mock("../config/prisma", () => ({ default: mocks.db }));
vi.mock("./objectAccess.service", () => ({ canAccessDocumento: mocks.canAccessDocumento, comparecienteObjectWhere: () => ({ creado_por_id: "actor-test" }) }));
vi.mock("./openaiDocument.service", () => ({ extraerFinanzasDesdeDocumento: mocks.extract, getOpenAIModelName: () => "synthetic-model" }));
vi.mock("../storage/storage.service", () => ({ downloadFile: mocks.download, uploadFile: mocks.upload, deleteFile: mocks.deleteFile }));
vi.mock("./aiUsage.service", () => ({ recordAIUsages: mocks.usage, recordAIFailure: mocks.failure }));
vi.mock("./operationScreening.service", () => ({ ensureOperationScreeningForPartyTx: mocks.screening }));
vi.mock("./expedienteParties.service", () => ({ ExpedientePartiesService: class { linkAdditionalProviderRoleInTransaction = mocks.linkProvider; } }));
import { ComplianceH5Service, renderH5QuestionnairePdf } from "./complianceH5.service";
import { semanticFingerprint } from "../domain/complianceH5";

const actor: any = { id: "actor-test", organizationId: "org-test", rol: "ABOGADO", sessionId: "session-test",
  permissions: ["compliance.read", "compliance.write", "compliance.review", "compliance.sensitive.read", "compliance.rules.manage", "documentos.read", "documentos.write", "ia.execute"] };
const definition = { schema_version: 1, scope: "GENERAL", sections: [{ id: "test-section", label: "Sección sintética",
  questions: [{ id: "test-answer", label: "Dato sintético", type: "BOOLEAN", required: true }] }] };
const definitionRow = { id: "definition-test", definition_json: definition, definition_checksum: semanticFingerprint(definition) };
const review = { id: "review-test", organization_id: "org-test", expediente_id: "case-test", fecha_operacion: null, is_canonical_legal_engine: true };
const requirement = { id: "requirement-test", requirement_key: "CUE:GENERAL", target_compareciente_id: null, source_snapshot: {}, status: "PENDIENTE" };
const assessment = { id: "assessment-test", review_id: review.id, definition_version_id: definitionRow.id, definitionVersion: definitionRow,
  requirement_id: requirement.id, requirement, scope: "GENERAL", target_compareciente_id: null,
  trigger_snapshot: [{ requirement_id: requirement.id }, { requirement_id: "second-trigger" }],
  currentRevision: { id: "revision-test", revision_number: 1, semantic_fingerprint: "base-test", status: "DRAFT" } };

beforeEach(() => {
  vi.resetAllMocks();
  for (const delegate of Object.values(mocks.db) as any[]) {
    if (typeof delegate !== "object") continue;
    delegate.findMany?.mockResolvedValue([]); delegate.findFirst?.mockResolvedValue(null);
    delegate.create?.mockImplementation(async ({ data }: any) => ({ id: "created-test", ...data }));
    delegate.createMany?.mockResolvedValue({ count: 1 });
    delegate.upsert?.mockImplementation(async ({ create }: any) => ({ id: "upserted-test", ...create }));
    delegate.update?.mockImplementation(async ({ data }: any) => ({ id: "updated-test", ...data }));
    delegate.updateMany?.mockResolvedValue({ count: 1 });
  }
  mocks.db.$transaction.mockImplementation((work: any) => work(mocks.db));
  mocks.db.complianceReview.findFirst.mockImplementation(async ({ where }: any) => where.id === review.id && where.organization_id === actor.organizationId ? review : null);
  mocks.db.expedienteComplianceState.findFirst.mockResolvedValue({ id: "state-test" });
  mocks.db.complianceQuestionnaireAssessment.findFirst.mockResolvedValue(assessment);
  mocks.canAccessDocumento.mockResolvedValue(true);
  mocks.usage.mockResolvedValue(undefined); mocks.failure.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue(undefined); mocks.deleteFile.mockResolvedValue(undefined);
});

describe("H5 service behavioral security and lifecycle", () => {
  describe("provider confirmation and conditional personal questionnaire", () => {
    const providerActor = { ...actor, permissions: [...actor.permissions, "expedientes.write", "comparecientes.read"] };
    beforeEach(() => {
      mocks.db.complianceReview.findFirst.mockResolvedValue({ ...review, fecha_operacion: new Date("2026-09-03") });
      mocks.db.complianceLegalRuleRevision.findMany.mockResolvedValue([{ id: "provider-rule", rule_id: "rule-master", version: 1, checksum: "rule-fp" }]);
      mocks.db.complianceOperationPaymentRevision.findFirst.mockResolvedValue({ id: "provider-revision", payment_id: "provider-payment", review_id: review.id, expediente_id: review.expediente_id, payment: { current_revision_id: "provider-revision" } });
      mocks.db.complianceOperationPaymentParty.findFirst.mockResolvedValue({ compareciente_id: "provider-person" });
      mocks.db.complianceRuleResult.findFirst.mockResolvedValue({ id: "provider-result", rule_revision_id: "provider-rule", ruleRevision: { checksum: "rule-fp", outcome: { when_true: { document_requirements: [] } } } });
      mocks.linkProvider.mockResolvedValue({ relation: { id: "additional-relation" }, idempotent: false });
    });
    it("adds the role through EXP-003 and reuses H3 without unconditional CUE", async () => {
      await ComplianceH5Service.confirmProvider(providerActor, "provider-revision", "original-relation", { confirm: true, rule_result_id: "provider-result" });
      expect(mocks.linkProvider).toHaveBeenCalledWith(mocks.db, providerActor, expect.objectContaining({ sourceRelationId: "original-relation" }));
      expect(mocks.screening).toHaveBeenCalledWith(mocks.db, expect.objectContaining({ relationId: "additional-relation", reviewId: review.id, organizationId: actor.organizationId }));
      expect(mocks.db.complianceRequirement.upsert).not.toHaveBeenCalled();
      expect(mocks.db.expedienteCompareciente.update).not.toHaveBeenCalled();
    });
    it("deduplicates a configured personal CUE by person, not by role/payment/act", async () => {
      mocks.db.complianceRuleResult.findFirst.mockResolvedValue({ id: "provider-result", rule_revision_id: "provider-rule", ruleRevision: { checksum: "rule-fp", outcome: { when_true: { document_requirements: [{ action: "GO_TO_QUESTIONNAIRE", target_scope: "EACH_RELEVANT_COMPARECIENTE" }] } } } });
      await ComplianceH5Service.confirmProvider(providerActor, "provider-revision", "original-relation", { confirm: true, rule_result_id: "provider-result" });
      expect(mocks.db.complianceRequirement.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ requirement_key: "CUE:PERSONAL:provider-person", target_compareciente_id: "provider-person", requires_signed_document: false }) }));
    });
    it("merges every verified trigger into the same personal CUE provenance", async () => {
      mocks.db.complianceRuleResult.findFirst.mockResolvedValue({ id: "second-result", rule_revision_id: "provider-rule", ruleRevision: { checksum: "rule-fp", outcome: { when_true: { document_requirements: [{ action: "GO_TO_QUESTIONNAIRE", target_scope: "EACH_RELEVANT_COMPARECIENTE" }] } } } });
      mocks.db.complianceRequirement.findFirst.mockResolvedValue({ source_snapshot: { h5_contract: "CUM-CUE-001", triggers: [{ rule_result_id: "first-result" }] } });
      await ComplianceH5Service.confirmProvider(providerActor, "provider-revision", "original-relation", { confirm: true, rule_result_id: "second-result" });
      expect(mocks.db.complianceRequirement.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { source_snapshot: expect.objectContaining({ triggers: [{ rule_result_id: "first-result" }, expect.objectContaining({ rule_result_id: "second-result" })] }) } }));
    });
    it("cannot promote a party without an exact verified result", async () => {
      mocks.db.complianceRuleResult.findFirst.mockResolvedValue(null);
      await expect(ComplianceH5Service.confirmProvider(providerActor, "provider-revision", "original-relation", { confirm: true, rule_result_id: "unverified" })).rejects.toMatchObject({ code: "H5_PROVIDER_RULE_RESULT_NOT_FOUND" });
      expect(mocks.linkProvider).not.toHaveBeenCalled(); expect(mocks.screening).not.toHaveBeenCalled();
    });
    it("rejects a formerly effective provider result after a new legal revision", async () => {
      mocks.db.complianceLegalRuleRevision.findMany.mockResolvedValue([{ id: "newer-rule", rule_id: "rule-master", version: 2, checksum: "newer-fp" }]);
      await expect(ComplianceH5Service.confirmProvider(providerActor, "provider-revision", "original-relation", { confirm: true, rule_result_id: "provider-result" })).rejects.toMatchObject({ code: "H5_PROVIDER_RULE_RESULT_STALE" });
      expect(mocks.linkProvider).not.toHaveBeenCalled();
    });
    it("rejects an old provider payment revision before touching EXP-003", async () => {
      mocks.db.complianceOperationPaymentRevision.findFirst.mockResolvedValue({ id: "provider-revision", review_id: review.id, payment: { current_revision_id: "newer" } });
      await expect(ComplianceH5Service.confirmProvider(providerActor, "provider-revision", "original-relation", { confirm: true })).rejects.toMatchObject({ code: "H5_PROVIDER_PAYMENT_STALE" });
      expect(mocks.linkProvider).not.toHaveBeenCalled();
    });
  });
  describe("AI exact confirmation retry", () => {
    const request = { proposal_fingerprint: "proposal-fp", idempotency_key: "confirm-test", confirmed_fields: { amount_original: "1.00" } };
    beforeEach(() => {
      mocks.db.complianceAiProposal.findFirst.mockResolvedValue({ id: "proposal-test", review_id: review.id, expediente_id: review.expediente_id, status: "CONFIRMADA_POR_HUMANO", proposal_fingerprint: "proposal-fp", source_documents: [{ id: "document-test", checksum: "checksum", version: "2026-01-01T00:00:00.000Z" }] });
      mocks.db.documento.findMany.mockResolvedValue([{ id: "document-test", checksum_sha256: "checksum", fecha_carga: new Date("2026-01-01") }]);
      mocks.db.complianceEvidence.findMany.mockResolvedValue([{ documento_id: "document-test", document_checksum_snapshot: "checksum" }]);
      mocks.db.auditLog.findFirst.mockResolvedValue({ valores_nuevos: { revision_id: "already-confirmed", request_fingerprint: semanticFingerprint({ proposal: request.proposal_fingerprint, fields: request.confirmed_fields, idempotency_key: request.idempotency_key }) } });
      mocks.db.complianceOperationPaymentRevision.findFirst.mockResolvedValue({ id: "already-confirmed" });
    });
    it("recovers the exact decision from canonical AuditLog with no duplicate write", async () => {
      await expect(ComplianceH5Service.confirmPaymentProposal(actor, "proposal-test", request)).resolves.toEqual({ id: "already-confirmed" });
      expect(mocks.db.complianceOperationPaymentRevision.create).not.toHaveBeenCalled();
      expect(mocks.db.complianceAiProposal.update).not.toHaveBeenCalled(); expect(mocks.db.auditLog.create).not.toHaveBeenCalled();
    });
    it("rejects changed human facts under the same confirmation identity", async () => {
      await expect(ComplianceH5Service.confirmPaymentProposal(actor, "proposal-test", { ...request, confirmed_fields: { amount_original: "2" } })).rejects.toMatchObject({ code: "H5_PAYMENT_PROPOSAL_IDEMPOTENCY_CONFLICT" });
    });
    it("does not bypass document access on retry", async () => {
      mocks.canAccessDocumento.mockResolvedValue(false);
      await expect(ComplianceH5Service.confirmPaymentProposal(actor, "proposal-test", request)).rejects.toMatchObject({ code: "H5_PAYMENT_PROPOSAL_SOURCE_DENIED" });
    });
  });
  describe("multi-receipt AI preparation with a mocked provider", () => {
    beforeEach(() => {
      const documents = ["doc-a", "doc-b"].map(documento_id => ({ id: `evidence-${documento_id}`, documento_id,
        document_checksum_snapshot: `checksum-${documento_id}`, documento: { id: documento_id, checksum_sha256: `checksum-${documento_id}`,
          fecha_carga: new Date("2026-01-01"), storage_key: `synthetic/${documento_id}`, mime_type: "application/pdf", tipo: "RECIBO", nombre_original: "SYNTHETIC.pdf" } }));
      mocks.db.complianceEvidence.findMany.mockResolvedValue(documents);
      mocks.download.mockResolvedValue(Buffer.from("synthetic-document-only"));
      mocks.extract.mockResolvedValue({ modelo: "synthetic-model", uso: { inputTokens: 1, outputTokens: 1 }, faltantes: ["cuenta"], conflictos: [], campos: [
        { campo: "monto", valor: "100.10", confianza: "LECTURA_CLARA", pagina: 2, fragmento: "SENSITIVE OCR MUST NOT BE COPIED" },
      ] });
    });
    it("preserves both exact source lineages and charges canonical usage without writing a payment", async () => {
      const result = await ComplianceH5Service.preparePaymentProposal(actor, review.id, { operation_id: "prepare-test", source_document_ids: ["doc-a", "doc-b"] });
      expect(result.content).toMatchObject({ amount_original: "100.10", field_states: { account_number: { state: "ABSENT" } } });
      expect(result.field_provenance.amount_original).toHaveLength(2);
      expect(result.field_provenance.amount_original[0]).toMatchObject({ document_id: "doc-a", checksum: "checksum-doc-a", page: 2, model: "synthetic-model", locator: null });
      expect(mocks.extract).toHaveBeenCalledTimes(2); expect(mocks.usage).toHaveBeenCalledTimes(2);
      expect(mocks.usage.mock.calls[0][1]).toMatchObject({ organizationId: actor.organizationId, usuarioId: actor.id, expedienteId: review.expediente_id, metadata: { questionnaire_answers_sent: false, auto_write: false } });
      expect(JSON.stringify(mocks.db.complianceAiProposal.create.mock.calls)).not.toContain("SENSITIVE OCR");
      expect(mocks.db.complianceOperationPayment.create).not.toHaveBeenCalled(); expect(mocks.db.complianceOperationPaymentRevision.create).not.toHaveBeenCalled();
    });
    it("does not silently choose between conflicting receipt values", async () => {
      mocks.extract.mockResolvedValueOnce({ modelo: "synthetic-model", uso: {}, faltantes: [], conflictos: [], campos: [{ campo: "monto", valor: "101", confianza: "LECTURA_CLARA" }] });
      const result = await ComplianceH5Service.preparePaymentProposal(actor, review.id, { operation_id: "conflict-test", source_document_ids: ["doc-a", "doc-b"] });
      expect(result.content.amount_original).toBeUndefined(); expect(result.content.field_states.amount_original.state).toBe("UNCERTAIN");
    });
    it("records an extraction failure without creating a partial proposal or payment", async () => {
      mocks.extract.mockRejectedValue(new Error("synthetic provider failure"));
      await expect(ComplianceH5Service.preparePaymentProposal(actor, review.id, { operation_id: "failure-test", source_document_ids: ["doc-a", "doc-b"] })).rejects.toMatchObject({ code: "H5_PAYMENT_AI_FAILED" });
      expect(mocks.failure).toHaveBeenCalledOnce(); expect(mocks.db.complianceAiProposal.create).not.toHaveBeenCalled();
      expect(mocks.db.complianceOperationPaymentRevision.create).not.toHaveBeenCalled();
    });
    it("rejects a stale base payment before applying reviewed proposal facts", async () => {
      mocks.db.complianceAiProposal.findFirst.mockResolvedValue({ id: "proposal-test", review_id: review.id, expediente_id: review.expediente_id, proposal_fingerprint: "fp", status: "PROPUESTA_REQUIERE_CONFIRMACION", payment_id: "payment-test", base_fingerprint: "old", source_documents: [{ id: "doc-a", checksum: "checksum-doc-a", version: "2026-01-01T00:00:00.000Z" }] });
      mocks.db.documento.findMany.mockResolvedValue([{ id: "doc-a", checksum_sha256: "checksum-doc-a", fecha_carga: new Date("2026-01-01") }]);
      mocks.db.complianceOperationPayment.findFirst.mockResolvedValue({ id: "payment-test", currentRevision: { semantic_fingerprint: "new" } });
      await expect(ComplianceH5Service.confirmPaymentProposal(actor, "proposal-test", { proposal_fingerprint: "fp", confirmed_fields: {} })).rejects.toMatchObject({ code: "H5_PAYMENT_PROPOSAL_BASE_STALE" });
      expect(mocks.db.complianceOperationPaymentRevision.create).not.toHaveBeenCalled();
    });
  });
  it("does not return personal questionnaire answers without person read authority", async () => {
    await ComplianceH5Service.readWorkspace(actor, review.id);
    expect(mocks.db.expedienteCompareciente.findMany).not.toHaveBeenCalled();
    expect(mocks.db.complianceQuestionnaireAssessment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ target_compareciente_id: null }] }) }));
    await ComplianceH5Service.readWorkspace({ ...actor, permissions: [...actor.permissions, "comparecientes.read"] }, review.id);
    expect(mocks.db.complianceQuestionnaireAssessment.findMany.mock.lastCall?.[0].where.OR[1]).toMatchObject({ targetCompareciente: { organization_id: actor.organizationId, creado_por_id: actor.id } });
  });
  it.each(["0.1234567", "100000000000000", "1e999"])("rejects a value outside Decimal(20,6): %s", async (amount) => {
    await expect(ComplianceH5Service.createPaymentRevision(actor, review.id, { idempotency_key: "precision", amount_original: amount })).rejects.toMatchObject({ code: "H5_PAYMENT_AMOUNT_INVALID" });
    expect(mocks.db.complianceOperationPayment.create).not.toHaveBeenCalled();
  });
  describe("H1 source requirements", () => {
    const input = { reviewId: review.id, expedienteId: review.expediente_id, stateId: "state-test", results: ["act-a", "act-b", "act-c"].map((actId) => ({
      id: `result-${actId}`, actId, revisionId: "rule-test", checksum: "checksum-test", vulnerable: true,
      documents: [{ category: "CUESTIONARIOS_RIESGO", action: "GO_TO_QUESTIONNAIRE", target_scope: "EACH_RELEVANT_COMPARECIENTE" }, { category: "PAGOS_EVIDENCIAS", action: "GO_TO_PAYMENT_EVIDENCE", target_scope: "OPERATION" }],
    })), parties: [{ compareciente_id: "person-test", expediente_acto_id: null }, { compareciente_id: "person-test", expediente_acto_id: "act-a" }] };
    it("deduplicates one general, one personal and one operation requirement across three acts", async () => {
      await expect(ComplianceH5Service.materializeSourceRequirementsTx(mocks.db, actor, input)).resolves.toEqual(["PENDIENTE", "PENDIENTE", "PENDIENTE"]);
      const creates = mocks.db.complianceRequirement.upsert.mock.calls.map(([request]: any) => request.create);
      expect(creates.map((item: any) => item.requirement_key)).toEqual(["CUE:GENERAL", "CUE:PERSONAL:person-test", "PAG:OPERATION"]);
      for (const item of creates) {
        expect(item.organization_id).toBe(actor.organizationId); expect(item.source_snapshot.triggers).toHaveLength(3);
        expect(item.requires_signed_document).toBe(false);
      }
      expect(mocks.db.complianceQuestionnaireAssessment.create).not.toHaveBeenCalled();
    });
    it("does not infer a personal questionnaire or payment trigger without configured requirements", async () => {
      await ComplianceH5Service.materializeSourceRequirementsTx(mocks.db, actor, { ...input, results: input.results.map((item) => ({ ...item, documents: [] })) });
      expect(mocks.db.complianceRequirement.upsert).toHaveBeenCalledOnce();
      expect(mocks.db.complianceRequirement.upsert.mock.calls[0][0].create.requirement_key).toBe("CUE:GENERAL");
    });
    it("does not create H5 requirements for non-vulnerable results", async () => {
      await expect(ComplianceH5Service.materializeSourceRequirementsTx(mocks.db, actor, { ...input, results: input.results.map((item) => ({ ...item, vulnerable: false })) })).resolves.toEqual([]);
      expect(mocks.db.complianceRequirement.upsert).not.toHaveBeenCalled();
    });
  });
  it("filters document and person candidates by canonical object access before returning workspace", async () => {
    mocks.db.complianceEvidence.findMany.mockResolvedValue([{ id: "evidence-denied", documento_id: "doc-denied", documento: { id: "doc-denied" } }]);
    mocks.db.documento.findMany.mockResolvedValue([{ id: "project-denied", checksum_sha256: "checksum" }]);
    mocks.db.complianceAiProposal.findMany.mockResolvedValue([{ id: "proposal-denied", source_documents: [{ id: "doc-denied" }] }]);
    mocks.canAccessDocumento.mockResolvedValue(false);
    const result = await ComplianceH5Service.readWorkspace({ ...actor, permissions: [...actor.permissions, "comparecientes.read"] }, review.id);
    expect(result.evidence).toEqual([]); expect(result.project_versions).toEqual([]); expect(result.proposals).toEqual([]);
    expect(mocks.db.expedienteCompareciente.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ compareciente: expect.objectContaining({ creado_por_id: actor.id }) }) }));
  });
  describe("internal questionnaire record", () => {
    beforeEach(() => {
      mocks.db.complianceQuestionnaireAssessment.findFirst.mockResolvedValue({ ...assessment, expediente_id: review.expediente_id, target_compareciente_id: null,
        review: { expediente: { numero_pravia: "EXP-0001-2026" } }, requirement: { label: "Cuestionario sintético" },
        currentRevision: { ...assessment.currentRevision, status: "FINALIZED", definition_version_id: definitionRow.id, definition_checksum: definitionRow.definition_checksum,
          methodology_revision_id: "method-test", answers: { "test-answer": true }, evaluation_snapshot: { output_label: "Salida sintética", methodology_checksum: "method-checksum" } },
      });
    });
    it("GET preview has no Storage or database writes", async () => {
      const result = await ComplianceH5Service.questionnairePdf(actor, assessment.id);
      expect(result.buffer.toString("latin1")).toContain("Dato sintético: Sí");
      expect(result.buffer.toString("latin1")).toContain("method-checksum");
      expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.db.documento.create).not.toHaveBeenCalled();
    });
    it("POST registers a canonical H2 unsigned record with exact provenance", async () => {
      await ComplianceH5Service.questionnairePdf(actor, assessment.id, true);
      expect(mocks.upload).toHaveBeenCalledOnce();
      expect(mocks.db.documento.create).toHaveBeenCalledWith({ data: expect.objectContaining({ organization_id: actor.organizationId, tipo: "CUM_CUE_INTERNO", datos_extraidos: expect.objectContaining({ revision_id: "revision-test", answers_fingerprint: "base-test", official: false, requires_signed_document: false }) }) });
      expect(mocks.db.complianceEvidence.create).toHaveBeenCalledWith({ data: expect.objectContaining({ source: "FORMAT_GENERATED", document_state: "GENERATED", validation_status: "PENDING_HUMAN", requirement_id: requirement.id }) });
      expect(mocks.db.complianceRequirement.update).not.toHaveBeenCalled();
    });
    it("compensates only its uploaded blob after registration failure", async () => {
      mocks.db.documento.create.mockRejectedValue(new Error("synthetic failure"));
      await expect(ComplianceH5Service.questionnairePdf(actor, assessment.id, true)).rejects.toThrow("synthetic failure");
      expect(mocks.deleteFile).toHaveBeenCalledWith(mocks.upload.mock.calls[0][1]);
    });
    it("reuses an existing exact record without uploading another blob", async () => {
      mocks.db.complianceEvidence.findFirst.mockResolvedValue({ documento_id: "prior-document", documento: { storage_key: "prior-local", nombre_original: "prior.pdf" } });
      mocks.download.mockResolvedValue(Buffer.from("prior"));
      const result = await ComplianceH5Service.questionnairePdf(actor, assessment.id, true);
      expect(result.buffer.toString()).toBe("prior"); expect(mocks.upload).not.toHaveBeenCalled();
    });
    it("wraps all long answers and paginates without dropping their ending", () => {
      const pdf = renderH5QuestionnairePdf(["Título español", ...Array.from({ length: 90 }, (_, i) => `${i}: ${"dato ".repeat(50)}fin-${i}`)]).toString("latin1");
      expect(pdf).toContain("Título español"); expect(pdf).toContain("fin-89");
      expect((pdf.match(/\/Type \/Page /g) || []).length).toBeGreaterThan(1);
      expect(pdf).not.toContain("NaN");
    });
  });
  it("preserves a pinned assessment when no active definition remains", async () => {
    mocks.db.complianceRequirement.findMany.mockResolvedValue([requirement]);
    const result = await ComplianceH5Service.ensureQuestionnaires(actor, review.id);
    expect(result.items).toEqual([assessment]);
    expect(mocks.db.catalogoArtefactoVersion.findMany).not.toHaveBeenCalled();
    expect(mocks.db.complianceRequirement.update).not.toHaveBeenCalled();
  });
  it("does not confirm accidental null facts as human unknowns", async () => {
    await expect(ComplianceH5Service.createPaymentRevision(actor, review.id, { idempotency_key: "request", confirm: true })).rejects.toMatchObject({ code: "H5_PAYMENT_FIELD_REVIEW_REQUIRED" });
    expect(mocks.db.complianceOperationPaymentRevision.create).not.toHaveBeenCalled();
  });
  it("rejects contradictory human unknown and populated facts", async () => {
    await expect(ComplianceH5Service.createPaymentRevision(actor, review.id, { idempotency_key: "request", confirm: true, amount_original: "1", field_states: { amount_original: "CONFIRMED_UNKNOWN" } })).rejects.toMatchObject({ code: "H5_PAYMENT_FIELD_REVIEW_REQUIRED" });
  });
  it("preserves only server-side account safe values when creating a new revision", async () => {
    mocks.db.complianceOperationPayment.findFirst.mockResolvedValue({ id: "payment-test", currentRevision: { id: "base-revision", revision_number: 1, semantic_fingerprint: "base-test", account_last4: "1234", account_fingerprint: "safe-hmac-test" } });
    const result = await ComplianceH5Service.createPaymentRevision(actor, review.id, { payment_id: "payment-test", base_fingerprint: "base-test", account_unchanged: true, account_last4: "9999", account_fingerprint: "attacker", idempotency_key: "request" });
    expect(result).toMatchObject({ account_last4: "1234", account_fingerprint: "safe-hmac-test", field_states: { account_number: "VALUE" } });
  });
  it("blocks account preservation on a new master", async () => {
    await expect(ComplianceH5Service.createPaymentRevision(actor, review.id, { account_unchanged: true, idempotency_key: "request" })).rejects.toMatchObject({ code: "H5_PAYMENT_ACCOUNT_PRESERVE_INVALID" });
  });
  describe("exact instrument verification", () => {
    const request = { project_document_id: "project-test", project_document_checksum: "project-checksum", idempotency_key: "verification-test", confirm: true,
      consideration_currency: "MXN", consideration_amount: "200", instrument_paid: "200", instrument_pending: "0" };
    beforeEach(() => {
      const source = { id: "receipt-evidence", documento_id: "receipt", estatus: "ACTIVO", document_version: "v1", document_checksum_snapshot: "receipt-fp", documento: { estatus: "VIGENTE", checksum_sha256: "receipt-fp" } };
      const current = { id: "payment-revision", status: "CONFIRMED", review_id: review.id, expediente_id: review.expediente_id, semantic_fingerprint: "payment-fp", currency_original: "MXN", amount_original: new Prisma.Decimal("100"), equivalent_mxn: new Prisma.Decimal("100"), evidence: [{ evidence: source }] };
      mocks.db.complianceOperationPaymentRevision.findFirst.mockResolvedValue({ ...current, payment: { current_revision_id: current.id } });
      mocks.db.complianceOperationPayment.findMany.mockResolvedValue([{ currentRevision: current }, { currentRevision: { ...current, id: "second-revision", semantic_fingerprint: "second-fp" } }]);
      mocks.db.documento.findFirst.mockResolvedValue({ id: "project-test", checksum_sha256: "project-checksum" });
      mocks.db.complianceRuleResult.findMany.mockResolvedValue([{ id: "rule-result-test", payment_revision_id: current.id, rule_revision_id: "rule-revision-test", ruleRevision: { checksum: "rule-checksum" } }]);
    });
    it("compares all current payments once and stores exact rule/project lineage", async () => {
      const result = await ComplianceH5Service.verifyPayment(actor, "payment-revision", request);
      expect(result.status).toBe("MATCH");
      expect(result.comparison_snapshot).toMatchObject({ consideration: "200", instrument_paid: "200", rules: [{ id: "rule-result-test", revision_id: "rule-revision-test", checksum: "rule-checksum" }] });
      expect(result.comparison_snapshot.confirmed_payments).toHaveLength(2);
      expect(mocks.db.documento.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "project-test", organization_id: actor.organizationId, expediente_id: review.expediente_id, tipo: "PROYECTO_ESCRITURA", estatus: "VIGENTE" }) });
      expect(mocks.db.complianceOperationPaymentVerificationRule.createMany).toHaveBeenCalledWith({ data: [{ organization_id: actor.organizationId, verification_id: result.id, rule_result_id: "rule-result-test" }] });
    });
    it("keeps missing receipts in review even when amounts match", async () => {
      const current = await mocks.db.complianceOperationPaymentRevision.findFirst();
      mocks.db.complianceOperationPaymentRevision.findFirst.mockResolvedValue({ ...current, evidence: [] });
      const result = await ComplianceH5Service.verifyPayment(actor, "payment-revision", request);
      expect(result.status).toBe("REVIEW_REQUIRED");
      expect(mocks.db.complianceRequirement.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "EN_PROCESO" } }));
    });
    it("satisfies the payment requirement only after every current payment is verified", async () => {
      const current = await mocks.db.complianceOperationPaymentRevision.findFirst();
      mocks.db.complianceOperationPayment.findMany.mockResolvedValue([{ currentRevision: current }]);
      const result = await ComplianceH5Service.verifyPayment(actor, "payment-revision", { ...request, consideration_amount: "100", instrument_paid: "100" });
      expect(result.status).toBe("MATCH");
      expect(mocks.db.complianceRequirement.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "CUMPLIDO" } }));
    });
    it("classifies discrepancies only as observations", async () => {
      const result = await ComplianceH5Service.verifyPayment(actor, "payment-revision", { ...request, instrument_paid: "199" });
      expect(result.status).toBe("OBSERVATION");
      expect(mocks.db.complianceRequirement.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "EN_PROCESO" } }));
    });
    it("blocks changed instrument checksum before verification writes", async () => {
      await expect(ComplianceH5Service.verifyPayment(actor, "payment-revision", { ...request, project_document_checksum: "old-checksum" })).rejects.toMatchObject({ code: "H5_PAYMENT_PROJECT_STALE" });
      expect(mocks.db.complianceOperationPaymentVerification.create).not.toHaveBeenCalled();
    });
    it("blocks stale payment pointer", async () => {
      mocks.db.complianceOperationPaymentRevision.findFirst.mockResolvedValue({ id: "payment-revision", review_id: review.id, payment: { current_revision_id: "new-revision" } });
      await expect(ComplianceH5Service.verifyPayment(actor, "payment-revision", request)).rejects.toMatchObject({ code: "H5_PAYMENT_STALE" });
    });
    it("requires human instrument facts, never infers consideration from payments", async () => {
      await expect(ComplianceH5Service.verifyPayment(actor, "payment-revision", { ...request, consideration_amount: null })).rejects.toMatchObject({ code: "H5_PAYMENT_INSTRUMENT_FACTS_REQUIRED" });
    });
    it("does not sum currencies lacking documented conversion", async () => {
      mocks.db.complianceOperationPayment.findMany.mockResolvedValue([{ currentRevision: { id: "payment-revision", status: "CONFIRMED", currency_original: "USD", amount_original: new Prisma.Decimal("100"), equivalent_mxn: null } }]);
      await expect(ComplianceH5Service.verifyPayment(actor, "payment-revision", request)).rejects.toMatchObject({ code: "H5_PAYMENT_COMPARISON_CURRENCY_UNRESOLVED" });
    });
    it("rejects an unauthorized same-tenant project before DB reads", async () => {
      mocks.canAccessDocumento.mockResolvedValue(false);
      await expect(ComplianceH5Service.verifyPayment(actor, "payment-revision", request)).rejects.toMatchObject({ code: "H5_PAYMENT_DOCUMENT_NOT_FOUND" });
      expect(mocks.db.complianceOperationPaymentRevision.findFirst).not.toHaveBeenCalled();
    });
    it("returns the exact prior verification on retry without a second write", async () => {
      const result = await ComplianceH5Service.verifyPayment(actor, "payment-revision", request);
      mocks.db.complianceOperationPaymentVerification.findFirst.mockResolvedValue(result);
      await expect(ComplianceH5Service.verifyPayment(actor, "payment-revision", request)).resolves.toEqual(result);
      expect(mocks.db.complianceOperationPaymentVerification.create).toHaveBeenCalledOnce();
    });
  });
  it("denies missing tenant before any read or mutation", async () => {
    await expect(ComplianceH5Service.readWorkspace({ ...actor, organizationId: undefined }, review.id)).rejects.toMatchObject({ code: "TENANT_CONTEXT_REQUIRED" });
    expect(mocks.db.complianceReview.findFirst).not.toHaveBeenCalled();
  });
  it("denies sensitive reads without permission before DB access", async () => {
    await expect(ComplianceH5Service.readWorkspace({ ...actor, permissions: ["compliance.read"] }, review.id)).rejects.toMatchObject({ code: "H5_SENSITIVE_ACCESS_DENIED" });
    expect(mocks.db.complianceReview.findFirst).not.toHaveBeenCalled();
  });
  it("uses tenant and case object authorization for a valid foreign review ID", async () => {
    await expect(ComplianceH5Service.createPaymentRevision({ ...actor, organizationId: "foreign-org" }, review.id, { idempotency_key: "request" })).rejects.toMatchObject({ code: "H5_REVIEW_NOT_FOUND" });
    expect(mocks.db.complianceReview.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organization_id: "foreign-org", expediente: expect.objectContaining({ OR: [{ abogado_id: actor.id }, { creador_id: actor.id }] }) }) }));
    expect(mocks.db.complianceOperationPayment.create).not.toHaveBeenCalled();
  });
  it("blocks a historical review before any payment write", async () => {
    mocks.db.expedienteComplianceState.findFirst.mockResolvedValue(null);
    await expect(ComplianceH5Service.createPaymentRevision(actor, review.id, { idempotency_key: "request" })).rejects.toMatchObject({ code: "H5_REVIEW_STALE" });
    expect(mocks.db.complianceOperationPayment.create).not.toHaveBeenCalled();
  });
  it("blocks a historical questionnaire review", async () => {
    mocks.db.expedienteComplianceState.findFirst.mockResolvedValue(null);
    await expect(ComplianceH5Service.saveQuestionnaire(actor, assessment.id, { idempotency_key: "request", base_fingerprint: "base-test", answers: {} }, false)).rejects.toMatchObject({ code: "H5_REVIEW_STALE" });
    expect(mocks.db.complianceQuestionnaireAssessmentRevision.create).not.toHaveBeenCalled();
  });
  it("saves incomplete answers only as DRAFT/PENDING, without answers in audit or AI", async () => {
    const result = await ComplianceH5Service.saveQuestionnaire(actor, assessment.id, { idempotency_key: "request", base_fingerprint: "base-test", answers: {} }, false);
    expect(result).toMatchObject({ status: "DRAFT", completeness: "INCOMPLETE", evaluation_status: "PENDING" });
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.db.auditLog.create.mock.calls[0][0].data.valores_nuevos).not.toHaveProperty("answers");
  });
  it("rejects incomplete finalization before revision/evaluation writes", async () => {
    await expect(ComplianceH5Service.saveQuestionnaire(actor, assessment.id, { idempotency_key: "request", base_fingerprint: "base-test", answers: {} }, true)).rejects.toMatchObject({ code: "H5_QUESTIONNAIRE_INCOMPLETE" });
    expect(mocks.db.complianceQuestionnaireAssessmentRevision.create).not.toHaveBeenCalled();
  });
  it.each([0, 2])("rejects finalization with %s compatible methodologies", async (count) => {
    mocks.db.complianceRiskMethodologyRevision.findMany.mockResolvedValue(Array.from({ length: count }, () => ({ id: "method-test" })));
    await expect(ComplianceH5Service.saveQuestionnaire(actor, assessment.id, { idempotency_key: "request", base_fingerprint: "base-test", answers: { "test-answer": true } }, true)).rejects.toMatchObject({ code: count ? "H5_RISK_METHODOLOGY_AMBIGUOUS" : "H5_RISK_METHODOLOGY_NOT_CONFIGURED" });
    expect(mocks.db.complianceQuestionnaireAssessmentRevision.create).not.toHaveBeenCalled();
  });
  it("pins exact methodology and satisfies all same-person triggers transactionally", async () => {
    mocks.db.complianceRiskMethodologyRevision.findMany.mockResolvedValue([{ id: "method-test", checksum: "method-checksum", factor_dsl: {
      schema_version: 1, outputs: [{ code: "TEST_ONLY", label: "Salida sintética", when: { op: "EQUALS", question_id: "test-answer", value: true } }],
    } }]);
    const result = await ComplianceH5Service.saveQuestionnaire(actor, assessment.id, { idempotency_key: "request", base_fingerprint: "base-test", answers: { "test-answer": true } }, true);
    expect(result).toMatchObject({ status: "FINALIZED", methodology_revision_id: "method-test", evaluation_snapshot: { methodology_checksum: "method-checksum", output_code: "TEST_ONLY" } });
    expect(mocks.db.complianceRequirement.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: { in: [requirement.id, "second-trigger"] }, provider: "CUE", review_id: review.id, target_compareciente_id: null }), data: { status: "CUMPLIDO" } });
    expect(mocks.db.expedienteActividad.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ metadatos: expect.objectContaining({ action: "QUESTIONNAIRE_FINALIZED" }) })], skipDuplicates: true }));
  });
  it("retries exact finalized request without a second write", async () => {
    const final = { ...assessment, currentRevision: { ...assessment.currentRevision, status: "FINALIZED" } };
    mocks.db.complianceQuestionnaireAssessment.findFirst.mockResolvedValue(final);
    mocks.db.complianceQuestionnaireAssessmentRevision.findFirst.mockResolvedValue({ id: "final-test", status: "FINALIZED", answers: { "test-answer": true } });
    await expect(ComplianceH5Service.saveQuestionnaire(actor, assessment.id, { idempotency_key: "request", answers: { "test-answer": true } }, true)).resolves.toMatchObject({ id: "final-test" });
    expect(mocks.db.complianceQuestionnaireAssessmentRevision.create).not.toHaveBeenCalled();
  });
  it("blocks reopening finalized assessment with a different request", async () => {
    mocks.db.complianceQuestionnaireAssessment.findFirst.mockResolvedValue({ ...assessment, currentRevision: { ...assessment.currentRevision, status: "FINALIZED" } });
    await expect(ComplianceH5Service.saveQuestionnaire(actor, assessment.id, { idempotency_key: "new-request", answers: {} }, false)).rejects.toMatchObject({ code: "H5_QUESTIONNAIRE_FINALIZED_IMMUTABLE" });
  });
  it("does not repurpose an existing CFG FILE artifact", async () => {
    mocks.db.catalogoArtefacto.findFirst.mockResolvedValue({ id: "artifact-test", purpose: null });
    mocks.db.catalogoArtefactoVersion.findFirst.mockResolvedValue({ id: "file-test", content_kind: "FILE" });
    await expect(ComplianceH5Service.publishQuestionnaireDefinition(actor, "artifact-test", { definition })).rejects.toMatchObject({ code: "H5_ARTIFACT_RECLASSIFICATION_BLOCKED" });
    expect(mocks.db.catalogoArtefacto.update).not.toHaveBeenCalled();
  });
  it("marks absent definition without creating a fake questionnaire", async () => {
    mocks.db.complianceRequirement.findMany.mockResolvedValue([requirement]);
    mocks.db.complianceQuestionnaireAssessment.findFirst.mockResolvedValue(null);
    const result = await ComplianceH5Service.ensureQuestionnaires(actor, review.id);
    expect(result.unresolved_configuration).toBe(1);
    expect(mocks.db.complianceQuestionnaireAssessment.create).not.toHaveBeenCalled();
    expect(mocks.db.complianceRequirement.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ source_snapshot: { reason: "DEFINITION_NOT_CONFIGURED" } }) }));
  });
  it.each(["NaN", "Infinity", "-1"])("rejects invalid amount %s", async (amount) => {
    await expect(ComplianceH5Service.createPaymentRevision(actor, review.id, { idempotency_key: "request", amount_original: amount })).rejects.toMatchObject({ code: "H5_PAYMENT_AMOUNT_INVALID" });
    expect(mocks.db.complianceOperationPayment.create).not.toHaveBeenCalled();
  });
  it("requires provenance for a human FX conversion", async () => {
    await expect(ComplianceH5Service.createPaymentRevision(actor, review.id, { idempotency_key: "request", currency_original: "USD", amount_original: "1", exchange_rate: "18" })).rejects.toMatchObject({ code: "H5_PAYMENT_FX_PROVENANCE_REQUIRED" });
  });
  it("does not persist proposal confidence states as canonical payment states", async () => {
    await expect(ComplianceH5Service.createPaymentRevision(actor, review.id, { idempotency_key: "request", field_states: { amount_original: "UNCERTAIN" } })).rejects.toMatchObject({ code: "H5_PAYMENT_FIELD_STATE_INVALID" });
  });
  it("saves exact Decimal original values and an explicit current revision", async () => {
    mocks.db.complianceOperationPayment.create.mockResolvedValue({ id: "payment-test", currentRevision: null });
    const result = await ComplianceH5Service.createPaymentRevision(actor, review.id, { idempotency_key: "request", currency_original: "MXN", amount_original: "90071992547409.123456", payment_date: "2020-01-01" });
    expect(result.amount_original.toFixed(6)).toBe("90071992547409.123456");
    expect(result.equivalent_mxn).toEqual(new Prisma.Decimal("90071992547409.123456"));
    expect(mocks.db.complianceOperationPayment.update).toHaveBeenCalledWith({ where: { id: "payment-test" }, data: { current_revision_id: result.id } });
  });
  it("denies a same-tenant document when canonical document access rejects it", async () => {
    mocks.db.complianceOperationPayment.create.mockResolvedValue({ id: "payment-test", currentRevision: null });
    mocks.db.complianceEvidence.findMany.mockResolvedValue([{ id: "evidence-test", documento_id: "document-test", document_checksum_snapshot: "checksum", documento: { organization_id: actor.organizationId, estatus: "VIGENTE", checksum_sha256: "checksum" } }]);
    mocks.canAccessDocumento.mockResolvedValue(false);
    await expect(ComplianceH5Service.createPaymentRevision(actor, review.id, { idempotency_key: "request", evidence_ids: ["evidence-test"] })).rejects.toMatchObject({ code: "H5_PAYMENT_EVIDENCE_DOCUMENT_DENIED" });
    expect(mocks.db.complianceOperationPaymentRevision.create).not.toHaveBeenCalled();
  });
  it("denies proposal confirmation without sensitive/review permissions", async () => {
    await expect(ComplianceH5Service.confirmPaymentProposal({ ...actor, permissions: ["compliance.read"] }, "proposal-test", {})).rejects.toMatchObject({ code: "H5_SENSITIVE_ACCESS_DENIED" });
    expect(mocks.db.complianceAiProposal.findFirst).not.toHaveBeenCalled();
  });
  it("requires explicit human fields and never silently copies AI content", async () => {
    await expect(ComplianceH5Service.confirmPaymentProposal(actor, "proposal-test", {})).rejects.toMatchObject({ code: "H5_PAYMENT_REVIEWED_FIELDS_REQUIRED" });
  });
  it("rejects changed source version even when checksum is unchanged", async () => {
    mocks.db.complianceAiProposal.findFirst.mockResolvedValue({ id: "proposal-test", review_id: review.id, proposal_fingerprint: "proposal-fp", source_documents: [{ id: "document-test", checksum: "checksum", version: "2026-01-01T00:00:00.000Z" }] });
    mocks.db.documento.findMany.mockResolvedValue([{ id: "document-test", checksum_sha256: "checksum", fecha_carga: new Date("2026-01-02") }]);
    await expect(ComplianceH5Service.confirmPaymentProposal(actor, "proposal-test", { proposal_fingerprint: "proposal-fp", confirmed_fields: {} })).rejects.toMatchObject({ code: "H5_PAYMENT_PROPOSAL_SOURCE_STALE" });
    expect(mocks.db.complianceOperationPaymentRevision.create).not.toHaveBeenCalled();
    expect(mocks.db.complianceAiProposal.update).not.toHaveBeenCalled();
  });
  it("rejects a proposal without mutating the payment or recording free-text PII", async () => {
    mocks.db.complianceAiProposal.findFirst.mockResolvedValue({ id: "proposal-test", review_id: review.id, proposal_fingerprint: "proposal-fp" });
    await ComplianceH5Service.rejectPaymentProposal(actor, "proposal-test", { proposal_fingerprint: "proposal-fp", reason: "Synthetic sensitive text" });
    expect(mocks.db.complianceOperationPaymentRevision.create).not.toHaveBeenCalled();
    expect(mocks.db.complianceAiProposal.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "RECHAZADA_POR_HUMANO" }) }));
    expect(JSON.stringify(mocks.db.auditLog.create.mock.calls)).not.toContain("Synthetic sensitive text");
  });
});
