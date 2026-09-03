-- H4 · CUM-BC-001
-- Current ownership/control graph, immutable operation snapshots and regime-separated
-- evaluations. This migration intentionally activates no legal rule, source or format.
BEGIN;
SET LOCAL search_path TO pravia_os, public;

CREATE TYPE "ComplianceBcPartyKind" AS ENUM ('PF','PM');
CREATE TYPE "ComplianceBcIdentityMode" AS ENUM ('LINKED','STRUCTURED_ONLY');
CREATE TYPE "ComplianceBcControlKind" AS ENUM ('VOTE','APPOINTMENT','MANAGEMENT','AGREEMENT','OTHER');
CREATE TYPE "ComplianceBcReconciliationStatus" AS ENUM ('PENDING','ACCEPTED','REJECTED');
CREATE TYPE "ComplianceBcRegime" AS ENUM ('LFPIORPI','CFF_RMF');
CREATE TYPE "ComplianceBcEvaluationStatus" AS ENUM ('NOT_CONFIGURED','INCOMPLETE','REQUIRES_REVIEW','EVALUATED','NOT_APPLICABLE');
CREATE TYPE "ComplianceBcProposalStatus" AS ENUM ('PENDING','ACCEPTED','REJECTED','CONFLICT');

CREATE UNIQUE INDEX IF NOT EXISTS "h4_personas_morales_id_tenant_key"
  ON "personas_morales"("id","organization_id");

CREATE TABLE "persona_moral_ownership_structures" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "persona_moral_id" UUID NOT NULL,
  "root_node_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "fingerprint" VARCHAR(64) NOT NULL,
  "incomplete_markers" JSONB NOT NULL,
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "persona_moral_ownership_structures_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_h4_structure_revision" CHECK ("revision" >= 1),
  CONSTRAINT "ck_h4_structure_fingerprint" CHECK (length("fingerprint") = 64),
  CONSTRAINT "ck_h4_structure_markers_array" CHECK (jsonb_typeof("incomplete_markers") = 'array')
);

CREATE TABLE "persona_moral_ownership_nodes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "structure_id" UUID NOT NULL,
  "party_kind" "ComplianceBcPartyKind" NOT NULL,
  "identity_mode" "ComplianceBcIdentityMode" NOT NULL,
  "linked_compareciente_id" UUID,
  "display_name" VARCHAR(255),
  "incomplete" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "persona_moral_ownership_nodes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_h4_node_identity_xor" CHECK (
    ("identity_mode" = 'LINKED' AND "linked_compareciente_id" IS NOT NULL AND "display_name" IS NULL)
    OR
    ("identity_mode" = 'STRUCTURED_ONLY' AND "linked_compareciente_id" IS NULL AND "display_name" IS NOT NULL AND length(btrim("display_name")) > 0)
  ),
  CONSTRAINT "ck_h4_node_metadata_object" CHECK (jsonb_typeof("metadata") = 'object')
);

CREATE TABLE "persona_moral_ownership_edges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "structure_id" UUID NOT NULL,
  "owner_node_id" UUID NOT NULL,
  "owned_node_id" UUID NOT NULL,
  "percentage" DECIMAL(9,6),
  "evidence_document_id" UUID,
  "evidence_document_version" VARCHAR(128),
  "evidence_document_checksum" VARCHAR(128),
  "confirmed_by_id" UUID,
  "confirmed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "persona_moral_ownership_edges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_h4_edge_not_self" CHECK ("owner_node_id" <> "owned_node_id"),
  CONSTRAINT "ck_h4_edge_percentage" CHECK ("percentage" IS NULL OR ("percentage" >= 0 AND "percentage" <= 100)),
  CONSTRAINT "ck_h4_edge_evidence_snapshot" CHECK (
    ("evidence_document_id" IS NULL AND "evidence_document_version" IS NULL AND "evidence_document_checksum" IS NULL)
    OR ("evidence_document_id" IS NOT NULL AND "evidence_document_version" IS NOT NULL AND length(btrim("evidence_document_version")) > 0
        AND "evidence_document_checksum" IS NOT NULL AND length(btrim("evidence_document_checksum")) > 0)
  ),
  CONSTRAINT "ck_h4_edge_confirmation" CHECK (
    ("confirmed_by_id" IS NULL AND "confirmed_at" IS NULL) OR
    ("confirmed_by_id" IS NOT NULL AND "confirmed_at" IS NOT NULL)
  )
);

CREATE TABLE "persona_moral_control_facts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "structure_id" UUID NOT NULL,
  "subject_node_id" UUID NOT NULL,
  "kind" "ComplianceBcControlKind" NOT NULL,
  "description" TEXT,
  "evidence_document_id" UUID,
  "evidence_document_version" VARCHAR(128),
  "evidence_document_checksum" VARCHAR(128),
  "confirmed_by_id" UUID,
  "confirmed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "persona_moral_control_facts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_h4_control_evidence_snapshot" CHECK (
    ("evidence_document_id" IS NULL AND "evidence_document_version" IS NULL AND "evidence_document_checksum" IS NULL)
    OR ("evidence_document_id" IS NOT NULL AND "evidence_document_version" IS NOT NULL AND length(btrim("evidence_document_version")) > 0
        AND "evidence_document_checksum" IS NOT NULL AND length(btrim("evidence_document_checksum")) > 0)
  ),
  CONSTRAINT "ck_h4_control_confirmation" CHECK (
    ("confirmed_by_id" IS NULL AND "confirmed_at" IS NULL) OR
    ("confirmed_by_id" IS NOT NULL AND "confirmed_at" IS NOT NULL)
  ),
  CONSTRAINT "ck_h4_control_other_facts" CHECK ("kind" <> 'OTHER' OR (
    "description" IS NOT NULL AND length(btrim("description")) > 0
    AND "confirmed_by_id" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "evidence_document_id" IS NOT NULL))
);

