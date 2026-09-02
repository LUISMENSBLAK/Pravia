-- H3 · CUM-LST-001
-- Versioned nominal screening. No source or provider is activated by this migration.
BEGIN;
SET LOCAL search_path TO pravia_os, public;

CREATE TYPE "ScreeningQueryKind" AS ENUM ('MASTER','FREE');
CREATE TYPE "ScreeningExecutionState" AS ENUM ('NOT_EXECUTED','QUEUED','RUNNING','NOT_CONFIGURED','SUCCEEDED','PARTIAL','ERROR');
CREATE TYPE "ScreeningTriggerReason" AS ENUM ('COMPARECIENTE_CREATED','RELEVANT_IDENTITY_CHANGED','VULNERABLE_OPERATION','MANUAL_RERUN','FREE_SEARCH');
CREATE TYPE "ScreeningSourceStatus" AS ENUM ('DISABLED','ACTIVE');
CREATE TYPE "ScreeningSourceVersionStatus" AS ENUM ('DRAFT','ACTIVE','RETIRED');
CREATE TYPE "ScreeningHumanDecision" AS ENUM ('NO_CORRESPONDE','REVISION_ADICIONAL','COINCIDENCIA_CONFIRMADA');

ALTER TABLE "compliance_screening_results"
  ALTER COLUMN "review_id" DROP NOT NULL,
  ALTER COLUMN "compareciente_id" DROP NOT NULL,
  ADD COLUMN "contract_version" VARCHAR(24),
  ADD COLUMN "query_kind" "ScreeningQueryKind",
  ADD COLUMN "execution_state" "ScreeningExecutionState",
  ADD COLUMN "trigger_reason" "ScreeningTriggerReason",
  ADD COLUMN "trigger_key" VARCHAR(200),
  ADD COLUMN "trigger_event_id" UUID,
  ADD COLUMN "owner_user_id" UUID,
  ADD COLUMN "requested_by_id" UUID,
  ADD COLUMN "identity_fingerprint" VARCHAR(64),
  ADD COLUMN "started_at" TIMESTAMP(3),
  ADD COLUMN "completed_at" TIMESTAMP(3),
  ADD COLUMN "correlation_id" UUID;

CREATE TABLE "screening_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "display_name" VARCHAR(160) NOT NULL,
  "provider_key" VARCHAR(120) NOT NULL,
  "status" "ScreeningSourceStatus" NOT NULL DEFAULT 'DISABLED',
  "configuration_hint" JSONB,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "screening_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "screening_source_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ScreeningSourceVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "dataset_checksum" VARCHAR(64) NOT NULL,
  "adapter_key" VARCHAR(120) NOT NULL,
  "adapter_version" VARCHAR(80) NOT NULL,
  "provenance" JSONB NOT NULL,
  "available_at" TIMESTAMP(3) NOT NULL,
  "effective_from" TIMESTAMP(3),
  "effective_to" TIMESTAMP(3),
  "created_by_id" UUID NOT NULL,
  "activated_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activated_at" TIMESTAMP(3),
  "retired_at" TIMESTAMP(3),
  CONSTRAINT "screening_source_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "screening_source_executions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "query_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "source_version_id" UUID,
  "execution_state" "ScreeningExecutionState" NOT NULL DEFAULT 'QUEUED',
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "result_summary" JSONB,
  "error_code" VARCHAR(120),
  "error_detail" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "screening_source_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "screening_source_execution_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "source_execution_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "execution_state" "ScreeningExecutionState" NOT NULL DEFAULT 'RUNNING',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "error_code" VARCHAR(120),
  "error_detail" TEXT,
  "result_digest" VARCHAR(64),
  "result_metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "screening_source_execution_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "screening_candidates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "query_id" UUID NOT NULL,
  "source_execution_id" UUID NOT NULL,
  "stable_candidate_id" VARCHAR(200) NOT NULL,
  "source_record_ref" VARCHAR(240) NOT NULL,
  "display_name" VARCHAR(300) NOT NULL,
  "score" DECIMAL(7,6),
  "match_fields" JSONB NOT NULL,
  "evidence_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "screening_candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "screening_human_resolutions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "candidate_id" UUID NOT NULL,
  "decision" "ScreeningHumanDecision" NOT NULL,
  "rationale" TEXT NOT NULL,
  "resolved_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "screening_human_resolutions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "screening_operation_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "requirement_id" UUID NOT NULL,
  "query_id" UUID NOT NULL,
  "source_summary" JSONB NOT NULL,
  "resolution_summary" JSONB NOT NULL,
  "unresolved_count" INTEGER NOT NULL,
  "captured_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "screening_operation_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "screening_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "query_id" UUID NOT NULL,
  "documento_id" UUID NOT NULL,
  "generated_by_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(120) NOT NULL,
  "cutoff_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "semantic_fingerprint" VARCHAR(64) NOT NULL,
  "content_checksum" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "screening_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "compliance_screening_results_id_tenant_key" ON "compliance_screening_results"("id","organization_id");
