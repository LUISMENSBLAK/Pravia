-- H1 · CUM-MAT + CUM-EST-001
-- Additive, tenant-aware legal detection foundation. No legal rules are seeded.
BEGIN;
SET LOCAL search_path TO pravia_os, public;

CREATE TYPE "ComplianceRuleFamily" AS ENUM ('CUM_MAT_001','CUM_MAT_002','CUM_MAT_003','CUM_MAT_004','CUM_MAT_005','CUM_MAT_006','CUM_MAT_007');
CREATE TYPE "ComplianceRuleRevisionStatus" AS ENUM ('DRAFT','VERIFIED','ACTIVE','RETIRED','LEGACY_UNVERIFIED');
CREATE TYPE "ComplianceApplicabilityState" AS ENUM ('NO_APLICA','APLICA_SIN_AVISO','APLICA_CON_AVISO','INFORMACION_INCOMPLETA');
CREATE TYPE "ComplianceGeneralState" AS ENUM ('NO_APLICA','PENDIENTE','EN_PROCESO','LISTO','CUMPLIMIENTO_COMPLETO','VENCIDO');
CREATE TYPE "ComplianceRequirementProvider" AS ENUM ('LEGAL','DOC','LST','BC','CUE','PAG','FIR','AVI');
CREATE TYPE "ComplianceRequirementStatus" AS ENUM ('PENDIENTE','EN_PROCESO','LISTO','CUMPLIDO','NO_APLICA','VENCIDO','BLOQUEADO_POR_FALTA_DATOS');
CREATE TYPE "ComplianceAlertLevel" AS ENUM ('INFORMATIVA','ADVERTENCIA','CRITICA');
CREATE TYPE "ComplianceAlertStatus" AS ENUM ('ABIERTA','RESUELTA','DESCARTADA');

ALTER TABLE "compliance_reviews" ALTER COLUMN "rule_set_id" DROP NOT NULL;
ALTER TABLE "compliance_reviews"
  ADD COLUMN "engine_version" TEXT,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "legal_date_source" TEXT,
  ADD COLUMN "input_snapshot" JSONB,
  ADD COLUMN "rule_collection_checksum" TEXT,
  ADD COLUMN "canonical_state_snapshot" JSONB,
  ADD COLUMN "is_canonical_legal_engine" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "compliance_reviews_tenant_case_idempotency_key"
  ON "compliance_reviews"("organization_id","expediente_id","idempotency_key");

CREATE TABLE "compliance_legal_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "stable_key" TEXT NOT NULL,
  "family" "ComplianceRuleFamily" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_legal_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_compliance_legal_rule_key" CHECK (length(btrim("stable_key")) > 0),
  CONSTRAINT "compliance_legal_rules_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_legal_rules_actor_fkey" FOREIGN KEY ("organization_id","created_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_legal_rules_tenant_stable_key" UNIQUE ("organization_id","stable_key"),
  CONSTRAINT "compliance_legal_rules_id_tenant_key" UNIQUE ("id","organization_id")
);
CREATE INDEX "idx_compliance_legal_rules_tenant_family" ON "compliance_legal_rules"("organization_id","family");