CREATE TABLE "persona_moral_structure_reconciliations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "structure_id" UUID NOT NULL,
  "linked_persona_moral_id" UUID NOT NULL,
  "local_branch_snapshot" JSONB NOT NULL,
  "source_node_id" UUID NOT NULL,
  "source_revision" INTEGER NOT NULL,
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "target_revision" INTEGER NOT NULL,
  "canonical_fingerprint" VARCHAR(64) NOT NULL,
  "status" "ComplianceBcReconciliationStatus" NOT NULL DEFAULT 'PENDING',
  "decided_by_id" UUID,
  "decided_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "persona_moral_structure_reconciliations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_h4_reconciliation_fingerprint" CHECK (length("canonical_fingerprint") = 64),
  CONSTRAINT "ck_h4_reconciliation_decision" CHECK (
    ("status" = 'PENDING' AND "decided_by_id" IS NULL AND "decided_at" IS NULL)
    OR ("status" IN ('ACCEPTED','REJECTED') AND "decided_by_id" IS NOT NULL AND "decided_at" IS NOT NULL)
  )
);

CREATE TABLE "compliance_bc_structure_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "review_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "expediente_acto_id" UUID,
  "target_persona_moral_id" UUID NOT NULL,
  "structure_id" UUID NOT NULL,
  "structure_revision" INTEGER NOT NULL,
  "structure_fingerprint" VARCHAR(64) NOT NULL,
  "graph_snapshot" JSONB NOT NULL,
  "incomplete_markers" JSONB NOT NULL,
  "captured_by_id" UUID NOT NULL,
  "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_bc_structure_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_h4_snapshot_revision" CHECK ("structure_revision" >= 1),
  CONSTRAINT "ck_h4_snapshot_fingerprint" CHECK (length("structure_fingerprint") = 64),
  CONSTRAINT "ck_h4_snapshot_graph_object" CHECK (jsonb_typeof("graph_snapshot") = 'object'),
  CONSTRAINT "ck_h4_snapshot_markers_array" CHECK (jsonb_typeof("incomplete_markers") = 'array')
);

CREATE TABLE "compliance_bc_evaluations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "review_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "expediente_acto_id" UUID,
  "target_persona_moral_id" UUID NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "regime" "ComplianceBcRegime" NOT NULL,
  "status" "ComplianceBcEvaluationStatus" NOT NULL,
  "logical_hash" VARCHAR(64) NOT NULL,
  "rule_set_checksum" VARCHAR(128),
  "legal_date" DATE,
  "engine_version" VARCHAR(50) NOT NULL,
  "input_snapshot" JSONB NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "supersedes_evaluation_id" UUID,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_bc_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_h4_evaluation_logical_hash" CHECK (length("logical_hash") = 64),
  CONSTRAINT "ck_h4_evaluation_rule_configuration" CHECK (
    ("status" = 'NOT_CONFIGURED' AND "rule_set_checksum" IS NULL)
    OR ("status" <> 'NOT_CONFIGURED' AND "rule_set_checksum" IS NOT NULL)
  ),
  CONSTRAINT "ck_h4_evaluation_snapshots" CHECK (
    jsonb_typeof("input_snapshot") = 'object' AND jsonb_typeof("result_snapshot") = 'object'
  )
);

CREATE TABLE "compliance_bc_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "evaluation_id" UUID NOT NULL,
  "subject_compareciente_id" UUID,
  "subject_snapshot_node_id" UUID,
  "determination" VARCHAR(80) NOT NULL,
  "facts_snapshot" JSONB NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_bc_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_h4_result_subject" CHECK (("subject_compareciente_id" IS NOT NULL) <> ("subject_snapshot_node_id" IS NOT NULL)),
  CONSTRAINT "ck_h4_result_snapshots" CHECK (jsonb_typeof("facts_snapshot") = 'array' AND jsonb_typeof("result_snapshot") = 'object')
);

CREATE TABLE "compliance_bc_ai_proposals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "structure_id" UUID NOT NULL,
  "source_document_id" UUID NOT NULL,
  "source_document_version" VARCHAR(128) NOT NULL,
  "source_document_checksum" VARCHAR(128) NOT NULL,
  "source_pages" JSONB NOT NULL,
  "base_revision" INTEGER NOT NULL,
  "base_fingerprint" VARCHAR(64) NOT NULL,
  "proposed_changes" JSONB NOT NULL,
  "provider" VARCHAR(80) NOT NULL,
  "model" VARCHAR(120) NOT NULL,
  "prompt_version" VARCHAR(80) NOT NULL,
  "status" "ComplianceBcProposalStatus" NOT NULL DEFAULT 'PENDING',
  "created_by_id" UUID NOT NULL,
  "decided_by_id" UUID,
  "decided_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_bc_ai_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_h4_ai_source" CHECK (length(btrim("source_document_version")) > 0 AND length(btrim("source_document_checksum")) > 0),
  CONSTRAINT "ck_h4_ai_base" CHECK ("base_revision" >= 1 AND length("base_fingerprint") = 64),
  CONSTRAINT "ck_h4_ai_pages_array" CHECK (jsonb_typeof("source_pages") = 'array'),
  CONSTRAINT "ck_h4_ai_changes_object" CHECK (jsonb_typeof("proposed_changes") = 'object'),
  CONSTRAINT "ck_h4_ai_decision" CHECK (
    ("status" = 'PENDING' AND "decided_by_id" IS NULL AND "decided_at" IS NULL)
    OR ("status" IN ('ACCEPTED','REJECTED','CONFLICT') AND "decided_by_id" IS NOT NULL AND "decided_at" IS NOT NULL)
  )
);

