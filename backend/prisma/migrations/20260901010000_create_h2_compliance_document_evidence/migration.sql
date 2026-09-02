-- H2 · CUM-DOC-001
-- Additive evolution of canonical ComplianceEvidence. Reuses Documento bytes/storage.
BEGIN;
SET LOCAL search_path TO pravia_os, public;

CREATE TYPE "ComplianceDocumentCategory" AS ENUM (
  'IDENTIFICACION','PERSONAS_MORALES','FORMATOS','CUESTIONARIOS_RIESGO',
  'BENEFICIARIO_CONTROLADOR','PAGOS_EVIDENCIAS','AVISOS_ACUSES','REVISIONES'
);
CREATE TYPE "ComplianceEvidenceSource" AS ENUM (
  'COMPARECIENTE','EXPEDIENTE','FORMAT_GENERATED','MANUAL_SIGNED_UPLOAD','FUTURE_MODULE'
);
CREATE TYPE "ComplianceEvidenceDocumentState" AS ENUM ('CANONICAL','GENERATED','SIGNED_UPLOADED');
CREATE TYPE "ComplianceEvidenceValidationStatus" AS ENUM ('AUTO_LINKED','PENDING_HUMAN','VALIDATED','REJECTED');
CREATE TYPE "ComplianceMissingActionType" AS ENUM (
  'GO_TO_COMPARECIENTE','GO_TO_QUESTIONNAIRE','GO_TO_BENEFICIAL_OWNER','UPLOAD_SIGNED',
  'UPLOAD_DOCUMENT','GO_TO_PAYMENT_EVIDENCE','GO_TO_NOTICE'
);

ALTER TABLE "compliance_requirements"
  ADD COLUMN "document_category" "ComplianceDocumentCategory",
  ADD COLUMN "expected_document_type" TEXT,
  ADD COLUMN "target_compareciente_id" UUID,
  ADD COLUMN "requires_signed_document" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requires_human_validation" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "missing_action" "ComplianceMissingActionType",
  ADD COLUMN "action_target" JSONB,
  ADD COLUMN "is_documental" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "compliance_evidence"
  DROP CONSTRAINT IF EXISTS "compliance_evidence_review_id_documento_id_tipo_evidencia_key";
DROP INDEX IF EXISTS "compliance_evidence_review_id_documento_id_tipo_evidencia_key";

ALTER TABLE "compliance_evidence"
  ADD COLUMN "expediente_id" UUID,
  ADD COLUMN "requirement_id" UUID,
  ADD COLUMN "target_compareciente_id" UUID,
  ADD COLUMN "document_version" VARCHAR(128),
  ADD COLUMN "document_checksum_snapshot" VARCHAR(64),
  ADD COLUMN "storage_key_snapshot" TEXT,
  ADD COLUMN "source" "ComplianceEvidenceSource",
  ADD COLUMN "document_state" "ComplianceEvidenceDocumentState",
  ADD COLUMN "validation_status" "ComplianceEvidenceValidationStatus",
  ADD COLUMN "linked_by_system" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "validated_by_id" UUID,
  ADD COLUMN "validated_at" TIMESTAMP(3),
  ADD COLUMN "validation_notes" TEXT;

ALTER TABLE "compliance_evidence"
  ADD CONSTRAINT "compliance_evidence_requirement_id_fkey"
  FOREIGN KEY ("requirement_id") REFERENCES "compliance_requirements"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Composite parent identities make tenant and lineage contradictions unrepresentable.
CREATE UNIQUE INDEX "h2_documentos_id_tenant_key" ON "documentos"("id","organization_id");
CREATE UNIQUE INDEX "h2_expedientes_id_tenant_key" ON "expedientes"("id","organization_id");
CREATE UNIQUE INDEX "h2_comparecientes_id_tenant_key" ON "comparecientes"("id","organization_id");
CREATE UNIQUE INDEX "h2_compliance_reviews_lineage_key" ON "compliance_reviews"("id","organization_id","expediente_id");
CREATE UNIQUE INDEX "h2_compliance_requirements_lineage_key"
  ON "compliance_requirements"("id","organization_id","review_id","expediente_id");

ALTER TABLE "compliance_requirements"
  ADD CONSTRAINT "ck_h2_document_requirement_shape" CHECK (
    NOT "is_documental" OR (
      "provider" = 'DOC' AND "document_category" IS NOT NULL AND
      "missing_action" IS NOT NULL AND length(btrim("label")) > 0
    )
  );