CREATE UNIQUE INDEX "compliance_screening_results_tenant_trigger_key" ON "compliance_screening_results"("organization_id","trigger_key");
CREATE UNIQUE INDEX "compliance_screening_results_party_lineage_key" ON "compliance_screening_results"("id","organization_id","compareciente_id");
CREATE INDEX "idx_screening_query_current" ON "compliance_screening_results"("organization_id","compareciente_id","query_kind","created_at");
CREATE INDEX "idx_screening_free_owner" ON "compliance_screening_results"("organization_id","owner_user_id","query_kind","created_at");

CREATE UNIQUE INDEX "screening_sources_tenant_code_key" ON "screening_sources"("organization_id","code");
CREATE UNIQUE INDEX "screening_sources_id_tenant_key" ON "screening_sources"("id","organization_id");
CREATE INDEX "idx_screening_sources_status" ON "screening_sources"("organization_id","status");
CREATE UNIQUE INDEX "screening_source_versions_tenant_version_key" ON "screening_source_versions"("organization_id","source_id","version");
CREATE UNIQUE INDEX "screening_source_versions_id_tenant_key" ON "screening_source_versions"("id","organization_id");
CREATE UNIQUE INDEX "uq_screening_source_active_version" ON "screening_source_versions"("organization_id","source_id") WHERE "status" = 'ACTIVE';
CREATE INDEX "idx_screening_source_versions_status" ON "screening_source_versions"("organization_id","source_id","status");
CREATE UNIQUE INDEX "screening_source_executions_query_source_key" ON "screening_source_executions"("organization_id","query_id","source_id");
CREATE UNIQUE INDEX "screening_source_executions_id_tenant_key" ON "screening_source_executions"("id","organization_id");
CREATE INDEX "idx_screening_source_executions_state" ON "screening_source_executions"("organization_id","query_id","execution_state");
CREATE INDEX "idx_fk_screening_source_executions_7338f7bd" ON "screening_source_executions"("source_version_id","organization_id");
CREATE UNIQUE INDEX "screening_source_execution_attempts_tenant_number_key" ON "screening_source_execution_attempts"("organization_id","source_execution_id","attempt_number");
CREATE UNIQUE INDEX "screening_source_execution_attempts_id_tenant_key" ON "screening_source_execution_attempts"("id","organization_id");
CREATE INDEX "idx_screening_source_execution_attempts_history" ON "screening_source_execution_attempts"("organization_id","source_execution_id","created_at");
CREATE UNIQUE INDEX "screening_candidates_stable_key" ON "screening_candidates"("organization_id","source_execution_id","stable_candidate_id");
CREATE UNIQUE INDEX "screening_candidates_id_tenant_key" ON "screening_candidates"("id","organization_id");
CREATE INDEX "idx_screening_candidates_query" ON "screening_candidates"("organization_id","query_id","created_at");
CREATE UNIQUE INDEX "screening_human_resolutions_id_tenant_key" ON "screening_human_resolutions"("id","organization_id");
CREATE INDEX "idx_screening_human_resolutions_candidate" ON "screening_human_resolutions"("organization_id","candidate_id","created_at");
CREATE UNIQUE INDEX "screening_operation_snapshots_requirement_query_key" ON "screening_operation_snapshots"("organization_id","requirement_id","query_id");
CREATE UNIQUE INDEX "screening_operation_snapshots_id_tenant_key" ON "screening_operation_snapshots"("id","organization_id");
CREATE INDEX "idx_screening_operation_snapshots_requirement" ON "screening_operation_snapshots"("organization_id","requirement_id","created_at");
CREATE UNIQUE INDEX "screening_reports_query_checksum_key" ON "screening_reports"("organization_id","query_id","content_checksum");
CREATE UNIQUE INDEX "screening_reports_query_semantic_key" ON "screening_reports"("organization_id","query_id","semantic_fingerprint");
CREATE UNIQUE INDEX "screening_reports_query_idempotency_key" ON "screening_reports"("organization_id","query_id","idempotency_key");
CREATE UNIQUE INDEX "screening_reports_id_tenant_key" ON "screening_reports"("id","organization_id");
CREATE INDEX "idx_screening_reports_query" ON "screening_reports"("organization_id","query_id","created_at");
CREATE INDEX "idx_fk_screening_reports_c5c9eac2" ON "screening_reports"("documento_id","organization_id");
ALTER TABLE "storage_compensation_jobs" ADD COLUMN "screening_report_id" UUID;
CREATE INDEX "idx_storage_jobs_screening_report_fk" ON "storage_compensation_jobs"("screening_report_id","organization_id");