CREATE TABLE "compliance_bc_format_mappings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "format_key" VARCHAR(120) NOT NULL,
  "status" VARCHAR(40) NOT NULL DEFAULT 'NOT_CONFIGURED',
  "template_document_id" UUID,
  "configuration" JSONB NOT NULL,
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_bc_format_mappings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_h4_format_status" CHECK ("status" IN ('NOT_CONFIGURED','CONFIGURED')),
  CONSTRAINT "ck_h4_format_configuration" CHECK (jsonb_typeof("configuration") = 'object')
);

CREATE TABLE "expediente_society_targets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "expediente_acto_id" UUID,
  "persona_moral_id" UUID NOT NULL,
  "target_intent_key" VARCHAR(160) NOT NULL,
  "status" VARCHAR(40) NOT NULL DEFAULT 'EN_CONSTITUCION',
  "applicability_status" VARCHAR(40) NOT NULL DEFAULT 'NOT_CONFIGURED',
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_society_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_h4_society_status" CHECK ("status" IN ('EN_CONSTITUCION','CONSTITUIDA','PENDING_REVIEW')),
  CONSTRAINT "ck_h4_society_applicability" CHECK ("applicability_status" IN ('NOT_CONFIGURED','APPLIES','NOT_APPLICABLE'))
);

CREATE UNIQUE INDEX "pm_ownership_structures_tenant_person_key" ON "persona_moral_ownership_structures"("organization_id","persona_moral_id");
CREATE UNIQUE INDEX "pm_ownership_structures_id_tenant_key" ON "persona_moral_ownership_structures"("id","organization_id");
CREATE INDEX "idx_pm_ownership_structures_fingerprint" ON "persona_moral_ownership_structures"("organization_id","fingerprint");
CREATE UNIQUE INDEX "pm_ownership_nodes_id_tenant_key" ON "persona_moral_ownership_nodes"("id","organization_id");
CREATE INDEX "idx_pm_ownership_nodes_structure" ON "persona_moral_ownership_nodes"("organization_id","structure_id");
CREATE INDEX "idx_pm_ownership_nodes_linked_party" ON "persona_moral_ownership_nodes"("organization_id","linked_compareciente_id");
CREATE UNIQUE INDEX "pm_ownership_edges_identity_key" ON "persona_moral_ownership_edges"("organization_id","structure_id","owner_node_id","owned_node_id");
CREATE UNIQUE INDEX "pm_ownership_edges_id_tenant_key" ON "persona_moral_ownership_edges"("id","organization_id");
CREATE INDEX "idx_pm_ownership_edges_evidence" ON "persona_moral_ownership_edges"("organization_id","evidence_document_id");
CREATE UNIQUE INDEX "pm_control_facts_id_tenant_key" ON "persona_moral_control_facts"("id","organization_id");
CREATE INDEX "idx_pm_control_facts_structure" ON "persona_moral_control_facts"("organization_id","structure_id");
CREATE INDEX "idx_pm_control_facts_evidence" ON "persona_moral_control_facts"("organization_id","evidence_document_id");
CREATE UNIQUE INDEX "pm_structure_reconciliations_id_tenant_key" ON "persona_moral_structure_reconciliations"("id","organization_id");
CREATE INDEX "idx_pm_structure_reconciliations_pending" ON "persona_moral_structure_reconciliations"("organization_id","structure_id","status");
CREATE UNIQUE INDEX "compliance_bc_snapshots_identity_key" ON "compliance_bc_structure_snapshots"("organization_id","review_id","target_persona_moral_id","expediente_acto_id","structure_fingerprint");
CREATE UNIQUE INDEX "h4_snapshot_general_identity_key" ON "compliance_bc_structure_snapshots"("organization_id","review_id","target_persona_moral_id","structure_fingerprint") WHERE expediente_acto_id IS NULL;
CREATE UNIQUE INDEX "compliance_bc_snapshots_id_tenant_key" ON "compliance_bc_structure_snapshots"("id","organization_id");
CREATE INDEX "idx_compliance_bc_snapshots_case" ON "compliance_bc_structure_snapshots"("organization_id","expediente_id","review_id");
CREATE UNIQUE INDEX "compliance_bc_evaluations_logical_key" ON "compliance_bc_evaluations"("organization_id","logical_hash");
CREATE UNIQUE INDEX "compliance_bc_evaluations_id_tenant_key" ON "compliance_bc_evaluations"("id","organization_id");
CREATE INDEX "idx_compliance_bc_evaluations_case" ON "compliance_bc_evaluations"("organization_id","expediente_id","review_id","regime");
CREATE UNIQUE INDEX "compliance_bc_results_identity_key" ON "compliance_bc_results"("organization_id","evaluation_id","subject_snapshot_node_id","determination");
CREATE UNIQUE INDEX "h4_result_linked_identity_key" ON "compliance_bc_results"("organization_id","evaluation_id","subject_compareciente_id","determination") WHERE subject_compareciente_id IS NOT NULL;
CREATE UNIQUE INDEX "compliance_bc_results_id_tenant_key" ON "compliance_bc_results"("id","organization_id");
CREATE UNIQUE INDEX "compliance_bc_ai_proposals_id_tenant_key" ON "compliance_bc_ai_proposals"("id","organization_id");
CREATE INDEX "idx_compliance_bc_ai_proposals_pending" ON "compliance_bc_ai_proposals"("organization_id","structure_id","status");
CREATE UNIQUE INDEX "compliance_bc_format_mappings_tenant_key" ON "compliance_bc_format_mappings"("organization_id","format_key");
CREATE UNIQUE INDEX "expediente_society_targets_intent_key" ON "expediente_society_targets"("organization_id","target_intent_key");
CREATE UNIQUE INDEX "expediente_society_targets_id_tenant_key" ON "expediente_society_targets"("id","organization_id");
CREATE INDEX "idx_expediente_society_targets_case" ON "expediente_society_targets"("organization_id","expediente_id","status");