ALTER TABLE "compliance_evidence"
  ADD CONSTRAINT "ck_h2_evidence_new_lineage" CHECK (
    "requirement_id" IS NULL OR (
      "organization_id" IS NOT NULL AND "expediente_id" IS NOT NULL AND
      "document_version" IS NOT NULL AND length(btrim("document_version")) > 0 AND
      "storage_key_snapshot" IS NOT NULL AND length(btrim("storage_key_snapshot")) > 0 AND
      "source" IS NOT NULL AND "document_state" IS NOT NULL AND "validation_status" IS NOT NULL
    )
  );
ALTER TABLE "compliance_evidence"
  ADD CONSTRAINT "ck_h2_evidence_validation_actor" CHECK (
    ("validation_status" = 'VALIDATED' AND "validated_by_id" IS NOT NULL AND "validated_at" IS NOT NULL)
    OR "validation_status" IS DISTINCT FROM 'VALIDATED'
  );
ALTER TABLE "compliance_evidence"
  ADD CONSTRAINT "ck_h2_evidence_signed_source" CHECK (
    "document_state" IS DISTINCT FROM 'SIGNED_UPLOADED' OR "source" = 'MANUAL_SIGNED_UPLOAD'
  );

CREATE UNIQUE INDEX "uq_compliance_evidence_legacy_reference"
  ON "compliance_evidence"("review_id","documento_id","tipo_evidencia")
  WHERE "requirement_id" IS NULL;
CREATE UNIQUE INDEX "uq_h2_compliance_evidence_active_version"
  ON "compliance_evidence"("organization_id","requirement_id","documento_id","document_version")
  WHERE "requirement_id" IS NOT NULL AND "estatus" = 'ACTIVO';
CREATE INDEX "idx_h2_compliance_evidence_requirement"
  ON "compliance_evidence"("organization_id","expediente_id","requirement_id","estatus");
CREATE INDEX "idx_h2_compliance_evidence_target"
  ON "compliance_evidence"("organization_id","target_compareciente_id","estatus");
CREATE INDEX "idx_h2_compliance_requirements_documental"
  ON "compliance_requirements"("organization_id","expediente_id","is_documental","status");

CREATE FUNCTION h2_validate_compliance_requirement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.is_documental THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM compliance_reviews r
    WHERE r.id = NEW.review_id AND r.organization_id = NEW.organization_id
      AND r.expediente_id = NEW.expediente_id
  ) OR NOT EXISTS (
    SELECT 1 FROM expediente_compliance_states s
    WHERE s.id = NEW.state_id AND s.organization_id = NEW.organization_id
      AND s.expediente_id = NEW.expediente_id
  ) THEN RAISE EXCEPTION 'H2_REQUIREMENT_CASE_LINEAGE_MISMATCH' USING ERRCODE = '23514'; END IF;
  IF NEW.rule_result_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM compliance_rule_results rr
    WHERE rr.id = NEW.rule_result_id AND rr.organization_id = NEW.organization_id
      AND rr.review_id = NEW.review_id
  ) THEN RAISE EXCEPTION 'H2_REQUIREMENT_RESULT_LINEAGE_MISMATCH' USING ERRCODE = '23514'; END IF;
  IF NEW.target_compareciente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM comparecientes c
    WHERE c.id = NEW.target_compareciente_id AND c.organization_id = NEW.organization_id
  ) THEN RAISE EXCEPTION 'H2_REQUIREMENT_TARGET_TENANT_MISMATCH' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER h2_validate_compliance_requirement_trigger
  BEFORE INSERT OR UPDATE ON "compliance_requirements"
  FOR EACH ROW EXECUTE FUNCTION h2_validate_compliance_requirement();

