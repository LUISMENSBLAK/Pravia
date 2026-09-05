-- H6 · CUM-FIR-001 + CUM-AVI-001. Infrastructure only: no legal or official format data is seeded.
BEGIN;
SET LOCAL search_path TO pravia_os, public;

-- CreateEnum
CREATE TYPE "ComplianceRequirementPhase" AS ENUM ('PRE_FIRMA', 'POST_FIRMA', 'CONTINUA');

-- CreateEnum
CREATE TYPE "ComplianceRequirementTrigger" AS ENUM ('CURRENT_FACTS', 'EXPEDIENTE_FIRMADO');

-- CreateEnum
CREATE TYPE "ComplianceObligationScopeKind" AS ENUM ('EXPEDIENTE', 'ACT_SET', 'SUBJECT', 'INSTRUMENT');

-- CreateEnum
CREATE TYPE "ComplianceAviState" AS ENUM ('NO_APLICA', 'PENDIENTE', 'INFORMACION_INCOMPLETA', 'VALIDADO', 'LISTO_PARA_PRESENTAR', 'PRESENTADO', 'ACUSE_CARGADO', 'CUMPLIDO');

-- CreateEnum
CREATE TYPE "ComplianceFreshness" AS ENUM ('CURRENT', 'STALE');

-- CreateEnum
CREATE TYPE "ComplianceOfficialRevisionStatus" AS ENUM ('DRAFT', 'VERIFIED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ComplianceOfficialEffectiveDateBasis" AS ENUM ('LEGAL_DATE', 'GENERATION_DATE', 'PRESENTATION_DATE');

-- CreateEnum
CREATE TYPE "ComplianceNoticeFicheStatus" AS ENUM ('DRAFT', 'VALIDATED');

-- CreateEnum
CREATE TYPE "ComplianceNoticePresentationKind" AS ENUM ('NORMAL', 'COMPLEMENTARIA', 'CORRECCION');

-- EXP-006 remains the canonical artifact catalog; H6 only adds the missing signable purpose.
ALTER TYPE "CatalogoArtefactoPurpose" ADD VALUE IF NOT EXISTS 'FIR_SIGNATURE_RELEVANT';

-- CreateEnum
CREATE TYPE "ExpedienteDocumentoRole" AS ENUM ('PROJECT_DRAFT', 'DEFINITIVE_DEED');

-- DropIndex
DROP INDEX "compliance_obligations_review_id_type_key";

-- AlterTable
ALTER TABLE "expediente_documentos" ADD COLUMN     "document_role" "ExpedienteDocumentoRole";

-- AlterTable
ALTER TABLE "compliance_obligations" ADD COLUMN     "avi_state" "ComplianceAviState" NOT NULL DEFAULT 'PENDIENTE',
ADD COLUMN     "canonical_scope_key" VARCHAR(320),
ADD COLUMN     "canonical_scope_kind" "ComplianceObligationScopeKind",
ADD COLUMN     "channel_code" VARCHAR(80),
ADD COLUMN     "expediente_id" UUID,
ADD COLUMN     "freshness" "ComplianceFreshness" NOT NULL DEFAULT 'CURRENT',
ADD COLUMN     "h6_migration_status" VARCHAR(48),
ADD COLUMN     "legal_obligation_key" VARCHAR(160),
ADD COLUMN     "obligation_type_code" VARCHAR(80),
ADD COLUMN     "review_needed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stable_identity_hash" VARCHAR(64);

-- AlterTable
ALTER TABLE "compliance_requirements" ADD COLUMN     "obligation_id" UUID,
ADD COLUMN     "phase" "ComplianceRequirementPhase" NOT NULL DEFAULT 'CONTINUA',
ADD COLUMN     "trigger" "ComplianceRequirementTrigger" NOT NULL DEFAULT 'CURRENT_FACTS';

-- CreateTable
CREATE TABLE "compliance_official_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stable_definition_key" VARCHAR(160) NOT NULL,
    "institution_code" VARCHAR(120) NOT NULL,
    "channel_code" VARCHAR(80) NOT NULL,
    "product_family" VARCHAR(120) NOT NULL,
    "product_type" VARCHAR(120) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_official_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_official_definition_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "definition_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "status" "ComplianceOfficialRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "effective_date_basis" "ComplianceOfficialEffectiveDateBasis" NOT NULL,
    "schema_json" JSONB NOT NULL,
    "mappings_json" JSONB NOT NULL,
    "requiredness_json" JSONB NOT NULL,
    "catalogs_json" JSONB NOT NULL,
    "transformations_json" JSONB NOT NULL,
    "validations_json" JSONB NOT NULL,
    "layout_key" VARCHAR(120) NOT NULL,
    "product_type" VARCHAR(120) NOT NULL,
    "adapter_version" VARCHAR(80) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "provenance" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "verified_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),

    CONSTRAINT "compliance_official_definition_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_official_definition_activations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activated_by_id" UUID NOT NULL,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMP(3),

    CONSTRAINT "compliance_official_definition_activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_obligation_triggers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "rule_result_id" UUID NOT NULL,
    "rule_revision_id" UUID NOT NULL,
    "expediente_acto_id" UUID,
    "trigger_identity_hash" VARCHAR(64) NOT NULL,
    "applicability" "ComplianceApplicabilityState" NOT NULL,
    "source_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_obligation_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_notice_fiche_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "official_revision_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "status" "ComplianceNoticeFicheStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "base_revision_id" UUID,
    "local_values" JSONB NOT NULL,
    "source_manifest" JSONB NOT NULL,
    "validation_snapshot" JSONB,
    "source_fingerprint" VARCHAR(64) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validated_at" TIMESTAMP(3),

    CONSTRAINT "compliance_notice_fiche_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_official_products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "fiche_revision_id" UUID NOT NULL,
    "official_revision_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "adapter_key" VARCHAR(120) NOT NULL,
    "adapter_version" VARCHAR(80) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "source_fingerprint" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_official_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_notice_presentations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "fiche_revision_id" UUID,
    "product_id" UUID,
    "previous_presentation_id" UUID,
    "kind" "ComplianceNoticePresentationKind" NOT NULL,
    "presented_at" TIMESTAMP(3) NOT NULL,
    "external_folio" VARCHAR(200),
    "channel_snapshot" VARCHAR(80) NOT NULL,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "metadata" JSONB,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_notice_presentations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_notice_acknowledgements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "presentation_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "evidence_id" UUID,
    "acknowledgement_type" VARCHAR(80) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_notice_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- Deterministic tenant/case lineage. Rows that cannot be classified remain intact and nullable.
UPDATE "compliance_obligations" o
SET "organization_id" = r."organization_id",
    "expediente_id" = r."expediente_id",
    "channel_code" = NULLIF(BTRIM(o."channel"), ''),
    "obligation_type_code" = NULLIF(SPLIT_PART(o."type", ':', 1), ''),
    "legal_obligation_key" = NULLIF(BTRIM(o."obligation_key"), '')
FROM "compliance_reviews" r
WHERE r."id" = o."review_id"
  AND (o."organization_id" IS NULL OR o."expediente_id" IS NULL);

UPDATE "compliance_obligations" o
SET "canonical_scope_kind" = 'ACT_SET',
    "canonical_scope_key" = 'ACT_SET:' || rr."expediente_acto_id"::text,
    "stable_identity_hash" = encode(digest(concat_ws('|', o."organization_id"::text, o."expediente_id"::text,
      o."legal_obligation_key", o."channel_code", o."obligation_type_code", 'ACT_SET', rr."expediente_acto_id"::text), 'sha256'), 'hex'),
    "h6_migration_status" = CASE
      WHEN o."external_filed_at" IS NULL AND o."external_folio" IS NULL AND o."external_receipt_id" IS NULL THEN 'STABLE_IDENTITY_BACKFILLED'
      WHEN o."external_filed_at" IS NOT NULL AND o."external_folio" IS NOT NULL AND o."external_receipt_id" IS NOT NULL AND o."external_confirmed_by" IS NOT NULL THEN 'A_PRESENTATION_ACK_READY'
      WHEN o."external_filed_at" IS NOT NULL AND o."external_folio" IS NOT NULL AND o."external_receipt_id" IS NULL AND o."external_confirmed_by" IS NOT NULL THEN 'B_PRESENTATION_READY'
      WHEN o."external_filed_at" IS NOT NULL OR o."external_folio" IS NOT NULL OR o."external_receipt_id" IS NOT NULL THEN 'C_AMBIGUOUS_INCOMPLETE'
      ELSE 'C_AMBIGUOUS_INCOMPLETE'
    END
FROM "compliance_rule_results" rr
WHERE rr."id" = o."rule_result_id"
  AND rr."expediente_acto_id" IS NOT NULL
  AND o."organization_id" IS NOT NULL
  AND o."expediente_id" IS NOT NULL
  AND o."legal_obligation_key" IS NOT NULL
  AND o."channel_code" IS NOT NULL
  AND o."obligation_type_code" IS NOT NULL;

UPDATE "compliance_obligations"
SET "h6_migration_status" = CASE
  WHEN "external_filed_at" IS NULL AND "external_folio" IS NULL AND "external_receipt_id" IS NULL THEN 'UNRESOLVED_LEGACY_IDENTITY'
  WHEN "external_filed_at" IS NOT NULL OR "external_folio" IS NOT NULL OR "external_receipt_id" IS NOT NULL THEN 'D_HISTORICAL_ONLY_INCOMPATIBLE'
  ELSE 'C_AMBIGUOUS_INCOMPLETE'
END
WHERE "h6_migration_status" IS NULL;

-- Deterministic legacy A/B materialization. C/D rows stay untouched; no missing value is synthesized.
UPDATE "compliance_obligations" o
SET "h6_migration_status" = 'C_AMBIGUOUS_INCOMPLETE'
WHERE o."h6_migration_status" IN ('A_PRESENTATION_ACK_READY', 'B_PRESENTATION_READY')
  AND NOT EXISTS (
    SELECT 1 FROM "organization_memberships" m
    WHERE m."organization_id" = o."organization_id" AND m."user_id" = o."external_confirmed_by"
  );

UPDATE "compliance_obligations" o
SET "h6_migration_status" = 'C_AMBIGUOUS_INCOMPLETE'
WHERE o."h6_migration_status" = 'A_PRESENTATION_ACK_READY'
  AND NOT EXISTS (
    SELECT 1 FROM "documentos" d
    WHERE d."id" = o."external_receipt_id" AND d."organization_id" = o."organization_id"
      AND d."expediente_id" = o."expediente_id" AND d."checksum_sha256" IS NOT NULL
  );

INSERT INTO "compliance_notice_presentations" (
  "id", "organization_id", "obligation_id", "fiche_revision_id", "product_id",
  "previous_presentation_id", "kind", "presented_at", "external_folio", "channel_snapshot",
  "idempotency_key", "metadata", "created_by_id", "created_at"
)
SELECT gen_random_uuid(), o."organization_id", o."id", NULL, NULL, NULL, 'NORMAL',
  o."external_filed_at", o."external_folio", COALESCE(o."channel_code", o."channel"),
  'H6:LEGACY:PRESENTATION:' || o."id"::text,
  jsonb_build_object('source', 'LEGACY_COMPLIANCE_OBLIGATION', 'classification', o."h6_migration_status"),
  o."external_confirmed_by", COALESCE(o."external_filed_at", o."created_at")
FROM "compliance_obligations" o
WHERE o."h6_migration_status" IN ('A_PRESENTATION_ACK_READY', 'B_PRESENTATION_READY');

INSERT INTO "compliance_notice_acknowledgements" (
  "id", "organization_id", "presentation_id", "documento_id", "evidence_id",
  "acknowledgement_type", "received_at", "checksum", "idempotency_key", "created_by_id", "created_at"
)
SELECT gen_random_uuid(), o."organization_id", p."id", d."id", NULL,
  'LEGACY_EXTERNAL_RECEIPT', d."fecha_carga", d."checksum_sha256",
  'H6:LEGACY:ACK:' || o."id"::text, o."external_confirmed_by", d."fecha_carga"
FROM "compliance_obligations" o
JOIN "compliance_notice_presentations" p
  ON p."organization_id" = o."organization_id" AND p."obligation_id" = o."id"
  AND p."idempotency_key" = 'H6:LEGACY:PRESENTATION:' || o."id"::text
JOIN "documentos" d ON d."id" = o."external_receipt_id" AND d."organization_id" = o."organization_id"
WHERE o."h6_migration_status" = 'A_PRESENTATION_ACK_READY';

-- Canonical project/deed role backfill is deliberately limited to unambiguous active rows.
UPDATE "expediente_documentos" ed
SET "organization_id" = e."organization_id"
FROM "expedientes" e
WHERE e."id" = ed."expediente_id" AND ed."organization_id" IS NULL;

UPDATE "expediente_documentos"
SET "document_role" = 'PROJECT_DRAFT'
WHERE "tipo_vinculo" = 'PROYECTO_ESCRITURA' AND "estatus" = 'ACTIVO';

WITH final_candidates AS (
  SELECT ed."id", COUNT(*) OVER (PARTITION BY ed."expediente_id") AS candidate_count
  FROM "expediente_documentos" ed
  JOIN "documentos" d ON d."id" = ed."documento_id"
  WHERE ed."tipo_vinculo" = 'PROYECTO_ESCRITURA' AND ed."estatus" = 'ACTIVO'
    AND COALESCE((d."datos_extraidos" #>> '{proyecto,es_version_final}')::boolean, false) = true
)
UPDATE "expediente_documentos" ed
SET "document_role" = 'DEFINITIVE_DEED'
FROM final_candidates fc
WHERE fc."id" = ed."id" AND fc.candidate_count = 1;

-- CreateIndex
CREATE UNIQUE INDEX "h6_official_definition_identity_key" ON "compliance_official_definitions"("stable_definition_key", "channel_code", "product_type");

-- CreateIndex
CREATE INDEX "idx_h6_official_revision_selection" ON "compliance_official_definition_revisions"("definition_id", "status", "effective_from", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "h6_official_definition_revision_number_key" ON "compliance_official_definition_revisions"("definition_id", "revision_number");

-- CreateIndex
CREATE UNIQUE INDEX "h6_official_definition_revision_parent_key" ON "compliance_official_definition_revisions"("id", "definition_id");

-- CreateIndex
CREATE INDEX "idx_h6_official_activation_selection" ON "compliance_official_definition_activations"("organization_id", "active", "definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "h6_official_activation_revision_key" ON "compliance_official_definition_activations"("organization_id", "definition_id", "revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "h6_official_activation_tenant_key" ON "compliance_official_definition_activations"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_h6_obligation_trigger_lineage" ON "compliance_obligation_triggers"("organization_id", "review_id", "rule_result_id");

-- CreateIndex
CREATE UNIQUE INDEX "h6_obligation_trigger_identity_key" ON "compliance_obligation_triggers"("organization_id", "obligation_id", "trigger_identity_hash");

-- CreateIndex
CREATE UNIQUE INDEX "h6_obligation_trigger_tenant_key" ON "compliance_obligation_triggers"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_h6_notice_fiche_current" ON "compliance_notice_fiche_revisions"("organization_id", "obligation_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "h6_notice_fiche_revision_number_key" ON "compliance_notice_fiche_revisions"("organization_id", "obligation_id", "revision_number");

-- CreateIndex
CREATE UNIQUE INDEX "h6_notice_fiche_tenant_key" ON "compliance_notice_fiche_revisions"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_h6_official_product_history" ON "compliance_official_products"("organization_id", "obligation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "h6_official_product_idempotency_key" ON "compliance_official_products"("organization_id", "obligation_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "h6_official_product_tenant_key" ON "compliance_official_products"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_h6_notice_presentation_history" ON "compliance_notice_presentations"("organization_id", "obligation_id", "presented_at");

-- CreateIndex
CREATE INDEX "idx_h6_notice_presentation_previous" ON "compliance_notice_presentations"("previous_presentation_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "h6_notice_presentation_idempotency_key" ON "compliance_notice_presentations"("organization_id", "obligation_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "h6_notice_presentation_tenant_key" ON "compliance_notice_presentations"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_h6_notice_ack_history" ON "compliance_notice_acknowledgements"("organization_id", "presentation_id", "received_at");

-- CreateIndex
CREATE INDEX "idx_h6_notice_ack_evidence" ON "compliance_notice_acknowledgements"("evidence_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "h6_notice_ack_idempotency_key" ON "compliance_notice_acknowledgements"("organization_id", "presentation_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "h6_notice_ack_tenant_key" ON "compliance_notice_acknowledgements"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "h6_compliance_obligation_tenant_key" ON "compliance_obligations"("id", "organization_id");

CREATE UNIQUE INDEX "h6_compliance_review_tenant_key" ON "compliance_reviews"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "h6_compliance_obligation_stable_identity_key" ON "compliance_obligations"("organization_id", "expediente_id", "stable_identity_hash");

-- CreateIndex
CREATE UNIQUE INDEX "h6_compliance_requirement_stable_projection_key" ON "compliance_requirements"("organization_id", "obligation_id", "provider");

CREATE UNIQUE INDEX "h6_one_active_official_revision_per_org_definition"
ON "compliance_official_definition_activations"("organization_id", "definition_id")
WHERE "active" = true;

CREATE UNIQUE INDEX "h6_one_active_definitive_deed_per_case"
ON "expediente_documentos"("organization_id", "expediente_id")
WHERE "estatus" = 'ACTIVO' AND "document_role" = 'DEFINITIVE_DEED';

-- Verified official definitions and validated fiche snapshots are immutable evidence.
CREATE OR REPLACE FUNCTION h6_guard_official_revision_immutability() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'DRAFT' AND ROW(NEW.definition_id, NEW.revision_number, NEW.effective_from, NEW.effective_to,
    NEW.effective_date_basis, NEW.schema_json, NEW.mappings_json, NEW.requiredness_json, NEW.catalogs_json,
    NEW.transformations_json, NEW.validations_json, NEW.layout_key, NEW.product_type, NEW.adapter_version,
    NEW.checksum, NEW.provenance, NEW.created_by_id, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.definition_id, OLD.revision_number, OLD.effective_from, OLD.effective_to,
    OLD.effective_date_basis, OLD.schema_json, OLD.mappings_json, OLD.requiredness_json, OLD.catalogs_json,
    OLD.transformations_json, OLD.validations_json, OLD.layout_key, OLD.product_type, OLD.adapter_version,
    OLD.checksum, OLD.provenance, OLD.created_by_id, OLD.created_at) THEN
    RAISE EXCEPTION 'H6_OFFICIAL_REVISION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "h6_official_revision_immutable"
BEFORE UPDATE ON "compliance_official_definition_revisions"
FOR EACH ROW EXECUTE FUNCTION h6_guard_official_revision_immutability();

CREATE OR REPLACE FUNCTION h6_guard_validated_fiche_immutability() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'VALIDATED' THEN
    RAISE EXCEPTION 'H6_VALIDATED_FICHE_IMMUTABLE';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "h6_validated_fiche_immutable"
BEFORE UPDATE OR DELETE ON "compliance_notice_fiche_revisions"
FOR EACH ROW EXECUTE FUNCTION h6_guard_validated_fiche_immutability();

CREATE OR REPLACE FUNCTION h6_reject_append_only_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'H6_APPEND_ONLY_RECORD_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "h6_official_product_append_only"
BEFORE UPDATE OR DELETE ON "compliance_official_products"
FOR EACH ROW EXECUTE FUNCTION h6_reject_append_only_mutation();
CREATE TRIGGER "h6_notice_presentation_append_only"
BEFORE UPDATE OR DELETE ON "compliance_notice_presentations"
FOR EACH ROW EXECUTE FUNCTION h6_reject_append_only_mutation();
CREATE TRIGGER "h6_notice_acknowledgement_append_only"
BEFORE UPDATE OR DELETE ON "compliance_notice_acknowledgements"
FOR EACH ROW EXECUTE FUNCTION h6_reject_append_only_mutation();

-- AddForeignKey
ALTER TABLE "compliance_official_definitions" ADD CONSTRAINT "compliance_official_definitions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_official_definition_revisions" ADD CONSTRAINT "compliance_official_definition_revisions_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "compliance_official_definitions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_official_definition_revisions" ADD CONSTRAINT "compliance_official_definition_revisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_official_definition_revisions" ADD CONSTRAINT "compliance_official_definition_revisions_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_official_definition_activations" ADD CONSTRAINT "h6_official_activation_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_official_definition_activations" ADD CONSTRAINT "h6_official_activation_definition_fkey" FOREIGN KEY ("definition_id") REFERENCES "compliance_official_definitions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_official_definition_activations" ADD CONSTRAINT "h6_official_activation_revision_fkey" FOREIGN KEY ("revision_id", "definition_id") REFERENCES "compliance_official_definition_revisions"("id", "definition_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_official_definition_activations" ADD CONSTRAINT "h6_official_activation_actor_fkey" FOREIGN KEY ("organization_id", "activated_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_obligation_triggers" ADD CONSTRAINT "h6_obligation_trigger_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_obligation_triggers" ADD CONSTRAINT "h6_obligation_trigger_obligation_fkey" FOREIGN KEY ("obligation_id", "organization_id") REFERENCES "compliance_obligations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "compliance_obligation_triggers" ADD CONSTRAINT "h6_obligation_trigger_review_fkey" FOREIGN KEY ("review_id", "organization_id") REFERENCES "compliance_reviews"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "compliance_obligation_triggers" ADD CONSTRAINT "h6_obligation_trigger_result_fkey" FOREIGN KEY ("rule_result_id", "organization_id", "review_id", "rule_revision_id") REFERENCES "compliance_rule_results"("id", "organization_id", "review_id", "rule_revision_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "compliance_obligation_triggers" ADD CONSTRAINT "h6_obligation_trigger_revision_fkey" FOREIGN KEY ("rule_revision_id", "organization_id") REFERENCES "compliance_legal_rule_revisions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "compliance_obligation_triggers" ADD CONSTRAINT "h6_obligation_trigger_act_fkey" FOREIGN KEY ("expediente_acto_id", "organization_id") REFERENCES "expediente_actos"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_fiche_revisions" ADD CONSTRAINT "h6_notice_fiche_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_fiche_revisions" ADD CONSTRAINT "h6_notice_fiche_obligation_fkey" FOREIGN KEY ("obligation_id", "organization_id") REFERENCES "compliance_obligations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_fiche_revisions" ADD CONSTRAINT "h6_notice_fiche_official_revision_fkey" FOREIGN KEY ("official_revision_id") REFERENCES "compliance_official_definition_revisions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_fiche_revisions" ADD CONSTRAINT "h6_notice_fiche_actor_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_official_products" ADD CONSTRAINT "h6_official_product_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_official_products" ADD CONSTRAINT "h6_official_product_obligation_fkey" FOREIGN KEY ("obligation_id", "organization_id") REFERENCES "compliance_obligations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_official_products" ADD CONSTRAINT "compliance_official_products_fiche_revision_id_organizatio_fkey" FOREIGN KEY ("fiche_revision_id", "organization_id") REFERENCES "compliance_notice_fiche_revisions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_official_products" ADD CONSTRAINT "compliance_official_products_official_revision_id_fkey" FOREIGN KEY ("official_revision_id") REFERENCES "compliance_official_definition_revisions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_official_products" ADD CONSTRAINT "compliance_official_products_documento_id_organization_id_fkey" FOREIGN KEY ("documento_id", "organization_id") REFERENCES "documentos"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_official_products" ADD CONSTRAINT "h6_official_product_actor_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_presentations" ADD CONSTRAINT "h6_notice_presentation_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_presentations" ADD CONSTRAINT "h6_notice_presentation_obligation_fkey" FOREIGN KEY ("obligation_id", "organization_id") REFERENCES "compliance_obligations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_presentations" ADD CONSTRAINT "compliance_notice_presentations_fiche_revision_id_organiza_fkey" FOREIGN KEY ("fiche_revision_id", "organization_id") REFERENCES "compliance_notice_fiche_revisions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_presentations" ADD CONSTRAINT "compliance_notice_presentations_product_id_organization_id_fkey" FOREIGN KEY ("product_id", "organization_id") REFERENCES "compliance_official_products"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_presentations" ADD CONSTRAINT "h6_notice_presentation_previous_fkey" FOREIGN KEY ("previous_presentation_id", "organization_id") REFERENCES "compliance_notice_presentations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_presentations" ADD CONSTRAINT "h6_notice_presentation_actor_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_acknowledgements" ADD CONSTRAINT "h6_notice_ack_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_acknowledgements" ADD CONSTRAINT "compliance_notice_acknowledgements_presentation_id_organiz_fkey" FOREIGN KEY ("presentation_id", "organization_id") REFERENCES "compliance_notice_presentations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_acknowledgements" ADD CONSTRAINT "compliance_notice_acknowledgements_documento_id_organizati_fkey" FOREIGN KEY ("documento_id", "organization_id") REFERENCES "documentos"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_acknowledgements" ADD CONSTRAINT "h6_notice_ack_evidence_fkey" FOREIGN KEY ("evidence_id", "organization_id") REFERENCES "compliance_evidence"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_notice_acknowledgements" ADD CONSTRAINT "h6_notice_ack_actor_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_requirements" ADD CONSTRAINT "h6_compliance_requirement_obligation_fkey" FOREIGN KEY ("obligation_id", "organization_id") REFERENCES "compliance_obligations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Keep incremental H5→H6 and canonical empty bootstrap physically identical.
CREATE INDEX "idx_fk_compliance_notice_acknowledgements_062c808a" ON "compliance_notice_acknowledgements"("organization_id", "created_by_id");
CREATE INDEX "idx_fk_compliance_notice_acknowledgements_f97d59dc" ON "compliance_notice_acknowledgements"("documento_id", "organization_id");
CREATE INDEX "idx_fk_compliance_notice_fiche_revisions_a9011062" ON "compliance_notice_fiche_revisions"("organization_id", "created_by_id");
CREATE INDEX "idx_fk_compliance_notice_fiche_revisions_d79d9b96" ON "compliance_notice_fiche_revisions"("official_revision_id");
CREATE INDEX "idx_fk_compliance_notice_presentations_4e43e095" ON "compliance_notice_presentations"("organization_id", "created_by_id");
CREATE INDEX "idx_fk_compliance_notice_presentations_50f336dd" ON "compliance_notice_presentations"("fiche_revision_id", "organization_id");
CREATE INDEX "idx_fk_compliance_notice_presentations_893bcc30" ON "compliance_notice_presentations"("product_id", "organization_id");
CREATE INDEX "idx_fk_compliance_official_definition_activations_09758444" ON "compliance_official_definition_activations"("organization_id", "activated_by_id");
CREATE INDEX "idx_fk_compliance_official_definition_revisions_9e19f5b3" ON "compliance_official_definition_revisions"("verified_by_id");
CREATE INDEX "idx_fk_compliance_official_definition_revisions_f13e6818" ON "compliance_official_definition_revisions"("created_by_id");
CREATE INDEX "idx_fk_compliance_official_definitions_92e1c37b" ON "compliance_official_definitions"("created_by_id");
CREATE INDEX "idx_fk_compliance_official_products_20d9475e" ON "compliance_official_products"("fiche_revision_id", "organization_id");
CREATE INDEX "idx_fk_compliance_official_products_528ed2e3" ON "compliance_official_products"("organization_id", "created_by_id");
CREATE INDEX "idx_fk_compliance_official_products_79deb10a" ON "compliance_official_products"("documento_id", "organization_id");
CREATE INDEX "idx_fk_compliance_official_products_98e0c4cc" ON "compliance_official_products"("official_revision_id");
CREATE INDEX "idx_fk_h6_notice_ack_presentation" ON "compliance_notice_acknowledgements"("presentation_id", "organization_id");
CREATE INDEX "idx_fk_h6_notice_fiche_obligation" ON "compliance_notice_fiche_revisions"("obligation_id", "organization_id");
CREATE INDEX "idx_fk_h6_notice_presentation_obligation" ON "compliance_notice_presentations"("obligation_id", "organization_id");
CREATE INDEX "idx_fk_h6_obligation_trigger_obligation" ON "compliance_obligation_triggers"("obligation_id", "organization_id");
CREATE INDEX "idx_fk_h6_obligation_trigger_review" ON "compliance_obligation_triggers"("review_id", "organization_id");
CREATE INDEX "idx_fk_h6_obligation_trigger_result" ON "compliance_obligation_triggers"("rule_result_id", "organization_id", "review_id", "rule_revision_id");
CREATE INDEX "idx_fk_h6_obligation_trigger_revision" ON "compliance_obligation_triggers"("rule_revision_id", "organization_id");
CREATE INDEX "idx_fk_h6_obligation_trigger_act" ON "compliance_obligation_triggers"("expediente_acto_id", "organization_id");
CREATE INDEX "idx_fk_h6_official_activation_definition" ON "compliance_official_definition_activations"("definition_id");
CREATE INDEX "idx_fk_h6_official_activation_revision" ON "compliance_official_definition_activations"("revision_id", "definition_id");
CREATE INDEX "idx_fk_h6_official_product_obligation" ON "compliance_official_products"("obligation_id", "organization_id");
CREATE INDEX "idx_fk_h6_requirement_obligation" ON "compliance_requirements"("obligation_id", "organization_id");

COMMIT;