ALTER TABLE "persona_moral_ownership_structures" ADD CONSTRAINT "h4_structure_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_ownership_structures" ADD CONSTRAINT "h4_structure_pm_fkey" FOREIGN KEY ("persona_moral_id","organization_id") REFERENCES "personas_morales"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_ownership_structures" ADD CONSTRAINT "h4_structure_creator_fkey" FOREIGN KEY ("organization_id","created_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_ownership_structures" ADD CONSTRAINT "h4_structure_updater_fkey" FOREIGN KEY ("organization_id","updated_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_ownership_nodes" ADD CONSTRAINT "h4_node_structure_fkey" FOREIGN KEY ("structure_id","organization_id") REFERENCES "persona_moral_ownership_structures"("id","organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_ownership_nodes" ADD CONSTRAINT "h4_node_party_fkey" FOREIGN KEY ("linked_compareciente_id","organization_id") REFERENCES "comparecientes"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_ownership_edges" ADD CONSTRAINT "h4_edge_structure_fkey" FOREIGN KEY ("structure_id","organization_id") REFERENCES "persona_moral_ownership_structures"("id","organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_ownership_edges" ADD CONSTRAINT "h4_edge_owner_fkey" FOREIGN KEY ("owner_node_id","organization_id") REFERENCES "persona_moral_ownership_nodes"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_ownership_edges" ADD CONSTRAINT "h4_edge_owned_fkey" FOREIGN KEY ("owned_node_id","organization_id") REFERENCES "persona_moral_ownership_nodes"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_ownership_edges" ADD CONSTRAINT "h4_edge_document_fkey" FOREIGN KEY ("evidence_document_id","organization_id") REFERENCES "documentos"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_ownership_edges" ADD CONSTRAINT "h4_edge_confirmer_fkey" FOREIGN KEY ("organization_id","confirmed_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_control_facts" ADD CONSTRAINT "h4_control_structure_fkey" FOREIGN KEY ("structure_id","organization_id") REFERENCES "persona_moral_ownership_structures"("id","organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_control_facts" ADD CONSTRAINT "h4_control_subject_fkey" FOREIGN KEY ("subject_node_id","organization_id") REFERENCES "persona_moral_ownership_nodes"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_control_facts" ADD CONSTRAINT "h4_control_document_fkey" FOREIGN KEY ("evidence_document_id","organization_id") REFERENCES "documentos"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_control_facts" ADD CONSTRAINT "h4_control_confirmer_fkey" FOREIGN KEY ("organization_id","confirmed_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_structure_reconciliations" ADD CONSTRAINT "h4_reconciliation_structure_fkey" FOREIGN KEY ("structure_id","organization_id") REFERENCES "persona_moral_ownership_structures"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_structure_reconciliations" ADD CONSTRAINT "h4_reconciliation_pm_fkey" FOREIGN KEY ("linked_persona_moral_id","organization_id") REFERENCES "personas_morales"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "persona_moral_structure_reconciliations" ADD CONSTRAINT "h4_reconciliation_decider_fkey" FOREIGN KEY ("organization_id","decided_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_structure_snapshots" ADD CONSTRAINT "h4_snapshot_review_fkey" FOREIGN KEY ("review_id","organization_id","expediente_id") REFERENCES "compliance_reviews"("id","organization_id","expediente_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_structure_snapshots" ADD CONSTRAINT "h4_snapshot_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_structure_snapshots" ADD CONSTRAINT "h4_snapshot_case_fkey" FOREIGN KEY ("expediente_id","organization_id") REFERENCES "expedientes"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_structure_snapshots" ADD CONSTRAINT "h4_snapshot_act_fkey" FOREIGN KEY ("expediente_acto_id","organization_id") REFERENCES "expediente_actos"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_structure_snapshots" ADD CONSTRAINT "h4_snapshot_structure_fkey" FOREIGN KEY ("structure_id","organization_id") REFERENCES "persona_moral_ownership_structures"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_structure_snapshots" ADD CONSTRAINT "h4_snapshot_pm_fkey" FOREIGN KEY ("target_persona_moral_id","organization_id") REFERENCES "personas_morales"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_structure_snapshots" ADD CONSTRAINT "h4_snapshot_actor_fkey" FOREIGN KEY ("organization_id","captured_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_evaluations" ADD CONSTRAINT "h4_evaluation_snapshot_fkey" FOREIGN KEY ("snapshot_id","organization_id") REFERENCES "compliance_bc_structure_snapshots"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_evaluations" ADD CONSTRAINT "h4_evaluation_supersedes_fkey" FOREIGN KEY ("supersedes_evaluation_id","organization_id") REFERENCES "compliance_bc_evaluations"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_evaluations" ADD CONSTRAINT "h4_evaluation_actor_fkey" FOREIGN KEY ("organization_id","created_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_results" ADD CONSTRAINT "h4_result_evaluation_fkey" FOREIGN KEY ("evaluation_id","organization_id") REFERENCES "compliance_bc_evaluations"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_results" ADD CONSTRAINT "h4_result_subject_fkey" FOREIGN KEY ("subject_compareciente_id","organization_id") REFERENCES "comparecientes"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_ai_proposals" ADD CONSTRAINT "h4_ai_structure_fkey" FOREIGN KEY ("structure_id","organization_id") REFERENCES "persona_moral_ownership_structures"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_ai_proposals" ADD CONSTRAINT "h4_ai_document_fkey" FOREIGN KEY ("source_document_id","organization_id") REFERENCES "documentos"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_ai_proposals" ADD CONSTRAINT "h4_ai_creator_fkey" FOREIGN KEY ("organization_id","created_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_ai_proposals" ADD CONSTRAINT "h4_ai_decider_fkey" FOREIGN KEY ("organization_id","decided_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_format_mappings" ADD CONSTRAINT "h4_format_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_format_mappings" ADD CONSTRAINT "h4_format_document_fkey" FOREIGN KEY ("template_document_id","organization_id") REFERENCES "documentos"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_format_mappings" ADD CONSTRAINT "h4_format_creator_fkey" FOREIGN KEY ("organization_id","created_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_bc_format_mappings" ADD CONSTRAINT "h4_format_updater_fkey" FOREIGN KEY ("organization_id","updated_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "expediente_society_targets" ADD CONSTRAINT "h4_society_case_fkey" FOREIGN KEY ("expediente_id","organization_id") REFERENCES "expedientes"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "expediente_society_targets" ADD CONSTRAINT "h4_society_act_fkey" FOREIGN KEY ("expediente_acto_id","organization_id") REFERENCES "expediente_actos"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "expediente_society_targets" ADD CONSTRAINT "h4_society_pm_fkey" FOREIGN KEY ("persona_moral_id","organization_id") REFERENCES "personas_morales"("id","organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "expediente_society_targets" ADD CONSTRAINT "h4_society_creator_fkey" FOREIGN KEY ("organization_id","created_by_id") REFERENCES "organization_memberships"("organization_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE OR REPLACE FUNCTION h4_validate_graph_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_structure UUID;
BEGIN
  expected_structure := NEW.structure_id;
  IF TG_TABLE_NAME = 'persona_moral_ownership_edges' THEN
    IF NOT EXISTS (SELECT 1 FROM persona_moral_ownership_nodes n WHERE n.id = NEW.owner_node_id AND n.organization_id = NEW.organization_id AND n.structure_id = expected_structure)
       OR NOT EXISTS (SELECT 1 FROM persona_moral_ownership_nodes n WHERE n.id = NEW.owned_node_id AND n.organization_id = NEW.organization_id AND n.structure_id = expected_structure) THEN
      RAISE EXCEPTION 'H4_GRAPH_NODE_LINEAGE_MISMATCH' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM persona_moral_ownership_nodes n WHERE n.id = NEW.subject_node_id AND n.organization_id = NEW.organization_id AND n.structure_id = expected_structure) THEN
      RAISE EXCEPTION 'H4_CONTROL_NODE_LINEAGE_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_h4_edge_lineage BEFORE INSERT OR UPDATE ON "persona_moral_ownership_edges" FOR EACH ROW EXECUTE FUNCTION h4_validate_graph_lineage();
CREATE TRIGGER trg_h4_control_lineage BEFORE INSERT OR UPDATE ON "persona_moral_control_facts" FOR EACH ROW EXECUTE FUNCTION h4_validate_graph_lineage();

CREATE OR REPLACE FUNCTION h4_validate_snapshot_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM persona_moral_ownership_structures s
    WHERE s.id = NEW.structure_id AND s.organization_id = NEW.organization_id
      AND s.persona_moral_id = NEW.target_persona_moral_id AND s.revision = NEW.structure_revision
      AND NEW.graph_snapshot->>'root_node_id' = s.root_node_id::text) THEN
    RAISE EXCEPTION 'H4_SNAPSHOT_STRUCTURE_TARGET_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM compliance_reviews r
    WHERE r.id = NEW.review_id AND r.expediente_id = NEW.expediente_id AND r.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'H4_SNAPSHOT_REVIEW_CASE_TENANT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NEW.expediente_acto_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM expediente_actos a
    WHERE a.id = NEW.expediente_acto_id AND a.expediente_id = NEW.expediente_id AND a.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'H4_SNAPSHOT_ACT_CASE_TENANT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_h4_snapshot_context BEFORE INSERT ON "compliance_bc_structure_snapshots" FOR EACH ROW EXECUTE FUNCTION h4_validate_snapshot_context();

CREATE OR REPLACE FUNCTION h4_validate_evaluation_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen_graph JSONB; execution JSONB;
BEGIN
  IF NEW.supersedes_evaluation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM compliance_bc_evaluations e WHERE e.id = NEW.supersedes_evaluation_id
      AND e.organization_id = NEW.organization_id AND e.expediente_id = NEW.expediente_id
      AND e.target_persona_moral_id = NEW.target_persona_moral_id AND e.regime = NEW.regime
      AND e.expediente_acto_id IS NOT DISTINCT FROM NEW.expediente_acto_id AND e.review_id <> NEW.review_id
  ) THEN RAISE EXCEPTION 'H4_SUPERSEDES_CONTEXT_MISMATCH' USING ERRCODE = '23514'; END IF;
  IF NEW.status IN ('EVALUATED', 'NOT_APPLICABLE') AND (
    NEW.legal_date IS NULL OR jsonb_typeof(NEW.input_snapshot->'executed_rule_result_ids') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.input_snapshot->'executed_rule_result_ids') < 1
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(NEW.input_snapshot->'executed_rule_result_ids') rid
      WHERE NOT EXISTS (SELECT 1 FROM compliance_rule_results rr JOIN compliance_legal_rule_revisions rv ON rv.id = rr.rule_revision_id
        WHERE rr.id::text = rid AND rr.organization_id = NEW.organization_id AND rr.review_id = NEW.review_id
          AND rr.expediente_acto_id IS NOT DISTINCT FROM NEW.expediente_acto_id
          AND rv.organization_id = NEW.organization_id AND rv.verified_at IS NOT NULL
          AND rv.status IN ('ACTIVE', 'RETIRED') AND rv.source_checksum IS NOT NULL
          AND rv.outcome->'bc'->>'regime' = NEW.regime::text)
    ) OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(NEW.input_snapshot->'executed_rule_result_ids') rid
      JOIN compliance_rule_results rr ON rr.id::text = rid
      JOIN compliance_legal_rule_revisions rv ON rv.id = rr.rule_revision_id AND rv.organization_id = rr.organization_id
      WHERE rr.organization_id = NEW.organization_id AND rr.review_id = NEW.review_id
        AND rr.expediente_acto_id IS NOT DISTINCT FROM NEW.expediente_acto_id
        AND rv.outcome->'bc'->>'regime' = NEW.regime::text AND rv.outcome->'bc'->>'purpose' = 'APPLICABILITY'
    ) OR (NEW.status = 'EVALUATED' AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(NEW.input_snapshot->'executed_rule_result_ids') rid
      JOIN compliance_rule_results rr ON rr.id::text = rid
      JOIN compliance_legal_rule_revisions rv ON rv.id = rr.rule_revision_id AND rv.organization_id = rr.organization_id
      WHERE rr.organization_id = NEW.organization_id AND rr.review_id = NEW.review_id
        AND rr.expediente_acto_id IS NOT DISTINCT FROM NEW.expediente_acto_id
        AND rv.outcome->'bc'->>'regime' = NEW.regime::text AND rv.outcome->'bc'->>'purpose' = 'DETERMINATION'
    ))
  ) THEN RAISE EXCEPTION 'H4_EVALUATION_REQUIRES_EXECUTED_H1_RULES' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM compliance_bc_structure_snapshots s
    WHERE s.id = NEW.snapshot_id AND s.organization_id = NEW.organization_id
      AND s.review_id = NEW.review_id AND s.expediente_id = NEW.expediente_id
      AND s.target_persona_moral_id = NEW.target_persona_moral_id
      AND s.expediente_acto_id IS NOT DISTINCT FROM NEW.expediente_acto_id
  ) THEN
    RAISE EXCEPTION 'H4_EVALUATION_SNAPSHOT_LINEAGE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  SELECT graph_snapshot INTO frozen_graph FROM compliance_bc_structure_snapshots WHERE id = NEW.snapshot_id AND organization_id = NEW.organization_id;
  IF jsonb_typeof(NEW.result_snapshot->'subject_executions') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'H4_EXECUTION_SNAPSHOT_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT e->>'execution_id') FROM jsonb_array_elements(NEW.result_snapshot->'subject_executions') e) THEN
    RAISE EXCEPTION 'H4_EXECUTION_IDENTITY_DUPLICATE' USING ERRCODE = '23514';
  END IF;
  FOR execution IN SELECT value FROM jsonb_array_elements(NEW.result_snapshot->'subject_executions') LOOP
    IF NOT EXISTS (
      SELECT 1 FROM compliance_rule_results rr JOIN compliance_legal_rule_revisions rv ON rv.id = rr.rule_revision_id AND rv.organization_id = rr.organization_id
      WHERE rr.id::text = execution->>'h1_rule_result_id' AND rr.organization_id = NEW.organization_id
        AND rr.review_id = NEW.review_id AND rr.expediente_acto_id IS NOT DISTINCT FROM NEW.expediente_acto_id
        AND rr.rule_revision_id::text = execution->>'ruleRevisionId'
        AND (NEW.input_snapshot->'executed_rule_result_ids') ? rr.id::text
        AND rv.outcome->'bc'->>'regime' = NEW.regime::text
        AND ((rv.outcome->'bc'->>'purpose' = 'APPLICABILITY' AND execution->>'bc_subject_node_id' IS NULL)
          OR (rv.outcome->'bc'->>'purpose' = 'DETERMINATION' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(frozen_graph->'nodes') n WHERE n->>'id' = execution->>'bc_subject_node_id'
              AND n->>'id' <> frozen_graph->>'root_node_id' AND execution->'bc_facts'->'subject' = n)))
    ) OR execution->>'truth' IS NULL OR execution->>'truth' NOT IN ('TRUE','FALSE','UNKNOWN')
      OR COALESCE(execution->>'execution_id','') !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'H4_EXECUTION_SUBJECT_LINEAGE_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_h4_evaluation_context BEFORE INSERT ON "compliance_bc_evaluations" FOR EACH ROW EXECUTE FUNCTION h4_validate_evaluation_context();

