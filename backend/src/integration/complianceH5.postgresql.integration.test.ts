import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { ComplianceH5Service } from "../services/complianceH5.service";

function localTarget() {
  const url = new URL(process.env.DATABASE_URL || "");
  if (process.env.NODE_ENV !== "test" || process.env.H5_PG_TEST_CONFIRMATION !== "RUN_ISOLATED_H5_POSTGRESQL" ||
    process.env.DATABASE_URL !== process.env.DIRECT_URL || url.hostname !== "127.0.0.1" ||
    !["55464", "55465"].includes(url.port) || !/^\/pravia_h5_final_[ab](?:_\d+)?$/.test(url.pathname))
    throw new Error("H5 PostgreSQL requires the explicit isolated local A/B target.");
  console.info({ host: url.hostname, port: url.port, database: url.pathname.slice(1) });
  return url.toString();
}
const db = new PrismaClient({ datasources: { db: { url: localTarget() } } });
const id = randomUUID;
const ids = { org: id(), otherOrg: id(), user: id(), membership: id(), person: id(), otherPerson: id(), actType: id(), role: id(),
  exp: id(), exp2: id(), act: id(), act2: id(), relation: id(), review: id(), review2: id() };
const actor: any = { id: ids.user, organizationId: ids.org, rol: "ADMINISTRACION", permissions: [
  "compliance.read", "compliance.write", "compliance.review", "compliance.sensitive.read", "comparecientes.read", "documentos.read",
] };
const fp = "a".repeat(64);
let state: any, requirement: any, artifact: any, definition: any, assessment: any, cueRevision: any, methodology: any, methodRevision: any;
let payment: any, revision: any, evidence: any, project: any, verification: any;

async function paymentRevision(tx: Prisma.TransactionClient, overrides: any = {}) {
  const master = await tx.complianceOperationPayment.create({ data: { organization_id: ids.org, expediente_id: ids.exp, created_by_id: ids.user } });
  const created = await tx.complianceOperationPaymentRevision.create({ data: {
    organization_id: ids.org, payment_id: master.id, expediente_id: ids.exp, review_id: ids.review,
    revision_number: 1, scope: "GENERAL_INSTRUMENT", field_states: {}, semantic_fingerprint: fp,
    idempotency_key: id(), created_by_id: ids.user, ...overrides,
  } });
  await tx.complianceOperationPayment.update({ where: { id: master.id }, data: { current_revision_id: created.id } });
  return created;
}

async function installH5ShadowTables(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE compliance_operation_payment_revisions (
    id UUID PRIMARY KEY,
    status TEXT,
    scope pravia_os."CompliancePaymentScope"
  ) ON COMMIT DROP`);
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE compliance_operation_payment_acts (
    payment_revision_id UUID
  ) ON COMMIT DROP`);
  await tx.$executeRawUnsafe("SET LOCAL search_path TO pg_temp, public");
}