ALTER TABLE "screening_source_versions" ADD CONSTRAINT "screening_source_versions_source_fkey" FOREIGN KEY ("source_id","organization_id") REFERENCES "screening_sources"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "screening_source_executions" ADD CONSTRAINT "screening_source_executions_query_fkey" FOREIGN KEY ("query_id","organization_id") REFERENCES "compliance_screening_results"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "screening_source_executions" ADD CONSTRAINT "screening_source_executions_source_fkey" FOREIGN KEY ("source_id","organization_id") REFERENCES "screening_sources"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "screening_source_executions" ADD CONSTRAINT "screening_source_executions_version_fkey" FOREIGN KEY ("source_version_id","organization_id") REFERENCES "screening_source_versions"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "screening_source_execution_attempts" ADD CONSTRAINT "screening_source_execution_attempts_execution_fkey" FOREIGN KEY ("source_execution_id","organization_id") REFERENCES "screening_source_executions"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "screening_candidates" ADD CONSTRAINT "screening_candidates_query_fkey" FOREIGN KEY ("query_id","organization_id") REFERENCES "compliance_screening_results"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "screening_candidates" ADD CONSTRAINT "screening_candidates_execution_fkey" FOREIGN KEY ("source_execution_id","organization_id") REFERENCES "screening_source_executions"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "screening_human_resolutions" ADD CONSTRAINT "screening_human_resolutions_candidate_fkey" FOREIGN KEY ("candidate_id","organization_id") REFERENCES "screening_candidates"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "screening_operation_snapshots" ADD CONSTRAINT "screening_operation_snapshots_query_fkey" FOREIGN KEY ("query_id","organization_id") REFERENCES "compliance_screening_results"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "screening_operation_snapshots" ADD CONSTRAINT "screening_operation_snapshots_requirement_fkey" FOREIGN KEY ("requirement_id","organization_id") REFERENCES "compliance_requirements"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "screening_reports" ADD CONSTRAINT "screening_reports_query_fkey" FOREIGN KEY ("query_id","organization_id") REFERENCES "compliance_screening_results"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "screening_reports" ADD CONSTRAINT "screening_reports_document_fkey" FOREIGN KEY ("documento_id","organization_id") REFERENCES "documentos"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "storage_compensation_jobs" ADD CONSTRAINT "fk_storage_job_screening_report" FOREIGN KEY ("screening_report_id","organization_id") REFERENCES "screening_reports"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "compliance_screening_results" ADD CONSTRAINT "ck_h3_query_context" CHECK (
  "contract_version" IS NULL OR (
    "contract_version" = 'CUM-LST-001' AND "organization_id" IS NOT NULL AND "query_kind" IS NOT NULL
    AND "execution_state" IS NOT NULL AND "trigger_reason" IS NOT NULL AND "trigger_key" IS NOT NULL
    AND "query_snapshot" IS NOT NULL AND "identity_fingerprint" IS NOT NULL
    AND "status" = "execution_state"::text
    AND (("query_kind" = 'MASTER' AND "compareciente_id" IS NOT NULL AND "owner_user_id" IS NULL
          AND "trigger_reason" IN ('COMPARECIENTE_CREATED','RELEVANT_IDENTITY_CHANGED','VULNERABLE_OPERATION','MANUAL_RERUN'))
      OR ("query_kind" = 'FREE' AND "compareciente_id" IS NULL AND "review_id" IS NULL AND "owner_user_id" IS NOT NULL
          AND "trigger_reason" = 'FREE_SEARCH'))
  )
);
ALTER TABLE "compliance_screening_results" ADD CONSTRAINT "ck_h3_query_terminal_time" CHECK (
  "contract_version" IS NULL OR (
    ("execution_state" IN ('NOT_CONFIGURED','SUCCEEDED','PARTIAL','ERROR') AND "completed_at" IS NOT NULL)
    OR ("execution_state" IN ('NOT_EXECUTED','QUEUED','RUNNING') AND "completed_at" IS NULL)
  )
);
ALTER TABLE "screening_source_versions" ADD CONSTRAINT "ck_h3_source_version_shape" CHECK (
  length(btrim("dataset_checksum")) = 64 AND length(btrim("adapter_key")) > 0
  AND length(btrim("adapter_version")) > 0 AND
  (("status" = 'ACTIVE' AND "activated_by_id" IS NOT NULL AND "activated_at" IS NOT NULL AND "retired_at" IS NULL)
    OR ("status" = 'RETIRED' AND "retired_at" IS NOT NULL)
    OR "status" = 'DRAFT')
);
ALTER TABLE "screening_source_executions" ADD CONSTRAINT "ck_h3_source_execution_shape" CHECK (
  ("execution_state" IN ('NOT_CONFIGURED','SUCCEEDED','PARTIAL','ERROR') AND "completed_at" IS NOT NULL)
  OR ("execution_state" IN ('NOT_EXECUTED','QUEUED','RUNNING') AND "completed_at" IS NULL)
);
ALTER TABLE "screening_source_executions" ADD CONSTRAINT "ck_h3_source_execution_error" CHECK (
  ("execution_state" = 'ERROR' AND "error_code" IS NOT NULL)
  OR ("execution_state" <> 'ERROR' AND "error_code" IS NULL)
);
ALTER TABLE "screening_source_execution_attempts" ADD CONSTRAINT "ck_h3_source_execution_attempt_shape" CHECK (
  "attempt_number" > 0
  AND "execution_state" IN ('RUNNING','SUCCEEDED','PARTIAL','ERROR')
  AND (("execution_state" = 'RUNNING' AND "completed_at" IS NULL)
    OR ("execution_state" IN ('SUCCEEDED','PARTIAL','ERROR') AND "completed_at" IS NOT NULL))
  AND (("execution_state" = 'ERROR' AND "error_code" IS NOT NULL)
    OR ("execution_state" <> 'ERROR' AND "error_code" IS NULL))
  AND ("result_digest" IS NULL OR length(btrim("result_digest")) = 64)
);
ALTER TABLE "screening_candidates" ADD CONSTRAINT "ck_h3_candidate_shape" CHECK (
  length(btrim("stable_candidate_id")) > 0 AND length(btrim("source_record_ref")) > 0
  AND length(btrim("display_name")) > 0 AND ("score" IS NULL OR ("score" >= 0 AND "score" <= 1))
);
ALTER TABLE "screening_human_resolutions" ADD CONSTRAINT "ck_h3_resolution_shape" CHECK (length(btrim("rationale")) > 0);
ALTER TABLE "screening_operation_snapshots" ADD CONSTRAINT "ck_h3_snapshot_count" CHECK ("unresolved_count" >= 0);
ALTER TABLE "storage_compensation_jobs" ADD CONSTRAINT "ck_storage_job_screening_report_tenant" CHECK ("screening_report_id" IS NULL OR "organization_id" IS NOT NULL);