CREATE OR REPLACE FUNCTION h4_validate_linked_node_kind() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_kind TEXT;
BEGIN
  IF NEW.identity_mode = 'LINKED' THEN
    SELECT CASE c.tipo_persona::text WHEN 'FISICA' THEN 'PF' WHEN 'MORAL' THEN 'PM' END INTO actual_kind FROM comparecientes c
      WHERE c.id = NEW.linked_compareciente_id AND c.organization_id = NEW.organization_id;
    IF actual_kind IS NULL OR actual_kind <> NEW.party_kind::text THEN
      RAISE EXCEPTION 'H4_LINKED_NODE_KIND_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_h4_linked_node_kind BEFORE INSERT OR UPDATE ON "persona_moral_ownership_nodes" FOR EACH ROW EXECUTE FUNCTION h4_validate_linked_node_kind();

CREATE OR REPLACE FUNCTION h4_reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'H4_IMMUTABLE_RECORD' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER trg_h4_snapshot_immutable BEFORE UPDATE OR DELETE ON "compliance_bc_structure_snapshots" FOR EACH ROW EXECUTE FUNCTION h4_reject_immutable_change();
CREATE TRIGGER trg_h4_evaluation_immutable BEFORE UPDATE OR DELETE ON "compliance_bc_evaluations" FOR EACH ROW EXECUTE FUNCTION h4_reject_immutable_change();
CREATE TRIGGER trg_h4_result_immutable BEFORE UPDATE OR DELETE ON "compliance_bc_results" FOR EACH ROW EXECUTE FUNCTION h4_reject_immutable_change();