CREATE TABLE "compliance_legal_rule_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "rule_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ComplianceRuleRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_to" TIMESTAMP(3),
  "conditions" JSONB NOT NULL,
  "outcome" JSONB NOT NULL,
  "legal_basis" TEXT NOT NULL,
  "source_name" TEXT,
  "source_url" TEXT,
  "source_published_at" TIMESTAMP(3),
  "source_checksum" TEXT,
  "verified_by_id" UUID,
  "verified_at" TIMESTAMP(3),
  "activated_by_id" UUID,
  "activated_at" TIMESTAMP(3),
  "supersedes_revision_id" UUID,
  "checksum" TEXT NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_legal_rule_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_compliance_rule_revision_version" CHECK ("version" > 0),
  CONSTRAINT "ck_compliance_rule_revision_dates" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "ck_compliance_rule_revision_checksum" CHECK (length(btrim("checksum")) > 0),
  CONSTRAINT "ck_compliance_rule_verified_provenance" CHECK (
    "status" IN ('DRAFT','LEGACY_UNVERIFIED') OR
    ("verified_by_id" IS NOT NULL AND "verified_at" IS NOT NULL AND "source_name" IS NOT NULL
      AND "source_url" IS NOT NULL AND "source_published_at" IS NOT NULL AND "source_checksum" IS NOT NULL)
  ),
  CONSTRAINT "ck_compliance_rule_active_activation" CHECK (
    "status" <> 'ACTIVE' OR ("activated_by_id" IS NOT NULL AND "activated_at" IS NOT NULL)
  ),
  CONSTRAINT "compliance_rule_revision_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_rule_revision_rule_fkey" FOREIGN KEY ("rule_id","organization_id") REFERENCES "compliance_legal_rules"("id","organization_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_rule_revision_actor_fkey" FOREIGN KEY ("organization_id","created_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_rule_revision_verifier_fkey" FOREIGN KEY ("organization_id","verified_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_rule_revision_activator_fkey" FOREIGN KEY ("organization_id","activated_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_rule_revision_supersedes_fkey" FOREIGN KEY ("supersedes_revision_id","organization_id") REFERENCES "compliance_legal_rule_revisions"("id","organization_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_rule_revisions_tenant_rule_version" UNIQUE ("organization_id","rule_id","version"),
  CONSTRAINT "compliance_rule_revisions_id_tenant_key" UNIQUE ("id","organization_id")
);
CREATE INDEX "idx_compliance_rule_revisions_effective" ON "compliance_legal_rule_revisions"("organization_id","status","effective_from","effective_to");
CREATE INDEX "idx_compliance_rule_revisions_rule_status" ON "compliance_legal_rule_revisions"("organization_id","rule_id","status");
CREATE UNIQUE INDEX "uq_compliance_rule_one_active_revision" ON "compliance_legal_rule_revisions"("organization_id","rule_id") WHERE "status" = 'ACTIVE';

CREATE TABLE "expediente_compliance_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "current_review_id" UUID,
  "state" "ComplianceGeneralState" NOT NULL DEFAULT 'PENDIENTE',
  "pending_count" INTEGER NOT NULL DEFAULT 0,
  "next_deadline" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_compliance_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_exp_compliance_state_counts" CHECK ("pending_count" >= 0 AND "version" > 0),
  CONSTRAINT "exp_compliance_state_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "exp_compliance_state_exp_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT,
  CONSTRAINT "exp_compliance_state_actor_fkey" FOREIGN KEY ("organization_id","updated_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT,
  CONSTRAINT "expediente_compliance_states_id_tenant_key" UNIQUE ("id","organization_id"),
  CONSTRAINT "expediente_compliance_states_tenant_case_key" UNIQUE ("organization_id","expediente_id"),
  CONSTRAINT "expediente_compliance_states_expediente_key" UNIQUE ("expediente_id")
);
CREATE INDEX "idx_exp_compliance_state_alerting" ON "expediente_compliance_states"("organization_id","state","next_deadline");

CREATE TABLE "compliance_rule_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL,
  "review_id" UUID NOT NULL, "rule_revision_id" UUID NOT NULL, "expediente_acto_id" UUID,
  "applicability" "ComplianceApplicabilityState" NOT NULL, "vulnerable_activity" BOOLEAN,
  "notice_required" BOOLEAN, "notice_type" TEXT, "notice_channel" TEXT,
  "missing_paths" JSONB NOT NULL, "result_snapshot" JSONB NOT NULL,
  "legal_basis_snapshot" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_rule_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_rule_result_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_rule_result_review_fkey" FOREIGN KEY ("review_id") REFERENCES "compliance_reviews"("id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_rule_result_revision_fkey" FOREIGN KEY ("rule_revision_id","organization_id") REFERENCES "compliance_legal_rule_revisions"("id","organization_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_rule_results_id_tenant_key" UNIQUE ("id","organization_id"),
  CONSTRAINT "compliance_rule_results_lineage_key" UNIQUE ("id","organization_id","review_id","rule_revision_id")
);
CREATE UNIQUE INDEX "compliance_rule_results_tenant_review_rule_act" ON "compliance_rule_results"("organization_id","review_id","rule_revision_id",COALESCE("expediente_acto_id",'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX "idx_compliance_rule_results_review" ON "compliance_rule_results"("organization_id","review_id","applicability");

CREATE TABLE "compliance_alert_lead_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL, "lead_days" INTEGER NOT NULL, "provenance" JSONB NOT NULL,
  "created_by_id" UUID NOT NULL, "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "superseded_at" TIMESTAMP(3), "idempotency_key" VARCHAR(160) NOT NULL,
  "payload_hash" VARCHAR(64) NOT NULL,
  CONSTRAINT "compliance_alert_lead_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_compliance_alert_lead_revision" CHECK ("revision" > 0 AND "lead_days" >= 0),
  CONSTRAINT "ck_compliance_alert_lead_provenance" CHECK (jsonb_typeof("provenance") = 'object' AND "provenance" <> '{}'::jsonb),
  CONSTRAINT "compliance_alert_lead_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_alert_lead_actor_fkey" FOREIGN KEY ("organization_id","created_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_alert_lead_tenant_revision_key" UNIQUE ("organization_id","revision"),
  CONSTRAINT "compliance_alert_lead_tenant_idempotency_key" UNIQUE ("organization_id","idempotency_key"),
  CONSTRAINT "compliance_alert_lead_id_tenant_key" UNIQUE ("id","organization_id")
);
CREATE INDEX "idx_compliance_alert_lead_current" ON "compliance_alert_lead_revisions"("organization_id","published_at","superseded_at");
CREATE UNIQUE INDEX "uq_compliance_alert_lead_current" ON "compliance_alert_lead_revisions"("organization_id") WHERE "superseded_at" IS NULL;

CREATE TABLE "compliance_requirements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL, "state_id" UUID NOT NULL, "review_id" UUID NOT NULL,
  "rule_result_id" UUID, "provider" "ComplianceRequirementProvider" NOT NULL,
  "requirement_key" TEXT NOT NULL, "label" TEXT NOT NULL, "status" "ComplianceRequirementStatus" NOT NULL,
  "deadline" TIMESTAMP(3), "blocks_completion" BOOLEAN NOT NULL DEFAULT true,
  "source_snapshot" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_requirements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_requirement_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_requirement_exp_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_requirement_state_fkey" FOREIGN KEY ("state_id","organization_id") REFERENCES "expediente_compliance_states"("id","organization_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_requirement_review_fkey" FOREIGN KEY ("review_id") REFERENCES "compliance_reviews"("id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_requirement_result_fkey" FOREIGN KEY ("rule_result_id","organization_id") REFERENCES "compliance_rule_results"("id","organization_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_requirements_tenant_review_provider_key" UNIQUE ("organization_id","review_id","provider","requirement_key"),
  CONSTRAINT "compliance_requirements_id_tenant_key" UNIQUE ("id","organization_id")
);
CREATE INDEX "idx_compliance_requirements_case_status" ON "compliance_requirements"("organization_id","expediente_id","status","deadline");

CREATE TABLE "compliance_alerts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL, "state_id" UUID NOT NULL, "review_id" UUID NOT NULL,
  "requirement_id" UUID, "rule_revision_id" UUID, "alert_key" TEXT NOT NULL,
  "level" "ComplianceAlertLevel" NOT NULL, "status" "ComplianceAlertStatus" NOT NULL DEFAULT 'ABIERTA',
  "message" TEXT NOT NULL, "deadline" TIMESTAMP(3), "lead_revision_id" UUID,
  "lead_days_snapshot" INTEGER, "opens_at" TIMESTAMP(3), "responsible_id" UUID,
  "resolved_at" TIMESTAMP(3), "resolved_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_alert_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_alert_exp_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_alert_state_fkey" FOREIGN KEY ("state_id","organization_id") REFERENCES "expediente_compliance_states"("id","organization_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_alert_review_fkey" FOREIGN KEY ("review_id") REFERENCES "compliance_reviews"("id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_alert_requirement_fkey" FOREIGN KEY ("requirement_id","organization_id") REFERENCES "compliance_requirements"("id","organization_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_alert_revision_fkey" FOREIGN KEY ("rule_revision_id","organization_id") REFERENCES "compliance_legal_rule_revisions"("id","organization_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_alert_lead_revision_fkey" FOREIGN KEY ("lead_revision_id","organization_id") REFERENCES "compliance_alert_lead_revisions"("id","organization_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_alert_responsible_fkey" FOREIGN KEY ("organization_id","responsible_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_alert_resolver_fkey" FOREIGN KEY ("organization_id","resolved_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT,
  CONSTRAINT "compliance_alerts_tenant_review_key" UNIQUE ("organization_id","review_id","alert_key"),
  CONSTRAINT "compliance_alerts_id_tenant_key" UNIQUE ("id","organization_id")
);
CREATE INDEX "idx_compliance_alerts_case_status" ON "compliance_alerts"("organization_id","expediente_id","status","level","deadline");

ALTER TABLE "compliance_obligations"
  ADD COLUMN "rule_result_id" UUID,
  ADD COLUMN "rule_revision_id" UUID,
  ADD COLUMN "obligation_key" TEXT,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "legal_deadline_source" TEXT;
ALTER TABLE "compliance_obligations"
  ADD CONSTRAINT "compliance_obligation_lineage_fkey" FOREIGN KEY ("rule_result_id","organization_id","review_id","rule_revision_id") REFERENCES "compliance_rule_results"("id","organization_id","review_id","rule_revision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "compliance_obligation_revision_fkey" FOREIGN KEY ("rule_revision_id","organization_id") REFERENCES "compliance_legal_rule_revisions"("id","organization_id") ON DELETE RESTRICT;
ALTER TABLE "compliance_obligations"
  ADD CONSTRAINT "ck_compliance_obligation_h1_tenant_required" CHECK (
    "organization_id" IS NOT NULL OR ("rule_result_id" IS NULL AND "rule_revision_id" IS NULL)
  );
ALTER TABLE "compliance_obligations"
  ADD CONSTRAINT "ck_compliance_obligation_h1_lineage_required" CHECK (
    "rule_result_id" IS NULL OR ("organization_id" IS NOT NULL AND "rule_revision_id" IS NOT NULL)
  );
CREATE UNIQUE INDEX "compliance_obligations_canonical_key" ON "compliance_obligations"("organization_id","rule_result_id","obligation_key");

ALTER TABLE "expediente_compliance_states"
  ADD CONSTRAINT "exp_compliance_state_current_review_fkey" FOREIGN KEY ("current_review_id") REFERENCES "compliance_reviews"("id") ON DELETE RESTRICT;

-- Tenant consistency is enforced even for direct SQL and nested writes.
CREATE TRIGGER h1_revision_rule_tenant BEFORE INSERT OR UPDATE ON "compliance_legal_rule_revisions" FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('compliance_legal_rules','rule_id');
CREATE TRIGGER h1_state_case_tenant BEFORE INSERT OR UPDATE ON "expediente_compliance_states" FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('expedientes','expediente_id');
CREATE TRIGGER h1_state_review_tenant BEFORE INSERT OR UPDATE ON "expediente_compliance_states" FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('compliance_reviews','current_review_id');
CREATE TRIGGER h1_result_review_tenant BEFORE INSERT OR UPDATE ON "compliance_rule_results" FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('compliance_reviews','review_id');
CREATE TRIGGER h1_result_act_tenant BEFORE INSERT OR UPDATE ON "compliance_rule_results" FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('expediente_actos','expediente_acto_id');
CREATE TRIGGER h1_requirement_review_tenant BEFORE INSERT OR UPDATE ON "compliance_requirements" FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('compliance_reviews','review_id');
CREATE TRIGGER h1_requirement_case_tenant BEFORE INSERT OR UPDATE ON "compliance_requirements" FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('expedientes','expediente_id');
CREATE TRIGGER h1_alert_review_tenant BEFORE INSERT OR UPDATE ON "compliance_alerts" FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('compliance_reviews','review_id');
CREATE TRIGGER h1_alert_case_tenant BEFORE INSERT OR UPDATE ON "compliance_alerts" FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('expedientes','expediente_id');

CREATE FUNCTION h1_rule_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (OLD.status IN ('ACTIVE','RETIRED') OR EXISTS (SELECT 1 FROM compliance_rule_results WHERE rule_revision_id = OLD.id)) THEN
    RAISE EXCEPTION 'H1_RULE_REVISION_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED'
    AND OLD.id IS NOT DISTINCT FROM NEW.id AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id
    AND OLD.rule_id IS NOT DISTINCT FROM NEW.rule_id AND OLD.version IS NOT DISTINCT FROM NEW.version
    AND OLD.effective_from IS NOT DISTINCT FROM NEW.effective_from AND OLD.effective_to IS NOT DISTINCT FROM NEW.effective_to
    AND OLD.conditions IS NOT DISTINCT FROM NEW.conditions AND OLD.outcome IS NOT DISTINCT FROM NEW.outcome
    AND OLD.legal_basis IS NOT DISTINCT FROM NEW.legal_basis AND OLD.source_name IS NOT DISTINCT FROM NEW.source_name
    AND OLD.source_url IS NOT DISTINCT FROM NEW.source_url AND OLD.source_published_at IS NOT DISTINCT FROM NEW.source_published_at
    AND OLD.source_checksum IS NOT DISTINCT FROM NEW.source_checksum AND OLD.verified_by_id IS NOT DISTINCT FROM NEW.verified_by_id
    AND OLD.verified_at IS NOT DISTINCT FROM NEW.verified_at AND OLD.activated_by_id IS NOT DISTINCT FROM NEW.activated_by_id
    AND OLD.activated_at IS NOT DISTINCT FROM NEW.activated_at AND OLD.checksum IS NOT DISTINCT FROM NEW.checksum THEN RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.status IN ('ACTIVE','RETIRED') OR EXISTS (SELECT 1 FROM compliance_rule_results WHERE rule_revision_id = OLD.id)) THEN
    RAISE EXCEPTION 'H1_RULE_REVISION_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER h1_rule_revision_immutable_trigger BEFORE UPDATE OR DELETE ON "compliance_legal_rule_revisions" FOR EACH ROW EXECUTE FUNCTION h1_rule_revision_immutable();

CREATE FUNCTION h1_alert_lead_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.superseded_at IS NULL AND NEW.superseded_at IS NOT NULL
    AND OLD.id IS NOT DISTINCT FROM NEW.id AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id
    AND OLD.revision IS NOT DISTINCT FROM NEW.revision AND OLD.lead_days IS NOT DISTINCT FROM NEW.lead_days
    AND OLD.provenance IS NOT DISTINCT FROM NEW.provenance AND OLD.created_by_id IS NOT DISTINCT FROM NEW.created_by_id
    AND OLD.published_at IS NOT DISTINCT FROM NEW.published_at AND OLD.idempotency_key IS NOT DISTINCT FROM NEW.idempotency_key
    AND OLD.payload_hash IS NOT DISTINCT FROM NEW.payload_hash THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION 'H1_ALERT_LEAD_REVISION_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER h1_alert_lead_revision_immutable_trigger BEFORE UPDATE OR DELETE ON "compliance_alert_lead_revisions" FOR EACH ROW EXECUTE FUNCTION h1_alert_lead_revision_immutable();

CREATE FUNCTION h1_rule_no_effective_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM compliance_legal_rule_revisions r WHERE r.organization_id = NEW.organization_id
      AND r.rule_id = NEW.rule_id AND r.id <> NEW.id AND r.status = 'ACTIVE'
      AND daterange(r.effective_from::date, COALESCE(r.effective_to::date, 'infinity'::date), '[]') &&
          daterange(NEW.effective_from::date, COALESCE(NEW.effective_to::date, 'infinity'::date), '[]')
  ) THEN RAISE EXCEPTION 'H1_RULE_EFFECTIVE_RANGE_OVERLAP' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER h1_rule_no_effective_overlap_trigger BEFORE INSERT OR UPDATE ON "compliance_legal_rule_revisions" FOR EACH ROW EXECUTE FUNCTION h1_rule_no_effective_overlap();

COMMIT;