CREATE FUNCTION h3_actor_is_member(org UUID, actor UUID) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT actor IS NULL OR EXISTS (
    SELECT 1 FROM organization_memberships m
    WHERE m.organization_id = org AND m.user_id = actor AND m.status = 'ACTIVE'
  )
$$;

CREATE FUNCTION h3_validate_query() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contract_version IS NULL THEN RETURN NEW; END IF;
  IF NEW.compareciente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM comparecientes c WHERE c.id = NEW.compareciente_id AND c.organization_id = NEW.organization_id
  ) THEN RAISE EXCEPTION 'H3_QUERY_COMPARECIENTE_TENANT_MISMATCH' USING ERRCODE = '23514'; END IF;
  IF NOT h3_actor_is_member(NEW.organization_id, NEW.owner_user_id)
     OR NOT h3_actor_is_member(NEW.organization_id, NEW.requested_by_id) THEN
    RAISE EXCEPTION 'H3_QUERY_ACTOR_TENANT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER h3_validate_query_trigger BEFORE INSERT OR UPDATE ON "compliance_screening_results" FOR EACH ROW EXECUTE FUNCTION h3_validate_query();

CREATE FUNCTION h3_validate_source_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT h3_actor_is_member(NEW.organization_id, NEW.created_by_id)
     OR NOT h3_actor_is_member(NEW.organization_id, NEW.activated_by_id) THEN
    RAISE EXCEPTION 'H3_SOURCE_VERSION_ACTOR_TENANT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER h3_validate_source_version_trigger BEFORE INSERT OR UPDATE ON "screening_source_versions" FOR EACH ROW EXECUTE FUNCTION h3_validate_source_version();