describe("H5 isolated PostgreSQL physical invariants", () => {
  beforeAll(async () => {
    const statements = [
      `INSERT INTO pravia_os.organizations(id,name,status,created_at,updated_at) VALUES ('${ids.org}','H5 TEST ONLY','ACTIVE',now(),now()),('${ids.otherOrg}','H5 OTHER TEST ONLY','ACTIVE',now(),now())`,
      `INSERT INTO pravia_os.users(id,email,password_hash,nombre,apellido,rol,activo,created_at,updated_at,requires_password_change) VALUES ('${ids.user}','${ids.user}@example.invalid','not-a-credential','Synthetic','H5','ADMINISTRACION',true,now(),now(),true)`,
      `INSERT INTO pravia_os.organization_memberships(id,organization_id,user_id,rol,status,created_at,updated_at) VALUES ('${ids.membership}','${ids.org}','${ids.user}','ADMINISTRACION','ACTIVE',now(),now())`,
      ...[ids.person, ids.otherPerson].map(person => `INSERT INTO pravia_os.comparecientes(id,organization_id,tipo_persona,nombre_busqueda,estatus,creado_por_id,created_at,updated_at,version) VALUES ('${person}','${ids.org}','FISICA','SYNTHETIC H5','ACTIVO','${ids.user}',now(),now(),1)`),
      `INSERT INTO pravia_os.tipos_acto(id,organization_id,nombre,activo,created_at,updated_at) VALUES ('${ids.actType}','${ids.org}','SYNTHETIC H5',true,now(),now())`,
      `INSERT INTO pravia_os.caracteres_compareciente(id,clave,nombre,activo,created_at) VALUES ('${ids.role}','H5_TEST_${ids.role}','TEST ONLY',true,now())`,
      ...[ids.exp, ids.exp2].map(exp => `INSERT INTO pravia_os.expedientes(id,organization_id,numero_pravia,abogado_id,creador_id,fecha_apertura,estatus,avance_documental,avance_financiero,avance_general,avance_operativo,created_at,updated_at,version) VALUES ('${exp}','${ids.org}','EXP-H5-${exp.slice(0,8)}','${ids.user}','${ids.user}',now(),'ABIERTO',0,0,0,0,now(),now(),1)`),
      ...[[ids.act, ids.exp], [ids.act2, ids.exp2]].map(([act, exp]) => `INSERT INTO pravia_os.expediente_actos(id,organization_id,expediente_id,tipo_acto_id,origen,estatus,created_by,created_at,updated_at) VALUES ('${act}','${ids.org}','${exp}','${ids.actType}','LEGACY_MIGRATION','ACTIVO','${ids.user}',now(),now())`),
      `INSERT INTO pravia_os.expediente_comparecientes(id,organization_id,expediente_id,expediente_acto_id,compareciente_id,caracter_id,forma_comparecencia,orden_comparecencia,es_principal,estatus,creado_por_id,created_at) VALUES ('${ids.relation}','${ids.org}','${ids.exp}','${ids.act}','${ids.person}','${ids.role}','PROPIO_DERECHO',1,false,'ACTIVO','${ids.user}',now())`,
      ...[[ids.review, ids.exp], [ids.review2, ids.exp2]].map(([review, exp]) => `INSERT INTO pravia_os.compliance_reviews(id,organization_id,expediente_id,tipo,estatus,rule_version_snapshot,cuestionario_json,rule_snapshot,master_snapshot,snapshot_captured_at,creado_por_id,created_at,updated_at,engine_version,idempotency_key,is_canonical_legal_engine) VALUES ('${review}','${ids.org}','${exp}','LEGAL_H1','EVALUACION_DETERMINISTA','SYNTHETIC','{}','{}','{}',now(),'${ids.user}',now(),now(),'H5-TEST','${review}',true)`),
    ];
    await db.$transaction(async tx => { for (const sql of statements) await tx.$executeRawUnsafe(sql); });
    state = await db.expedienteComplianceState.create({ data: { organization_id: ids.org, expediente_id: ids.exp, current_review_id: ids.review, updated_by_id: ids.user } });
    requirement = await db.complianceRequirement.create({ data: { organization_id: ids.org, expediente_id: ids.exp, state_id: state.id, review_id: ids.review,
      provider: "CUE", requirement_key: "CUE:GENERAL", label: "SYNTHETIC ONLY", status: "PENDIENTE", source_snapshot: {} } });
    const notaria = await db.notaria.create({ data: { organization_id: ids.org, nombre: "SYNTHETIC ONLY" } });
    artifact = await db.catalogoArtefacto.create({ data: { organization_id: ids.org, tipo: "FORMATO", propietario_tipo: "NOTARIA", notaria_id: notaria.id, nombre: "SYNTHETIC ONLY", purpose: "CUE_GENERAL", creado_por_id: ids.user, actualizado_por_id: ids.user } });
    definition = await db.catalogoArtefactoVersion.create({ data: { organization_id: ids.org, artefacto_id: artifact.id, version: 1, origen: "TEST ONLY", content_kind: "STRUCTURED_QUESTIONNAIRE", definition_json: { schema_version: 1, scope: "GENERAL", sections: [{ id: "s", label: "Synthetic", questions: [{ id: "q", type: "BOOLEAN", label: "Synthetic", required: true }] }] }, definition_checksum: fp, schema_version: 1, creado_por_id: ids.user } });
    methodology = await db.complianceRiskMethodology.create({ data: { organization_id: ids.org, stable_key: id(), scope: "GENERAL", name: "TEST ONLY", created_by_id: ids.user } });
    methodRevision = await db.complianceRiskMethodologyRevision.create({ data: { organization_id: ids.org, methodology_id: methodology.id, revision_number: 1,
      compatible_definition_version_id: definition.id, taxonomy: { TEST: "TEST ONLY" }, factor_dsl: {}, output_mapping: {}, checksum: fp, provenance: { synthetic: true }, created_by_id: ids.user } });
    assessment = await db.complianceQuestionnaireAssessment.create({ data: { organization_id: ids.org, expediente_id: ids.exp, review_id: ids.review, requirement_id: requirement.id,
      scope: "GENERAL", identity_key: "GENERAL", definition_version_id: definition.id, trigger_snapshot: [], created_by_id: ids.user } });
    cueRevision = await db.complianceQuestionnaireAssessmentRevision.create({ data: { organization_id: ids.org, assessment_id: assessment.id, revision_number: 1,
      status: "FINALIZED", answers: { q: true }, definition_version_id: definition.id, definition_checksum: fp, completeness: "COMPLETE", missing_question_ids: [],
      methodology_revision_id: methodRevision.id, evaluation_status: "EVALUATED", evaluation_snapshot: { synthetic: true }, semantic_fingerprint: fp, idempotency_key: id(),
      created_by_id: ids.user, finalized_by_id: ids.user, finalized_at: new Date() } });
    await db.complianceQuestionnaireAssessment.update({ where: { id: assessment.id }, data: { current_revision_id: cueRevision.id } });
    project = await db.documento.create({ data: { organization_id: ids.org, expediente_id: ids.exp, nombre_original: "SYNTHETIC.pdf", nombre_interno: id(), tipo: "PROYECTO_ESCRITURA", categoria: "OTROS", storage_key: `synthetic/${id()}`, mime_type: "application/pdf", size_bytes: 1, checksum_sha256: fp, subido_por_id: ids.user } });
    evidence = await db.complianceEvidence.create({ data: { organization_id: ids.org, review_id: ids.review, expediente_id: ids.exp, documento_id: project.id, tipo_evidencia: "TEST ONLY", agregado_por_id: ids.user, document_version: "TEST", document_checksum_snapshot: fp } });
    revision = await db.$transaction(async tx => {
      const item = await paymentRevision(tx, { status: "CONFIRMED", confirmed_by_id: ids.user, confirmed_at: new Date() });
      await tx.complianceOperationPaymentParty.create({ data: { organization_id: ids.org, payment_revision_id: item.id, expediente_id: ids.exp, expediente_compareciente_id: ids.relation, compareciente_id: ids.person, role: "PAYER" } });
      await tx.complianceOperationPaymentEvidence.create({ data: { organization_id: ids.org, payment_revision_id: item.id, evidence_id: evidence.id } });
      return item;
    });
    payment = await db.complianceOperationPayment.findUniqueOrThrow({ where: { id: revision.payment_id } });
    verification = await db.complianceOperationPaymentVerification.create({ data: { organization_id: ids.org, payment_revision_id: revision.id, project_document_id: project.id,
      project_document_version: fp, project_document_checksum: fp, comparison_snapshot: { synthetic: true }, status: "REVIEW_REQUIRED", semantic_fingerprint: fp, idempotency_key: id(), created_by_id: ids.user } });
  });
  afterAll(async () => { await db.$disconnect(); });

  it("has exactly the eleven frozen tenant models with physical tenant columns", async () => {
    const names = ["ComplianceQuestionnaireAssessment", "ComplianceQuestionnaireAssessmentRevision", "ComplianceRiskMethodology", "ComplianceRiskMethodologyRevision", "ComplianceOperationPayment", "ComplianceOperationPaymentRevision", "ComplianceOperationPaymentAct", "ComplianceOperationPaymentParty", "ComplianceOperationPaymentEvidence", "ComplianceOperationPaymentVerification", "ComplianceOperationPaymentVerificationRule"];
    for (const name of names) {
      const model = Prisma.dmmf.datamodel.models.find(item => item.name === name)!;
      const rows: any[] = await db.$queryRaw`SELECT is_nullable FROM information_schema.columns WHERE table_schema='pravia_os' AND table_name=${model.dbName} AND column_name='organization_id'`;
      expect(rows).toEqual([{ is_nullable: "NO" }]);
    }
  });
  it("supports the real service MXN payment without inventing an FX conversion", async () => {
    const created = await db.$transaction(tx => ComplianceH5Service.createPaymentRevision(actor, ids.review, { idempotency_key: id(), amount_original: "123.456789", currency_original: "MXN" }, undefined, tx));
    expect(created.amount_original?.toString()).toBe("123.456789"); expect(created.exchange_rate).toBeNull();
  });
  it("rejects a valid foreign tenant actor on the new payment master", async () => {
    await expect(db.complianceOperationPayment.create({ data: { organization_id: ids.otherOrg, expediente_id: ids.exp, created_by_id: ids.user } })).rejects.toThrow();
  });
  it("rejects a valid wrong-case review on a payment revision", async () => {
    await expect(db.$transaction(tx => paymentRevision(tx, { review_id: ids.review2 }))).rejects.toThrow();
  });
  it("rejects a valid wrong-case parent payment", async () => {
    await expect(db.$transaction(tx => paymentRevision(tx, { expediente_id: ids.exp2, review_id: ids.review2 }))).rejects.toThrow();
  });
  it("requires an actual nonempty explicit act set at transaction commit", async () => {
    await expect(db.$transaction(async tx => { await paymentRevision(tx, { scope: "EXPLICIT_ACT_SET" }); await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE"); })).rejects.toThrow(/H5_EXPLICIT_PAYMENT_REQUIRES_ACT/);
  });
  it("supports a valid explicit act and rejects a same-tenant act from another case", async () => {
    await db.$transaction(async tx => { const item = await paymentRevision(tx, { scope: "EXPLICIT_ACT_SET" }); await tx.complianceOperationPaymentAct.create({ data: { organization_id: ids.org, payment_revision_id: item.id, expediente_id: ids.exp, expediente_acto_id: ids.act } }); });
    await expect(db.$transaction(async tx => { const item = await paymentRevision(tx, { scope: "EXPLICIT_ACT_SET" }); await tx.complianceOperationPaymentAct.create({ data: { organization_id: ids.org, payment_revision_id: item.id, expediente_id: ids.exp2, expediente_acto_id: ids.act2 } }); })).rejects.toThrow();
  });
  it("rejects mismatching person identity despite a valid same-case relation ID", async () => {
    await expect(db.$transaction(async tx => { const item = await paymentRevision(tx); await tx.complianceOperationPaymentParty.create({ data: { organization_id: ids.org, payment_revision_id: item.id, expediente_id: ids.exp, expediente_compareciente_id: ids.relation, compareciente_id: ids.otherPerson, role: "PAYER" } }); })).rejects.toThrow();
  });
  it("preserves confirmed payment facts and N:M history against later UPDATE/INSERT/DELETE", async () => {
    await expect(db.complianceOperationPaymentRevision.update({ where: { id: revision.id }, data: { reference: "CHANGED" } })).rejects.toThrow(/H5_CONFIRMED_PAYMENT_REVISION_IMMUTABLE/);
    await expect(db.complianceOperationPaymentParty.create({ data: { organization_id: ids.org, payment_revision_id: revision.id, expediente_id: ids.exp, expediente_compareciente_id: ids.relation, compareciente_id: ids.person, role: "PAYEE" } })).rejects.toThrow(/H5_CONFIRMED_PAYMENT_LINK_IMMUTABLE/);
    await expect(db.complianceOperationPaymentEvidence.deleteMany({ where: { payment_revision_id: revision.id } })).rejects.toThrow(/H5_CONFIRMED_PAYMENT_LINK_IMMUTABLE/);
  });
  it("resists absent-schema and pg_temp shadowing while preserving valid draft and scope transitions", async () => {
    const confirmedActRevision = await db.$transaction(async tx => {
      const item = await paymentRevision(tx, { status: "CONFIRMED", scope: "EXPLICIT_ACT_SET", confirmed_by_id: ids.user, confirmed_at: new Date() });
      await tx.complianceOperationPaymentAct.create({ data: { organization_id: ids.org, payment_revision_id: item.id, expediente_id: ids.exp, expediente_acto_id: ids.act } });
      return item;
    });

    for (const [table, mutation] of [
      ["evidence", `UPDATE pravia_os.compliance_operation_payment_evidence SET relation_kind='FORENSIC' WHERE payment_revision_id='${revision.id}'`],
      ["party", `UPDATE pravia_os.compliance_operation_payment_parties SET role='PAYEE' WHERE payment_revision_id='${revision.id}'`],
      ["act", `DELETE FROM pravia_os.compliance_operation_payment_acts WHERE payment_revision_id='${confirmedActRevision.id}'`],
    ] as const) {
      await expect(db.$transaction(async tx => {
        await installH5ShadowTables(tx);
        await tx.$executeRawUnsafe(mutation);
      }), table).rejects.toThrow(/H5_CONFIRMED_PAYMENT_LINK_IMMUTABLE/);
    }

    const draft = await db.$transaction(async tx => {
      const item = await paymentRevision(tx);
      await tx.complianceOperationPaymentEvidence.create({ data: { organization_id: ids.org, payment_revision_id: item.id, evidence_id: evidence.id } });
      return item;
    });
    await db.$transaction(async tx => {
      await installH5ShadowTables(tx);
      await tx.$executeRawUnsafe(`UPDATE pravia_os.compliance_operation_payment_evidence SET relation_kind='DRAFT_CONTROL' WHERE payment_revision_id='${draft.id}'`);
    });
    expect((await db.complianceOperationPaymentEvidence.findFirstOrThrow({ where: { payment_revision_id: draft.id } })).relation_kind).toBe("DRAFT_CONTROL");
    await db.complianceOperationPaymentEvidence.deleteMany({ where: { payment_revision_id: draft.id } });

    const explicitWithAct = await db.$transaction(async tx => {
      const item = await paymentRevision(tx, { scope: "EXPLICIT_ACT_SET" });
      await tx.complianceOperationPaymentAct.create({ data: { organization_id: ids.org, payment_revision_id: item.id, expediente_id: ids.exp, expediente_acto_id: ids.act } });
      return item;
    });
    await expect(db.$transaction(async tx => {
      await installH5ShadowTables(tx);
      await tx.$executeRawUnsafe(`UPDATE pravia_os.compliance_operation_payment_revisions SET scope='GENERAL_INSTRUMENT' WHERE id='${explicitWithAct.id}'`);
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    })).rejects.toThrow(/H5_GENERAL_PAYMENT_CANNOT_HAVE_ACTS/);

    await expect(db.$transaction(async tx => {
      await installH5ShadowTables(tx);
      await paymentRevision(tx, { scope: "EXPLICIT_ACT_SET" });
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    })).rejects.toThrow(/H5_EXPLICIT_PAYMENT_REQUIRES_ACT/);

    await db.$transaction(async tx => {
      await installH5ShadowTables(tx);
      await paymentRevision(tx);
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    });
    await db.$transaction(async tx => {
      await installH5ShadowTables(tx);
      const item = await paymentRevision(tx, { scope: "EXPLICIT_ACT_SET" });
      await tx.complianceOperationPaymentAct.create({ data: { organization_id: ids.org, payment_revision_id: item.id, expediente_id: ids.exp, expediente_acto_id: ids.act } });
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    });

    await db.$transaction(async tx => {
      await installH5ShadowTables(tx);
      await tx.complianceOperationPaymentAct.deleteMany({ where: { payment_revision_id: explicitWithAct.id } });
      await tx.complianceOperationPaymentRevision.update({ where: { id: explicitWithAct.id }, data: { scope: "GENERAL_INSTRUMENT" } });
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    });
    await db.$transaction(async tx => {
      await installH5ShadowTables(tx);
      await tx.complianceOperationPaymentRevision.update({ where: { id: explicitWithAct.id }, data: { scope: "EXPLICIT_ACT_SET" } });
      await tx.complianceOperationPaymentAct.create({ data: { organization_id: ids.org, payment_revision_id: explicitWithAct.id, expediente_id: ids.exp, expediente_acto_id: ids.act } });
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    });
  });
  it("rejects a current pointer to a different payment's revision", async () => {
    const other = await db.$transaction(tx => paymentRevision(tx));
    await expect(db.complianceOperationPayment.update({ where: { id: payment.id }, data: { current_revision_id: other.id } })).rejects.toThrow();
  });
  it("allows one receipt to support another revision without changing its original link", async () => {
    const other = await db.$transaction(async tx => { const item = await paymentRevision(tx); await tx.complianceOperationPaymentEvidence.create({ data: { organization_id: ids.org, payment_revision_id: item.id, evidence_id: evidence.id } }); return item; });
    expect(await db.complianceOperationPaymentEvidence.count({ where: { evidence_id: evidence.id } })).toBe(2);
    expect(other.id).not.toBe(revision.id);
  });
  it("freezes final answers, risk methodology content and verification snapshots", async () => {
    await expect(db.complianceQuestionnaireAssessmentRevision.update({ where: { id: cueRevision.id }, data: { answers: {} } })).rejects.toThrow(/H5_FINALIZED_QUESTIONNAIRE_IMMUTABLE/);
    await expect(db.complianceRiskMethodologyRevision.update({ where: { id: methodRevision.id }, data: { taxonomy: {} } })).rejects.toThrow(/H5_METHODOLOGY_CONTENT_IMMUTABLE/);
    await expect(db.complianceOperationPaymentVerification.update({ where: { id: verification.id }, data: { status: "MATCH" } })).rejects.toThrow(/H5_VERIFICATION_HISTORY_IMMUTABLE/);
  });
  it("physically prevents finalization without completeness and exact methodology", async () => {
    await expect(db.complianceQuestionnaireAssessmentRevision.create({ data: { organization_id: ids.org, assessment_id: assessment.id, revision_number: 2, status: "FINALIZED",
      answers: {}, definition_version_id: definition.id, definition_checksum: fp, missing_question_ids: ["q"], semantic_fingerprint: fp, idempotency_key: id(), created_by_id: ids.user,
      finalized_by_id: ids.user, finalized_at: new Date() } })).rejects.toThrow();
  });
  it("does not change the existing party role or create a second service-finance payment", async () => {
    expect((await db.expedienteCompareciente.findUniqueOrThrow({ where: { id: ids.relation } })).caracter_id).toBe(ids.role);
    expect(await db.pago.count({ where: { organization_id: ids.org } })).toBe(0);
  });
});