CREATE OR REPLACE FUNCTION h4_enforce_result_evaluated() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE graph JSONB; evaluation_record compliance_bc_evaluations%ROWTYPE;
  execution JSONB; execution_key TEXT; expected_facts JSONB := '[]'::jsonb;
  expected_rules JSONB := '[]'::jsonb; expected_nodes JSONB := '[]'::jsonb; first_execution JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM compliance_bc_evaluations e
      WHERE e.id = NEW.evaluation_id AND e.organization_id = NEW.organization_id AND e.status = 'EVALUATED'
  ) THEN
    RAISE EXCEPTION 'H4_RESULT_REQUIRES_VERIFIED_EVALUATION' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO evaluation_record FROM compliance_bc_evaluations WHERE id = NEW.evaluation_id AND organization_id = NEW.organization_id;
  SELECT graph_snapshot INTO graph FROM compliance_bc_structure_snapshots WHERE id = evaluation_record.snapshot_id AND organization_id = NEW.organization_id;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(graph->'nodes') n WHERE
    (NEW.subject_snapshot_node_id IS NOT NULL AND n->>'id' = NEW.subject_snapshot_node_id::text AND n->>'identity_mode' = 'STRUCTURED_ONLY')
    OR (NEW.subject_compareciente_id IS NOT NULL AND n->>'linked_compareciente_id' = NEW.subject_compareciente_id::text AND n->>'identity_mode' = 'LINKED')) THEN
    RAISE EXCEPTION 'H4_RESULT_SUBJECT_SNAPSHOT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM compliance_rule_results rr JOIN compliance_legal_rule_revisions rv ON rv.id = rr.rule_revision_id
    WHERE rr.id::text = NEW.result_snapshot->>'h1_rule_result_id' AND rr.organization_id = NEW.organization_id
      AND rr.review_id = evaluation_record.review_id AND rr.expediente_acto_id IS NOT DISTINCT FROM evaluation_record.expediente_acto_id
      AND rr.rule_revision_id::text = NEW.result_snapshot->>'rule_revision_id'
      AND rv.outcome->'bc'->>'regime' = evaluation_record.regime::text
      AND rv.outcome->'bc'->>'purpose' = 'DETERMINATION' AND rr.applicability IN ('APLICA_SIN_AVISO','APLICA_CON_AVISO')) THEN
    RAISE EXCEPTION 'H4_RESULT_EXECUTED_RULE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(NEW.result_snapshot->'execution_ids') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.result_snapshot->'execution_ids') = 0 THEN
    RAISE EXCEPTION 'H4_RESULT_EXECUTION_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT value) FROM jsonb_array_elements_text(NEW.result_snapshot->'execution_ids')) THEN
    RAISE EXCEPTION 'H4_RESULT_EXECUTION_DUPLICATE' USING ERRCODE = '23514';
  END IF;
  FOR execution_key IN SELECT value FROM jsonb_array_elements_text(NEW.result_snapshot->'execution_ids') ORDER BY value LOOP
    SELECT e INTO execution FROM jsonb_array_elements(evaluation_record.result_snapshot->'subject_executions') e WHERE e->>'execution_id' = execution_key;
    IF execution IS NULL OR execution->>'truth' IS DISTINCT FROM 'TRUE' OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(graph->'nodes') n WHERE n->>'id' = execution->>'bc_subject_node_id'
        AND execution->'bc_facts'->'subject' = n AND
        ((NEW.subject_compareciente_id IS NOT NULL AND n->>'identity_mode' = 'LINKED' AND n->>'linked_compareciente_id' = NEW.subject_compareciente_id::text)
        OR (NEW.subject_snapshot_node_id IS NOT NULL AND n->>'identity_mode' = 'STRUCTURED_ONLY' AND n->>'id' = NEW.subject_snapshot_node_id::text))
    ) THEN RAISE EXCEPTION 'H4_RESULT_EXECUTION_SUBJECT_MISMATCH' USING ERRCODE = '23514'; END IF;
    IF first_execution IS NULL THEN first_execution := execution; END IF;
    expected_facts := expected_facts || jsonb_build_array(execution->'bc_facts');
    IF NOT expected_rules ? (execution->>'h1_rule_result_id') THEN expected_rules := expected_rules || jsonb_build_array(execution->>'h1_rule_result_id'); END IF;
    IF NOT expected_nodes ? (execution->>'bc_subject_node_id') THEN expected_nodes := expected_nodes || jsonb_build_array(execution->>'bc_subject_node_id'); END IF;
  END LOOP;
  IF NEW.facts_snapshot IS DISTINCT FROM expected_facts
    OR NEW.result_snapshot->'supporting_rule_result_ids' IS DISTINCT FROM expected_rules
    OR NEW.result_snapshot->'node_ids' IS DISTINCT FROM expected_nodes
    OR NEW.result_snapshot->>'h1_rule_result_id' IS DISTINCT FROM first_execution->>'h1_rule_result_id'
    OR NEW.result_snapshot->>'rule_revision_id' IS DISTINCT FROM first_execution->>'ruleRevisionId' THEN
    RAISE EXCEPTION 'H4_RESULT_FACTS_EXECUTION_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_h4_result_requires_evaluated BEFORE INSERT ON "compliance_bc_results" FOR EACH ROW EXECUTE FUNCTION h4_enforce_result_evaluated();