CREATE FUNCTION h3_validate_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT h3_actor_is_member(NEW.organization_id, NEW.created_by_id) THEN
    RAISE EXCEPTION 'H3_SOURCE_ACTOR_TENANT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER h3_validate_source_trigger BEFORE INSERT OR UPDATE ON "screening_sources" FOR EACH ROW EXECUTE FUNCTION h3_validate_source();

CREATE FUNCTION h3_validate_children() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution_row screening_source_executions%ROWTYPE;
DECLARE candidate_row screening_candidates%ROWTYPE;
DECLARE query_row compliance_screening_results%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'screening_source_executions' THEN
    SELECT * INTO STRICT query_row FROM compliance_screening_results q
      WHERE q.id=NEW.query_id AND q.organization_id=NEW.organization_id AND q.contract_version='CUM-LST-001';
    IF TG_OP='INSERT' AND query_row.execution_state <> 'QUEUED' THEN
      RAISE EXCEPTION 'H3_QUERY_SOURCE_SET_FROZEN' USING ERRCODE='23514'; END IF;
    IF NEW.source_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM screening_source_versions v WHERE v.id=NEW.source_version_id AND v.organization_id=NEW.organization_id AND v.source_id=NEW.source_id) THEN
      RAISE EXCEPTION 'H3_EXECUTION_SOURCE_VERSION_MISMATCH' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME = 'screening_candidates' THEN
    SELECT * INTO STRICT execution_row FROM screening_source_executions e WHERE e.id=NEW.source_execution_id AND e.organization_id=NEW.organization_id;
    IF execution_row.query_id <> NEW.query_id THEN RAISE EXCEPTION 'H3_CANDIDATE_QUERY_EXECUTION_MISMATCH' USING ERRCODE='23514'; END IF;
    SELECT * INTO STRICT query_row FROM compliance_screening_results q
      WHERE q.id=NEW.query_id AND q.organization_id=NEW.organization_id AND q.contract_version='CUM-LST-001';
    IF TG_OP='INSERT' AND (query_row.execution_state <> 'RUNNING' OR execution_row.execution_state <> 'RUNNING') THEN
      RAISE EXCEPTION 'H3_LATE_CANDIDATE_INSERT_BLOCKED' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME = 'screening_human_resolutions' THEN
    SELECT * INTO STRICT candidate_row FROM screening_candidates c WHERE c.id=NEW.candidate_id AND c.organization_id=NEW.organization_id;
    IF NOT EXISTS (
      SELECT 1 FROM compliance_screening_results q
      WHERE q.id=candidate_row.query_id AND q.organization_id=NEW.organization_id AND q.contract_version='CUM-LST-001'
    ) THEN RAISE EXCEPTION 'H3_CHILD_ON_UNSAFE_LEGACY_QUERY' USING ERRCODE='23514'; END IF;
    IF NOT h3_actor_is_member(NEW.organization_id, NEW.resolved_by_id) THEN RAISE EXCEPTION 'H3_RESOLUTION_ACTOR_TENANT_MISMATCH' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME = 'screening_reports' THEN
    IF NOT EXISTS (
      SELECT 1 FROM compliance_screening_results q
      WHERE q.id=NEW.query_id AND q.organization_id=NEW.organization_id AND q.contract_version='CUM-LST-001'
    ) THEN RAISE EXCEPTION 'H3_CHILD_ON_UNSAFE_LEGACY_QUERY' USING ERRCODE='23514'; END IF;
    IF NOT h3_actor_is_member(NEW.organization_id, NEW.generated_by_id) THEN RAISE EXCEPTION 'H3_REPORT_ACTOR_TENANT_MISMATCH' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER h3_validate_execution_trigger BEFORE INSERT OR UPDATE ON "screening_source_executions" FOR EACH ROW EXECUTE FUNCTION h3_validate_children();