CREATE FUNCTION h2_validate_compliance_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  requirement_row compliance_requirements%ROWTYPE;
BEGIN
  IF NEW.requirement_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM organization_memberships m
    WHERE m.organization_id = NEW.organization_id AND m.user_id = NEW.agregado_por_id AND m.status = 'ACTIVE'
  ) OR (NEW.validated_by_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM organization_memberships m
    WHERE m.organization_id = NEW.organization_id AND m.user_id = NEW.validated_by_id AND m.status = 'ACTIVE'
  )) THEN RAISE EXCEPTION 'H2_EVIDENCE_ACTOR_TENANT_MISMATCH' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM expedientes e WHERE e.id = NEW.expediente_id AND e.organization_id = NEW.organization_id
  ) THEN RAISE EXCEPTION 'H2_EVIDENCE_CASE_TENANT_MISMATCH' USING ERRCODE = '23514'; END IF;
  SELECT * INTO STRICT requirement_row FROM compliance_requirements
    WHERE id = NEW.requirement_id AND organization_id = NEW.organization_id
      AND review_id = NEW.review_id AND expediente_id = NEW.expediente_id;
  IF NOT EXISTS (
    SELECT 1 FROM documentos d
    WHERE d.id = NEW.documento_id AND d.organization_id = NEW.organization_id
      AND d.storage_key = NEW.storage_key_snapshot
      AND (NEW.document_checksum_snapshot IS NULL OR d.checksum_sha256 = NEW.document_checksum_snapshot)
      AND (d.checksum_sha256 IS NULL OR d.checksum_sha256 = NEW.document_version)
  ) THEN RAISE EXCEPTION 'H2_EVIDENCE_DOCUMENT_VERSION_MISMATCH' USING ERRCODE = '23514'; END IF;
  IF NEW.target_compareciente_id IS DISTINCT FROM requirement_row.target_compareciente_id THEN
    RAISE EXCEPTION 'H2_EVIDENCE_TARGET_LINEAGE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NEW.validation_status = 'VALIDATED' AND requirement_row.requires_signed_document
     AND NEW.document_state <> 'SIGNED_UPLOADED' THEN
    RAISE EXCEPTION 'H2_SIGNED_REQUIREMENT_NEEDS_SIGNED_UPLOAD' USING ERRCODE = '23514';
  END IF;
  IF NEW.target_compareciente_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM expediente_comparecientes ec
      WHERE ec.organization_id = NEW.organization_id AND ec.expediente_id = NEW.expediente_id
        AND ec.compareciente_id = NEW.target_compareciente_id
        AND ec.archived_at IS NULL AND ec.estatus = 'ACTIVO'
    ) THEN RAISE EXCEPTION 'H2_TARGET_NOT_LINKED_TO_CASE' USING ERRCODE = '23514'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM documentos d
      WHERE d.id = NEW.documento_id AND d.organization_id = NEW.organization_id
        AND (d.compareciente_id = NEW.target_compareciente_id OR EXISTS (
          SELECT 1 FROM compareciente_documentos cd
          WHERE cd.documento_id = d.id AND cd.compareciente_id = NEW.target_compareciente_id
            AND cd.organization_id = NEW.organization_id AND cd.archived_at IS NULL AND cd.estatus = 'ACTIVO'
        ))
    ) THEN RAISE EXCEPTION 'H2_DOCUMENT_TARGET_ACCESS_DENIED' USING ERRCODE = '23514'; END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM documentos d
      WHERE d.id = NEW.documento_id AND d.organization_id = NEW.organization_id
        AND (d.expediente_id = NEW.expediente_id OR EXISTS (
          SELECT 1 FROM expediente_documentos ed
          WHERE ed.documento_id = d.id AND ed.expediente_id = NEW.expediente_id
            AND ed.organization_id = NEW.organization_id AND ed.estatus = 'ACTIVO'
        ))
    ) THEN RAISE EXCEPTION 'H2_DOCUMENT_CASE_ACCESS_DENIED' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER h2_validate_compliance_evidence_trigger
  BEFORE INSERT OR UPDATE ON "compliance_evidence"
  FOR EACH ROW EXECUTE FUNCTION h2_validate_compliance_evidence();

CREATE FUNCTION h2_compliance_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.requirement_id IS NOT NULL AND (
    OLD.organization_id IS DISTINCT FROM NEW.organization_id OR
    OLD.expediente_id IS DISTINCT FROM NEW.expediente_id OR
    OLD.review_id IS DISTINCT FROM NEW.review_id OR
    OLD.requirement_id IS DISTINCT FROM NEW.requirement_id OR
    OLD.documento_id IS DISTINCT FROM NEW.documento_id OR
    OLD.target_compareciente_id IS DISTINCT FROM NEW.target_compareciente_id OR
    OLD.document_version IS DISTINCT FROM NEW.document_version OR
    OLD.document_checksum_snapshot IS DISTINCT FROM NEW.document_checksum_snapshot OR
    OLD.storage_key_snapshot IS DISTINCT FROM NEW.storage_key_snapshot OR
    OLD.source IS DISTINCT FROM NEW.source OR
    OLD.document_state IS DISTINCT FROM NEW.document_state OR
    OLD.linked_by_system IS DISTINCT FROM NEW.linked_by_system OR
    OLD.agregado_por_id IS DISTINCT FROM NEW.agregado_por_id
  ) THEN RAISE EXCEPTION 'H2_EVIDENCE_LINEAGE_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER h2_compliance_evidence_immutable_trigger
  BEFORE UPDATE ON "compliance_evidence"
  FOR EACH ROW EXECUTE FUNCTION h2_compliance_evidence_immutable();

COMMIT;