-- Deferrable semantic root check permits replacing current graph rows atomically.
CREATE OR REPLACE FUNCTION h4_validate_structure_root() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE structure_key UUID; previous_structure_key UUID;
BEGIN
  IF TG_TABLE_NAME = 'persona_moral_ownership_structures' THEN
    structure_key := (to_jsonb(NEW)->>'id')::uuid;
  ELSIF TG_OP = 'DELETE' THEN
    structure_key := (to_jsonb(OLD)->>'structure_id')::uuid;
  ELSE
    structure_key := (to_jsonb(NEW)->>'structure_id')::uuid;
  END IF;
  IF EXISTS (SELECT 1 FROM persona_moral_ownership_structures s WHERE s.id = structure_key AND NOT EXISTS (
    SELECT 1 FROM persona_moral_ownership_nodes n JOIN personas_morales pm ON pm.id = s.persona_moral_id AND pm.organization_id = s.organization_id
    WHERE n.id = s.root_node_id AND n.structure_id = s.id AND n.organization_id = s.organization_id
      AND n.party_kind = 'PM' AND n.identity_mode = 'LINKED' AND n.linked_compareciente_id = pm.compareciente_id
  )) THEN RAISE EXCEPTION 'H4_STRUCTURE_ROOT_TARGET_MISMATCH' USING ERRCODE = '23514'; END IF;
  IF TG_TABLE_NAME = 'persona_moral_ownership_nodes' AND TG_OP = 'UPDATE'
    AND (to_jsonb(OLD)->>'structure_id')::uuid IS DISTINCT FROM (to_jsonb(NEW)->>'structure_id')::uuid THEN
    previous_structure_key := (to_jsonb(OLD)->>'structure_id')::uuid;
    IF EXISTS (SELECT 1 FROM persona_moral_ownership_structures s WHERE s.id = previous_structure_key AND NOT EXISTS (
      SELECT 1 FROM persona_moral_ownership_nodes n JOIN personas_morales pm ON pm.id = s.persona_moral_id AND pm.organization_id = s.organization_id
      WHERE n.id = s.root_node_id AND n.structure_id = s.id AND n.organization_id = s.organization_id
        AND n.party_kind = 'PM' AND n.identity_mode = 'LINKED' AND n.linked_compareciente_id = pm.compareciente_id
    )) THEN RAISE EXCEPTION 'H4_STRUCTURE_ROOT_TARGET_MISMATCH' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_h4_structure_root AFTER INSERT OR UPDATE ON persona_moral_ownership_structures DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION h4_validate_structure_root();