CREATE TRIGGER h3_validate_candidate_trigger BEFORE INSERT OR UPDATE ON "screening_candidates" FOR EACH ROW EXECUTE FUNCTION h3_validate_children();
CREATE TRIGGER h3_validate_resolution_trigger BEFORE INSERT OR UPDATE ON "screening_human_resolutions" FOR EACH ROW EXECUTE FUNCTION h3_validate_children();
CREATE TRIGGER h3_validate_report_trigger BEFORE INSERT OR UPDATE ON "screening_reports" FOR EACH ROW EXECUTE FUNCTION h3_validate_children();

CREATE FUNCTION h3_validate_operation_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE req compliance_requirements%ROWTYPE;
DECLARE qry compliance_screening_results%ROWTYPE;
BEGIN
  SELECT * INTO STRICT req FROM compliance_requirements r WHERE r.id=NEW.requirement_id AND r.organization_id=NEW.organization_id;
  SELECT * INTO STRICT qry FROM compliance_screening_results q WHERE q.id=NEW.query_id AND q.organization_id=NEW.organization_id AND q.contract_version='CUM-LST-001';
  IF req.provider <> 'LST' OR req.target_compareciente_id IS NULL OR qry.query_kind <> 'MASTER' OR qry.compareciente_id <> req.target_compareciente_id THEN
    RAISE EXCEPTION 'H3_REQUIREMENT_QUERY_PERSON_LINEAGE_MISMATCH' USING ERRCODE='23514'; END IF;
  IF NOT h3_actor_is_member(NEW.organization_id, NEW.captured_by_id) THEN RAISE EXCEPTION 'H3_SNAPSHOT_ACTOR_TENANT_MISMATCH' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER h3_validate_operation_snapshot_trigger BEFORE INSERT OR UPDATE ON "screening_operation_snapshots" FOR EACH ROW EXECUTE FUNCTION h3_validate_operation_snapshot();

CREATE FUNCTION h3_query_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.contract_version='CUM-LST-001' THEN RAISE EXCEPTION 'H3_QUERY_HARD_DELETE_BLOCKED' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF (OLD.contract_version='CUM-LST-001' OR NEW.contract_version='CUM-LST-001') AND OLD.contract_version IS DISTINCT FROM NEW.contract_version THEN
    RAISE EXCEPTION 'H3_QUERY_CONTRACT_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF OLD.contract_version='CUM-LST-001' THEN
    IF ROW(OLD.organization_id,OLD.contract_version,OLD.query_kind,OLD.compareciente_id,OLD.review_id,
           OLD.query_snapshot,OLD.identity_fingerprint,OLD.trigger_reason,OLD.trigger_key,OLD.trigger_event_id,
           OLD.owner_user_id,OLD.requested_by_id,OLD.provider,OLD.provider_version,OLD.correlation_id,OLD.created_at)
       IS DISTINCT FROM
       ROW(NEW.organization_id,NEW.contract_version,NEW.query_kind,NEW.compareciente_id,NEW.review_id,
           NEW.query_snapshot,NEW.identity_fingerprint,NEW.trigger_reason,NEW.trigger_key,NEW.trigger_event_id,
           NEW.owner_user_id,NEW.requested_by_id,NEW.provider,NEW.provider_version,NEW.correlation_id,NEW.created_at) THEN
      RAISE EXCEPTION 'H3_QUERY_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    IF OLD.execution_state IN ('SUCCEEDED','NOT_CONFIGURED') AND OLD IS DISTINCT FROM NEW THEN
      RAISE EXCEPTION 'H3_FINAL_QUERY_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    IF OLD.execution_state IS DISTINCT FROM NEW.execution_state AND NOT (
      (OLD.execution_state='QUEUED' AND NEW.execution_state IN ('RUNNING','NOT_CONFIGURED'))
      OR (OLD.execution_state='RUNNING' AND NEW.execution_state IN ('SUCCEEDED','PARTIAL','ERROR','NOT_CONFIGURED'))
      OR (OLD.execution_state IN ('PARTIAL','ERROR') AND NEW.execution_state='RUNNING')
    ) THEN RAISE EXCEPTION 'H3_QUERY_STATE_TRANSITION_INVALID' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER h3_query_history_guard_trigger BEFORE UPDATE OR DELETE ON "compliance_screening_results" FOR EACH ROW EXECUTE FUNCTION h3_query_history_guard();

CREATE FUNCTION h3_source_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM screening_source_executions e WHERE e.source_version_id=OLD.id)
     AND (TG_OP='DELETE' OR ROW(
       OLD.organization_id, OLD.source_id, OLD.version, OLD.dataset_checksum,
       OLD.adapter_key, OLD.adapter_version, OLD.provenance, OLD.available_at,
       OLD.effective_from, OLD.effective_to, OLD.created_by_id, OLD.created_at
     ) IS DISTINCT FROM ROW(
       NEW.organization_id, NEW.source_id, NEW.version, NEW.dataset_checksum,
       NEW.adapter_key, NEW.adapter_version, NEW.provenance, NEW.available_at,
       NEW.effective_from, NEW.effective_to, NEW.created_by_id, NEW.created_at
     )) THEN
    RAISE EXCEPTION 'H3_USED_SOURCE_VERSION_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER h3_source_version_immutable_trigger BEFORE UPDATE OR DELETE ON "screening_source_versions" FOR EACH ROW EXECUTE FUNCTION h3_source_version_immutable();

CREATE FUNCTION h3_source_execution_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'H3_SOURCE_EXECUTION_HARD_DELETE_BLOCKED' USING ERRCODE='23514'; END IF;
  IF ROW(OLD.organization_id,OLD.query_id,OLD.source_id,OLD.source_version_id,OLD.created_at)
     IS DISTINCT FROM ROW(NEW.organization_id,NEW.query_id,NEW.source_id,NEW.source_version_id,NEW.created_at) THEN
    RAISE EXCEPTION 'H3_SOURCE_EXECUTION_IDENTITY_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF OLD.execution_state IN ('SUCCEEDED','NOT_CONFIGURED') AND OLD IS DISTINCT FROM NEW THEN
    RAISE EXCEPTION 'H3_FINAL_SOURCE_EXECUTION_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF OLD.execution_state IS DISTINCT FROM NEW.execution_state AND NOT (
    (OLD.execution_state='QUEUED' AND NEW.execution_state IN ('RUNNING','NOT_CONFIGURED'))
    OR (OLD.execution_state='RUNNING' AND NEW.execution_state IN ('SUCCEEDED','PARTIAL','ERROR'))
    OR (OLD.execution_state IN ('PARTIAL','ERROR') AND NEW.execution_state='RUNNING')
  ) THEN RAISE EXCEPTION 'H3_SOURCE_EXECUTION_STATE_TRANSITION_INVALID' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER h3_source_execution_history_guard_trigger BEFORE UPDATE OR DELETE ON "screening_source_executions" FOR EACH ROW EXECUTE FUNCTION h3_source_execution_history_guard();