CREATE CONSTRAINT TRIGGER trg_h4_node_root AFTER INSERT OR UPDATE OR DELETE ON persona_moral_ownership_nodes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION h4_validate_structure_root();

CREATE OR REPLACE FUNCTION h4_validate_society_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expediente_acto_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM expediente_actos a
    WHERE a.id = NEW.expediente_acto_id AND a.expediente_id = NEW.expediente_id AND a.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'H4_SOCIETY_ACT_CONTEXT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_h4_society_context BEFORE INSERT OR UPDATE ON expediente_society_targets FOR EACH ROW EXECUTE FUNCTION h4_validate_society_context();

CREATE INDEX "idx_fk_compliance_bc_ai_proposals_63f3def5" ON "compliance_bc_ai_proposals"("organization_id","created_by_id");
CREATE INDEX "idx_fk_compliance_bc_ai_proposals_c2d29517" ON "compliance_bc_ai_proposals"("organization_id","decided_by_id");
CREATE INDEX "idx_fk_compliance_bc_ai_proposals_e8f7a06a" ON "compliance_bc_ai_proposals"("source_document_id","organization_id");
CREATE INDEX "idx_fk_compliance_bc_evaluations_60e98cdc" ON "compliance_bc_evaluations"("organization_id","created_by_id");
CREATE INDEX "idx_fk_compliance_bc_evaluations_79c69633" ON "compliance_bc_evaluations"("snapshot_id","organization_id");
CREATE INDEX "idx_fk_compliance_bc_evaluations_ee9d6a88" ON "compliance_bc_evaluations"("supersedes_evaluation_id","organization_id");
CREATE INDEX "idx_fk_compliance_bc_format_mappings_196cca7b" ON "compliance_bc_format_mappings"("template_document_id","organization_id");
CREATE INDEX "idx_fk_compliance_bc_format_mappings_863a48d3" ON "compliance_bc_format_mappings"("organization_id","updated_by_id");
CREATE INDEX "idx_fk_compliance_bc_format_mappings_8d2d1ca1" ON "compliance_bc_format_mappings"("organization_id","created_by_id");
CREATE INDEX "idx_fk_compliance_bc_results_e26f1eb5" ON "compliance_bc_results"("subject_compareciente_id","organization_id");
CREATE INDEX "idx_fk_compliance_bc_structure_snapshots_4ebf07ec" ON "compliance_bc_structure_snapshots"("structure_id","organization_id");
CREATE INDEX "idx_fk_compliance_bc_structure_snapshots_d4b02396" ON "compliance_bc_structure_snapshots"("organization_id","captured_by_id");
CREATE INDEX "idx_fk_compliance_bc_structure_snapshots_f8e5680a" ON "compliance_bc_structure_snapshots"("expediente_acto_id","organization_id");
CREATE INDEX "idx_fk_expediente_society_targets_4ca2676c" ON "expediente_society_targets"("expediente_acto_id","organization_id");
CREATE INDEX "idx_fk_expediente_society_targets_9186dcc4" ON "expediente_society_targets"("persona_moral_id","organization_id");
CREATE INDEX "idx_fk_expediente_society_targets_a1ab134d" ON "expediente_society_targets"("organization_id","created_by_id");
CREATE INDEX "idx_fk_persona_moral_control_facts_02a34d12" ON "persona_moral_control_facts"("organization_id","confirmed_by_id");
CREATE INDEX "idx_fk_persona_moral_control_facts_9796eab2" ON "persona_moral_control_facts"("subject_node_id","organization_id");
CREATE INDEX "idx_fk_persona_moral_ownership_edges_9d3d2550" ON "persona_moral_ownership_edges"("organization_id","confirmed_by_id");
CREATE INDEX "idx_fk_persona_moral_ownership_structures_b744060a" ON "persona_moral_ownership_structures"("organization_id","created_by_id");
CREATE INDEX "idx_fk_persona_moral_ownership_structures_eb3928fb" ON "persona_moral_ownership_structures"("organization_id","updated_by_id");
CREATE INDEX "idx_fk_persona_moral_structure_reconciliations_10111c06" ON "persona_moral_structure_reconciliations"("organization_id","decided_by_id");
CREATE INDEX "idx_fk_persona_moral_structure_reconciliations_5d1176a8" ON "persona_moral_structure_reconciliations"("linked_persona_moral_id","organization_id");

COMMIT;