CREATE FUNCTION h3_source_execution_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution_row screening_source_executions%ROWTYPE;
DECLARE query_row compliance_screening_results%ROWTYPE;
DECLARE expected_attempt INTEGER;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'H3_ATTEMPT_HARD_DELETE_BLOCKED' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT * INTO STRICT execution_row FROM screening_source_executions e
      WHERE e.id=NEW.source_execution_id AND e.organization_id=NEW.organization_id;
    SELECT * INTO STRICT query_row FROM compliance_screening_results q
      WHERE q.id=execution_row.query_id AND q.organization_id=NEW.organization_id AND q.contract_version='CUM-LST-001';
    IF execution_row.execution_state <> 'RUNNING' OR query_row.execution_state <> 'RUNNING' THEN
      RAISE EXCEPTION 'H3_ATTEMPT_REQUIRES_RUNNING_CONTEXT' USING ERRCODE='23514'; END IF;
    SELECT COALESCE(MAX(a.attempt_number),0)+1 INTO expected_attempt FROM screening_source_execution_attempts a
      WHERE a.organization_id=NEW.organization_id AND a.source_execution_id=NEW.source_execution_id;
    IF NEW.attempt_number <> expected_attempt THEN RAISE EXCEPTION 'H3_ATTEMPT_NUMBER_INVALID' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF ROW(OLD.organization_id,OLD.source_execution_id,OLD.attempt_number,OLD.started_at,OLD.created_at)
     IS DISTINCT FROM ROW(NEW.organization_id,NEW.source_execution_id,NEW.attempt_number,NEW.started_at,NEW.created_at) THEN
    RAISE EXCEPTION 'H3_ATTEMPT_IDENTITY_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF OLD.execution_state IN ('SUCCEEDED','PARTIAL','ERROR') AND OLD IS DISTINCT FROM NEW THEN
    RAISE EXCEPTION 'H3_TERMINAL_ATTEMPT_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF OLD.execution_state IS DISTINCT FROM NEW.execution_state AND NOT (
    OLD.execution_state='RUNNING' AND NEW.execution_state IN ('SUCCEEDED','PARTIAL','ERROR')
  ) THEN RAISE EXCEPTION 'H3_ATTEMPT_STATE_TRANSITION_INVALID' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER h3_source_execution_attempt_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON "screening_source_execution_attempts" FOR EACH ROW EXECUTE FUNCTION h3_source_execution_attempt_guard();

CREATE FUNCTION h3_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'H3_HISTORY_APPEND_ONLY' USING ERRCODE='23514';
END $$;
CREATE TRIGGER h3_candidate_append_only_trigger BEFORE UPDATE OR DELETE ON "screening_candidates" FOR EACH ROW EXECUTE FUNCTION h3_append_only();
CREATE TRIGGER h3_resolution_append_only_trigger BEFORE UPDATE OR DELETE ON "screening_human_resolutions" FOR EACH ROW EXECUTE FUNCTION h3_append_only();
CREATE TRIGGER h3_snapshot_append_only_trigger BEFORE UPDATE OR DELETE ON "screening_operation_snapshots" FOR EACH ROW EXECUTE FUNCTION h3_append_only();
CREATE TRIGGER h3_report_append_only_trigger BEFORE UPDATE OR DELETE ON "screening_reports" FOR EACH ROW EXECUTE FUNCTION h3_append_only();

COMMIT;
