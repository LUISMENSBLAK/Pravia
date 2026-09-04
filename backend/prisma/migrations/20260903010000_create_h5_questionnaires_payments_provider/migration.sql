-- H5 · CUM-CUE-001 + CUM-PAG-001 + Proveedor de Recursos.
-- Mechanisms only: no productive legal/configured content is seeded.
BEGIN;
SET LOCAL search_path TO pravia_os, public;

-- CreateEnum
CREATE TYPE "ComplianceLegalRuleKind" AS ENUM ('ACTIVITY', 'PAYMENT_RESTRICTION', 'PROVIDER_IDENTIFICATION');

-- CreateEnum
CREATE TYPE "ComplianceRuleOutcomePurpose" AS ENUM ('ACTIVITY_APPLICABILITY', 'NOTICE_OBLIGATION', 'PAYMENT_RESTRICTION', 'PROVIDER_IDENTIFICATION');

-- CreateEnum
CREATE TYPE "ComplianceRuleContextKind" AS ENUM ('ACT', 'PAYMENT', 'PAYMENT_PARTY');

-- CreateEnum
CREATE TYPE "ComplianceQuestionnaireScope" AS ENUM ('GENERAL', 'PERSONAL');

-- CreateEnum
CREATE TYPE "ComplianceQuestionnaireRevisionStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateEnum
CREATE TYPE "ComplianceQuestionnaireCompleteness" AS ENUM ('INCOMPLETE', 'COMPLETE');

-- CreateEnum
CREATE TYPE "ComplianceQuestionnaireEvaluationStatus" AS ENUM ('PENDING', 'EVALUATED', 'NOT_CONFIGURED', 'CONFIGURATION_ERROR');

-- CreateEnum
CREATE TYPE "ComplianceMethodologyScope" AS ENUM ('GENERAL', 'PERSONAL');

-- CreateEnum
CREATE TYPE "ComplianceMethodologyRevisionStatus" AS ENUM ('DRAFT', 'VERIFIED', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "CompliancePaymentRevisionStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "CompliancePaymentScope" AS ENUM ('GENERAL_INSTRUMENT', 'EXPLICIT_ACT_SET');

-- CreateEnum
CREATE TYPE "CompliancePaymentPartyRole" AS ENUM ('PAYER', 'PAYEE', 'PROVIDER_RESOURCE');

-- CreateEnum
CREATE TYPE "CompliancePaymentFieldState" AS ENUM ('VALUE', 'CONFIRMED_UNKNOWN');

-- CreateEnum
CREATE TYPE "CompliancePaymentVerificationStatus" AS ENUM ('MATCH', 'OBSERVATION', 'REVIEW_REQUIRED', 'NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "ComplianceProposalFieldState" AS ENUM ('PRESENT', 'ABSENT', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "CatalogoArtefactoPurpose" AS ENUM ('CUE_GENERAL', 'CUE_PERSONAL');

-- CreateEnum
CREATE TYPE "CatalogoArtefactoContentKind" AS ENUM ('FILE', 'STRUCTURED_QUESTIONNAIRE');

-- AlterTable
ALTER TABLE "catalogo_artefactos" ADD COLUMN     "purpose" "CatalogoArtefactoPurpose";

-- AlterTable
ALTER TABLE "catalogo_artefacto_versiones" ADD COLUMN     "content_kind" "CatalogoArtefactoContentKind" NOT NULL DEFAULT 'FILE',
ADD COLUMN     "definition_checksum" VARCHAR(64),
ADD COLUMN     "definition_json" JSONB,
ADD COLUMN     "schema_version" INTEGER,
ALTER COLUMN "nombre_original" DROP NOT NULL,
ALTER COLUMN "storage_key" DROP NOT NULL,
ALTER COLUMN "mime_type" DROP NOT NULL,
ALTER COLUMN "size_bytes" DROP NOT NULL,
ALTER COLUMN "checksum_sha256" DROP NOT NULL;

-- The historical migration declared es_proveedor_recursos, while canonical
-- empty-database baselines created before H5 may legitimately lack it. Keep the
-- additive column idempotent so both histories converge without reclassifying data.
-- AlterTable
ALTER TABLE "expediente_comparecientes" ADD COLUMN IF NOT EXISTS "es_proveedor_recursos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "provider_migrated_relation_id" UUID,
ADD COLUMN     "provider_migration_status" VARCHAR(40);

-- AlterTable
ALTER TABLE "compliance_payments" ADD COLUMN     "h5_canonical_payment_id" UUID,
ADD COLUMN     "h5_migration_status" VARCHAR(40);

-- AlterTable
ALTER TABLE "compliance_legal_rules" ADD COLUMN     "kind" "ComplianceLegalRuleKind" NOT NULL DEFAULT 'ACTIVITY';

-- AlterTable
ALTER TABLE "compliance_rule_results" ADD COLUMN     "context_key" VARCHAR(240) NOT NULL DEFAULT 'ACT',
ADD COLUMN     "context_kind" "ComplianceRuleContextKind" NOT NULL DEFAULT 'ACT',
ADD COLUMN     "outcome_purpose" "ComplianceRuleOutcomePurpose" NOT NULL DEFAULT 'ACTIVITY_APPLICABILITY',
ADD COLUMN     "payment_revision_id" UUID,
ADD COLUMN     "subject_compareciente_id" UUID;

-- AlterTable
ALTER TABLE "compliance_ai_proposals" ADD COLUMN     "base_fingerprint" VARCHAR(64),
ADD COLUMN     "base_payment_revision_id" UUID,
ADD COLUMN     "expediente_id" UUID,
ADD COLUMN     "field_provenance" JSONB,
ADD COLUMN     "payment_id" UUID,
ADD COLUMN     "proposal_fingerprint" VARCHAR(64),
ADD COLUMN     "h5_operation_id" VARCHAR(160),
ADD COLUMN     "source_document_checksum" VARCHAR(128),
ADD COLUMN     "source_document_version" VARCHAR(128),
ADD COLUMN     "source_documents" JSONB,
ADD COLUMN     "source_pages" JSONB;

CREATE UNIQUE INDEX "h5_ai_proposals_tenant_operation_key"
  ON "compliance_ai_proposals"("organization_id", "h5_operation_id");

-- CreateTable
CREATE TABLE "compliance_questionnaire_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "expediente_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "requirement_id" UUID NOT NULL,
    "scope" "ComplianceQuestionnaireScope" NOT NULL,
    "identity_key" VARCHAR(220) NOT NULL,
    "target_compareciente_id" UUID,
    "definition_version_id" UUID NOT NULL,
    "current_revision_id" UUID,
    "trigger_snapshot" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_questionnaire_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_questionnaire_assessment_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "status" "ComplianceQuestionnaireRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "answers" JSONB NOT NULL,
    "definition_version_id" UUID NOT NULL,
    "definition_checksum" VARCHAR(64) NOT NULL,
    "completeness" "ComplianceQuestionnaireCompleteness" NOT NULL DEFAULT 'INCOMPLETE',
    "missing_question_ids" JSONB NOT NULL,
    "methodology_revision_id" UUID,
    "evaluation_status" "ComplianceQuestionnaireEvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "evaluation_snapshot" JSONB,
    "semantic_fingerprint" VARCHAR(64) NOT NULL,
    "base_revision_id" UUID,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "finalized_by_id" UUID,
    "finalized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_questionnaire_assessment_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_risk_methodologies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "stable_key" VARCHAR(160) NOT NULL,
    "scope" "ComplianceMethodologyScope" NOT NULL,
    "name" VARCHAR(240) NOT NULL,
    "current_revision_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_risk_methodologies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_risk_methodology_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "methodology_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "status" "ComplianceMethodologyRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "compatible_definition_version_id" UUID NOT NULL,
    "taxonomy" JSONB NOT NULL,
    "factor_dsl" JSONB NOT NULL,
    "output_mapping" JSONB NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "provenance" JSONB NOT NULL,
    "supersedes_revision_id" UUID,
    "created_by_id" UUID NOT NULL,
    "verified_by_id" UUID,
    "activated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),

    CONSTRAINT "compliance_risk_methodology_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_operation_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "expediente_id" UUID NOT NULL,
    "current_revision_id" UUID,
    "legacy_payment_id" UUID,
    "legacy_classification" VARCHAR(40),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_operation_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_operation_payment_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "expediente_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "requirement_id" UUID,
    "revision_number" INTEGER NOT NULL,
    "status" "CompliancePaymentRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "scope" "CompliancePaymentScope" NOT NULL,
    "amount_original" DECIMAL(20,6),
    "currency_original" VARCHAR(3),
    "payment_date" TIMESTAMP(3),
    "method_raw" TEXT,
    "method_code" TEXT,
    "method_label_snapshot" TEXT,
    "institution" TEXT,
    "reference" TEXT,
    "account_last4" VARCHAR(4),
    "account_fingerprint" VARCHAR(64),
    "payer_raw" TEXT,
    "payee_raw" TEXT,
    "exchange_rate" DECIMAL(24,12),
    "exchange_rate_date" TIMESTAMP(3),
    "exchange_rate_source" TEXT,
    "exchange_rate_criterion" TEXT,
    "equivalent_mxn" DECIMAL(20,6),
    "declared_paid" DECIMAL(20,6),
    "declared_pending" DECIMAL(20,6),
    "field_states" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'HUMAN_CONFIRMED',
    "semantic_fingerprint" VARCHAR(64) NOT NULL,
    "base_revision_id" UUID,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "change_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "confirmed_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "compliance_operation_payment_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_operation_payment_acts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "payment_revision_id" UUID NOT NULL,
    "expediente_id" UUID NOT NULL,
    "expediente_acto_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_operation_payment_acts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_operation_payment_parties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "payment_revision_id" UUID NOT NULL,
    "expediente_id" UUID NOT NULL,
    "expediente_compareciente_id" UUID NOT NULL,
    "compareciente_id" UUID NOT NULL,
    "role" "CompliancePaymentPartyRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_operation_payment_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_operation_payment_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "payment_revision_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "relation_kind" VARCHAR(40) NOT NULL DEFAULT 'RECEIPT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_operation_payment_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_operation_payment_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "payment_revision_id" UUID NOT NULL,
    "project_document_id" UUID NOT NULL,
    "project_document_version" VARCHAR(128) NOT NULL,
    "project_document_checksum" VARCHAR(128) NOT NULL,
    "consideration_amount" DECIMAL(20,6),
    "consideration_currency" VARCHAR(3),
    "instrument_paid" DECIMAL(20,6),
    "instrument_pending" DECIMAL(20,6),
    "comparison_snapshot" JSONB NOT NULL,
    "status" "CompliancePaymentVerificationStatus" NOT NULL,
    "semantic_fingerprint" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "confirmed_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "compliance_operation_payment_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_operation_payment_verification_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "verification_id" UUID NOT NULL,
    "rule_result_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_operation_payment_verification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_h5_questionnaire_assessment_review" ON "compliance_questionnaire_assessments"("organization_id", "expediente_id", "review_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_questionnaire_assessment_identity_key" ON "compliance_questionnaire_assessments"("organization_id", "review_id", "identity_key");

-- CreateIndex
CREATE UNIQUE INDEX "h5_questionnaire_assessment_current_key" ON "compliance_questionnaire_assessments"("current_revision_id", "organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_questionnaire_assessment_id_tenant_key" ON "compliance_questionnaire_assessments"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_h5_questionnaire_revision_status" ON "compliance_questionnaire_assessment_revisions"("organization_id", "assessment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "h5_questionnaire_revision_number_key" ON "compliance_questionnaire_assessment_revisions"("organization_id", "assessment_id", "revision_number");

-- CreateIndex
CREATE UNIQUE INDEX "h5_questionnaire_revision_idempotency_key" ON "compliance_questionnaire_assessment_revisions"("organization_id", "assessment_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "h5_questionnaire_revision_id_tenant_key" ON "compliance_questionnaire_assessment_revisions"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_questionnaire_revision_lineage_key" ON "compliance_questionnaire_assessment_revisions"("id", "organization_id", "assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_risk_methodology_stable_key" ON "compliance_risk_methodologies"("organization_id", "stable_key");

-- CreateIndex
CREATE UNIQUE INDEX "h5_risk_methodology_current_key" ON "compliance_risk_methodologies"("current_revision_id", "organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_risk_methodology_id_tenant_key" ON "compliance_risk_methodologies"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_h5_risk_methodology_revision_selection" ON "compliance_risk_methodology_revisions"("organization_id", "status", "compatible_definition_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_risk_methodology_revision_number_key" ON "compliance_risk_methodology_revisions"("organization_id", "methodology_id", "revision_number");

-- CreateIndex
CREATE UNIQUE INDEX "h5_risk_methodology_revision_id_tenant_key" ON "compliance_risk_methodology_revisions"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_risk_methodology_revision_lineage_key" ON "compliance_risk_methodology_revisions"("id", "organization_id", "methodology_id");

-- CreateIndex
CREATE INDEX "idx_h5_operation_payment_case" ON "compliance_operation_payments"("organization_id", "expediente_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "h5_operation_payment_id_tenant_key" ON "compliance_operation_payments"("id", "organization_id");
CREATE UNIQUE INDEX "h5_operation_payment_case_key" ON "compliance_operation_payments"("id", "organization_id", "expediente_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_operation_payment_current_key" ON "compliance_operation_payments"("current_revision_id", "organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_operation_payment_legacy_key" ON "compliance_operation_payments"("organization_id", "legacy_payment_id");

-- CreateIndex
CREATE INDEX "idx_h5_operation_payment_revision_review" ON "compliance_operation_payment_revisions"("organization_id", "expediente_id", "review_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_operation_payment_revision_number_key" ON "compliance_operation_payment_revisions"("organization_id", "payment_id", "revision_number");

-- CreateIndex
CREATE UNIQUE INDEX "h5_operation_payment_revision_idempotency_key" ON "compliance_operation_payment_revisions"("organization_id", "payment_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "h5_operation_payment_revision_id_tenant_key" ON "compliance_operation_payment_revisions"("id", "organization_id");
CREATE UNIQUE INDEX "h5_operation_payment_revision_case_key" ON "compliance_operation_payment_revisions"("id", "organization_id", "expediente_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_operation_payment_revision_lineage_key" ON "compliance_operation_payment_revisions"("id", "organization_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_operation_payment_act_key" ON "compliance_operation_payment_acts"("organization_id", "payment_revision_id", "expediente_acto_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_operation_payment_act_id_tenant_key" ON "compliance_operation_payment_acts"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_operation_payment_party_key" ON "compliance_operation_payment_parties"("organization_id", "payment_revision_id", "role", "expediente_compareciente_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_operation_payment_party_id_tenant_key" ON "compliance_operation_payment_parties"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_operation_payment_evidence_key" ON "compliance_operation_payment_evidence"("organization_id", "payment_revision_id", "evidence_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_operation_payment_evidence_id_tenant_key" ON "compliance_operation_payment_evidence"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_payment_verification_idempotency_key" ON "compliance_operation_payment_verifications"("organization_id", "payment_revision_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "h5_payment_verification_fingerprint_key" ON "compliance_operation_payment_verifications"("organization_id", "payment_revision_id", "semantic_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "h5_payment_verification_id_tenant_key" ON "compliance_operation_payment_verifications"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_payment_verification_rule_key" ON "compliance_operation_payment_verification_rules"("organization_id", "verification_id", "rule_result_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_payment_verification_rule_id_tenant_key" ON "compliance_operation_payment_verification_rules"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalogo_artefacto_version_id_tenant_key" ON "catalogo_artefacto_versiones"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_expediente_actos_lineage_key" ON "expediente_actos"("id", "organization_id", "expediente_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_expediente_compareciente_lineage_key" ON "expediente_comparecientes"("id", "organization_id", "expediente_id", "compareciente_id");

-- CreateIndex
CREATE UNIQUE INDEX "h5_compliance_evidence_id_tenant_key" ON "compliance_evidence"("id", "organization_id");

-- CreateIndex
-- AddForeignKey
ALTER TABLE "compliance_payments" ADD CONSTRAINT "h5_legacy_payment_canonical_fkey" FOREIGN KEY ("h5_canonical_payment_id", "organization_id") REFERENCES "compliance_operation_payments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_rule_results" ADD CONSTRAINT "h5_rule_result_payment_revision_fkey" FOREIGN KEY ("payment_revision_id", "organization_id") REFERENCES "compliance_operation_payment_revisions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_rule_results" ADD CONSTRAINT "h5_rule_result_subject_fkey" FOREIGN KEY ("subject_compareciente_id", "organization_id") REFERENCES "comparecientes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_ai_proposals" ADD CONSTRAINT "h5_ai_payment_fkey" FOREIGN KEY ("payment_id", "organization_id") REFERENCES "compliance_operation_payments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_ai_proposals" ADD CONSTRAINT "h5_ai_payment_revision_fkey" FOREIGN KEY ("base_payment_revision_id", "organization_id") REFERENCES "compliance_operation_payment_revisions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessments" ADD CONSTRAINT "h5_questionnaire_assessment_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessments" ADD CONSTRAINT "h5_questionnaire_assessment_case_fkey" FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "expedientes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessments" ADD CONSTRAINT "h5_questionnaire_assessment_review_fkey" FOREIGN KEY ("review_id", "organization_id", "expediente_id") REFERENCES "compliance_reviews"("id", "organization_id", "expediente_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessments" ADD CONSTRAINT "h5_questionnaire_assessment_requirement_fkey" FOREIGN KEY ("requirement_id", "organization_id") REFERENCES "compliance_requirements"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessments" ADD CONSTRAINT "h5_questionnaire_assessment_target_fkey" FOREIGN KEY ("target_compareciente_id", "organization_id") REFERENCES "comparecientes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessments" ADD CONSTRAINT "h5_questionnaire_assessment_definition_fkey" FOREIGN KEY ("definition_version_id", "organization_id") REFERENCES "catalogo_artefacto_versiones"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessments" ADD CONSTRAINT "h5_questionnaire_assessment_creator_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessments" ADD CONSTRAINT "h5_questionnaire_assessment_current_fkey" FOREIGN KEY ("current_revision_id", "organization_id", "id") REFERENCES "compliance_questionnaire_assessment_revisions"("id", "organization_id", "assessment_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessment_revisions" ADD CONSTRAINT "h5_questionnaire_revision_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessment_revisions" ADD CONSTRAINT "h5_questionnaire_revision_assessment_fkey" FOREIGN KEY ("assessment_id", "organization_id") REFERENCES "compliance_questionnaire_assessments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessment_revisions" ADD CONSTRAINT "h5_questionnaire_revision_definition_fkey" FOREIGN KEY ("definition_version_id", "organization_id") REFERENCES "catalogo_artefacto_versiones"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessment_revisions" ADD CONSTRAINT "h5_questionnaire_revision_methodology_fkey" FOREIGN KEY ("methodology_revision_id", "organization_id") REFERENCES "compliance_risk_methodology_revisions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessment_revisions" ADD CONSTRAINT "h5_questionnaire_revision_creator_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessment_revisions" ADD CONSTRAINT "h5_questionnaire_revision_finalizer_fkey" FOREIGN KEY ("organization_id", "finalized_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_questionnaire_assessment_revisions" ADD CONSTRAINT "h5_questionnaire_revision_base_fkey" FOREIGN KEY ("base_revision_id", "organization_id", "assessment_id") REFERENCES "compliance_questionnaire_assessment_revisions"("id", "organization_id", "assessment_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_risk_methodologies" ADD CONSTRAINT "h5_risk_methodology_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_risk_methodologies" ADD CONSTRAINT "h5_risk_methodology_creator_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_risk_methodologies" ADD CONSTRAINT "h5_risk_methodology_current_fkey" FOREIGN KEY ("current_revision_id", "organization_id", "id") REFERENCES "compliance_risk_methodology_revisions"("id", "organization_id", "methodology_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_risk_methodology_revisions" ADD CONSTRAINT "h5_risk_methodology_revision_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_risk_methodology_revisions" ADD CONSTRAINT "h5_risk_methodology_revision_parent_fkey" FOREIGN KEY ("methodology_id", "organization_id") REFERENCES "compliance_risk_methodologies"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_risk_methodology_revisions" ADD CONSTRAINT "h5_risk_methodology_definition_fkey" FOREIGN KEY ("compatible_definition_version_id", "organization_id") REFERENCES "catalogo_artefacto_versiones"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_risk_methodology_revisions" ADD CONSTRAINT "h5_risk_methodology_revision_creator_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_risk_methodology_revisions" ADD CONSTRAINT "h5_risk_methodology_revision_verifier_fkey" FOREIGN KEY ("organization_id", "verified_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_risk_methodology_revisions" ADD CONSTRAINT "h5_risk_methodology_revision_activator_fkey" FOREIGN KEY ("organization_id", "activated_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_risk_methodology_revisions" ADD CONSTRAINT "h5_risk_methodology_revision_supersedes_fkey" FOREIGN KEY ("supersedes_revision_id", "organization_id", "methodology_id") REFERENCES "compliance_risk_methodology_revisions"("id", "organization_id", "methodology_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payments" ADD CONSTRAINT "h5_operation_payment_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payments" ADD CONSTRAINT "h5_operation_payment_case_fkey" FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "expedientes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payments" ADD CONSTRAINT "h5_operation_payment_creator_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payments" ADD CONSTRAINT "h5_operation_payment_current_fkey" FOREIGN KEY ("current_revision_id", "organization_id", "id") REFERENCES "compliance_operation_payment_revisions"("id", "organization_id", "payment_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_revisions" ADD CONSTRAINT "h5_operation_payment_revision_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_revisions" ADD CONSTRAINT "h5_operation_payment_revision_payment_fkey" FOREIGN KEY ("payment_id", "organization_id", "expediente_id") REFERENCES "compliance_operation_payments"("id", "organization_id", "expediente_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_revisions" ADD CONSTRAINT "h5_operation_payment_revision_review_fkey" FOREIGN KEY ("review_id", "organization_id", "expediente_id") REFERENCES "compliance_reviews"("id", "organization_id", "expediente_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_revisions" ADD CONSTRAINT "h5_operation_payment_revision_requirement_fkey" FOREIGN KEY ("requirement_id", "organization_id") REFERENCES "compliance_requirements"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_revisions" ADD CONSTRAINT "h5_operation_payment_revision_creator_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_revisions" ADD CONSTRAINT "h5_operation_payment_revision_confirmer_fkey" FOREIGN KEY ("organization_id", "confirmed_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_revisions" ADD CONSTRAINT "h5_operation_payment_revision_base_fkey" FOREIGN KEY ("base_revision_id", "organization_id", "payment_id") REFERENCES "compliance_operation_payment_revisions"("id", "organization_id", "payment_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_acts" ADD CONSTRAINT "h5_operation_payment_act_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_acts" ADD CONSTRAINT "h5_operation_payment_act_revision_fkey" FOREIGN KEY ("payment_revision_id", "organization_id", "expediente_id") REFERENCES "compliance_operation_payment_revisions"("id", "organization_id", "expediente_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_acts" ADD CONSTRAINT "h5_operation_payment_act_case_act_fkey" FOREIGN KEY ("expediente_acto_id", "organization_id", "expediente_id") REFERENCES "expediente_actos"("id", "organization_id", "expediente_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_parties" ADD CONSTRAINT "h5_operation_payment_party_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_parties" ADD CONSTRAINT "h5_operation_payment_party_revision_fkey" FOREIGN KEY ("payment_revision_id", "organization_id", "expediente_id") REFERENCES "compliance_operation_payment_revisions"("id", "organization_id", "expediente_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_parties" ADD CONSTRAINT "h5_operation_payment_party_case_party_fkey" FOREIGN KEY ("expediente_compareciente_id", "organization_id", "expediente_id", "compareciente_id") REFERENCES "expediente_comparecientes"("id", "organization_id", "expediente_id", "compareciente_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_parties" ADD CONSTRAINT "h5_operation_payment_party_person_fkey" FOREIGN KEY ("compareciente_id", "organization_id") REFERENCES "comparecientes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_evidence" ADD CONSTRAINT "h5_operation_payment_evidence_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_evidence" ADD CONSTRAINT "h5_operation_payment_evidence_revision_fkey" FOREIGN KEY ("payment_revision_id", "organization_id") REFERENCES "compliance_operation_payment_revisions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_evidence" ADD CONSTRAINT "h5_operation_payment_evidence_evidence_fkey" FOREIGN KEY ("evidence_id", "organization_id") REFERENCES "compliance_evidence"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_verifications" ADD CONSTRAINT "h5_payment_verification_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_verifications" ADD CONSTRAINT "h5_payment_verification_revision_fkey" FOREIGN KEY ("payment_revision_id", "organization_id") REFERENCES "compliance_operation_payment_revisions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_verifications" ADD CONSTRAINT "h5_payment_verification_document_fkey" FOREIGN KEY ("project_document_id", "organization_id") REFERENCES "documentos"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_verifications" ADD CONSTRAINT "h5_payment_verification_creator_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_verifications" ADD CONSTRAINT "h5_payment_verification_confirmer_fkey" FOREIGN KEY ("organization_id", "confirmed_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_verification_rules" ADD CONSTRAINT "h5_payment_verification_rule_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_verification_rules" ADD CONSTRAINT "h5_payment_verification_rule_verification_fkey" FOREIGN KEY ("verification_id", "organization_id") REFERENCES "compliance_operation_payment_verifications"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_operation_payment_verification_rules" ADD CONSTRAINT "h5_payment_verification_rule_result_fkey" FOREIGN KEY ("rule_result_id", "organization_id") REFERENCES "compliance_rule_results"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Canonical left-prefix coverage for every H5 foreign key not already covered by
-- an identity/current-query index. These names match db:init-empty remediation.
CREATE INDEX "idx_fk_compliance_ai_proposals_0d06ea20" ON "compliance_ai_proposals" ("payment_id", "organization_id");
CREATE INDEX "idx_fk_compliance_ai_proposals_f3d1ff2d" ON "compliance_ai_proposals" ("base_payment_revision_id", "organization_id");
CREATE INDEX "idx_fk_compliance_payments_8b06bffe" ON "compliance_payments" ("h5_canonical_payment_id", "organization_id");
CREATE INDEX "idx_fk_compliance_rule_results_c6223f2b" ON "compliance_rule_results" ("payment_revision_id", "organization_id");
CREATE INDEX "idx_fk_compliance_rule_results_2039f05d" ON "compliance_rule_results" ("subject_compareciente_id", "organization_id");
CREATE INDEX "idx_fk_compliance_operation_payment_acts_8d48414c" ON "compliance_operation_payment_acts" ("expediente_acto_id", "organization_id", "expediente_id");
CREATE INDEX "idx_fk_compliance_operation_payment_acts_1b283a07" ON "compliance_operation_payment_acts" ("payment_revision_id", "organization_id", "expediente_id");
CREATE INDEX "idx_fk_compliance_operation_payment_parties_30df8e7a" ON "compliance_operation_payment_parties" ("payment_revision_id", "organization_id", "expediente_id");
CREATE INDEX "idx_fk_compliance_operation_payment_revisions_0914aca1" ON "compliance_operation_payment_revisions" ("payment_id", "organization_id", "expediente_id");
CREATE INDEX "idx_fk_compliance_operation_payment_parties_c01fb722" ON "compliance_operation_payment_parties" ("expediente_compareciente_id", "organization_id", "expediente_id");
CREATE INDEX "idx_fk_compliance_operation_payment_parties_79c7a209" ON "compliance_operation_payment_parties" ("compareciente_id", "organization_id");
CREATE INDEX "idx_fk_compliance_operation_payment_revisions_9eb3e5af" ON "compliance_operation_payment_revisions" ("base_revision_id", "organization_id", "payment_id");
CREATE INDEX "idx_fk_compliance_operation_payment_revisions_11b5427d" ON "compliance_operation_payment_revisions" ("organization_id", "confirmed_by_id");
CREATE INDEX "idx_fk_compliance_operation_payment_revisions_c339afd3" ON "compliance_operation_payment_revisions" ("organization_id", "created_by_id");
CREATE INDEX "idx_fk_compliance_operation_payment_revisions_f024beaa" ON "compliance_operation_payment_revisions" ("requirement_id", "organization_id");
CREATE INDEX "idx_fk_compliance_operation_payment_verifications_815c05c9" ON "compliance_operation_payment_verifications" ("organization_id", "confirmed_by_id");
CREATE INDEX "idx_fk_compliance_operation_payment_verifications_79450341" ON "compliance_operation_payment_verifications" ("organization_id", "created_by_id");
CREATE INDEX "idx_fk_compliance_operation_payment_verifications_167d8dac" ON "compliance_operation_payment_verifications" ("project_document_id", "organization_id");
CREATE INDEX "idx_fk_compliance_operation_payments_60805ae7" ON "compliance_operation_payments" ("organization_id", "created_by_id");
CREATE INDEX "idx_fk_compliance_questionnaire_assessment_revisions_c43dd3f9" ON "compliance_questionnaire_assessment_revisions" ("base_revision_id", "organization_id", "assessment_id");
CREATE INDEX "idx_fk_compliance_questionnaire_assessment_revisions_4a0599d0" ON "compliance_questionnaire_assessment_revisions" ("organization_id", "created_by_id");
CREATE INDEX "idx_fk_compliance_questionnaire_assessment_revisions_957ec322" ON "compliance_questionnaire_assessment_revisions" ("definition_version_id", "organization_id");
CREATE INDEX "idx_fk_compliance_questionnaire_assessment_revisions_af782201" ON "compliance_questionnaire_assessment_revisions" ("organization_id", "finalized_by_id");
CREATE INDEX "idx_fk_compliance_questionnaire_assessment_revisions_5865a9f4" ON "compliance_questionnaire_assessment_revisions" ("methodology_revision_id", "organization_id");
CREATE INDEX "idx_fk_compliance_questionnaire_assessments_235aea5b" ON "compliance_questionnaire_assessments" ("organization_id", "created_by_id");
CREATE INDEX "idx_fk_compliance_questionnaire_assessments_0360e36f" ON "compliance_questionnaire_assessments" ("definition_version_id", "organization_id");
CREATE INDEX "idx_fk_compliance_questionnaire_assessments_66335aa3" ON "compliance_questionnaire_assessments" ("requirement_id", "organization_id");
CREATE INDEX "idx_fk_compliance_questionnaire_assessments_979aaecb" ON "compliance_questionnaire_assessments" ("target_compareciente_id", "organization_id");
CREATE INDEX "idx_fk_compliance_risk_methodologies_b8754055" ON "compliance_risk_methodologies" ("organization_id", "created_by_id");
CREATE INDEX "idx_fk_compliance_risk_methodology_revisions_a262bb91" ON "compliance_risk_methodology_revisions" ("organization_id", "activated_by_id");
CREATE INDEX "idx_fk_compliance_risk_methodology_revisions_33defe95" ON "compliance_risk_methodology_revisions" ("organization_id", "created_by_id");
CREATE INDEX "idx_fk_compliance_risk_methodology_revisions_1cb95ccc" ON "compliance_risk_methodology_revisions" ("supersedes_revision_id", "organization_id", "methodology_id");
CREATE INDEX "idx_fk_compliance_risk_methodology_revisions_fd137f57" ON "compliance_risk_methodology_revisions" ("organization_id", "verified_by_id");

-- Frozen physical invariants.
ALTER TABLE "catalogo_artefacto_versiones"
  ADD CONSTRAINT "h5_catalog_content_shape_check" CHECK (
    ("content_kind" = 'FILE' AND "nombre_original" IS NOT NULL AND "storage_key" IS NOT NULL
      AND "mime_type" IS NOT NULL AND "size_bytes" IS NOT NULL
      AND "checksum_sha256" IS NOT NULL AND "definition_json" IS NULL)
    OR
    ("content_kind" = 'STRUCTURED_QUESTIONNAIRE' AND "definition_json" IS NOT NULL
      AND "definition_checksum" IS NOT NULL AND "schema_version" IS NOT NULL
      AND "storage_key" IS NULL)
  );

ALTER TABLE "compliance_questionnaire_assessments"
  ADD CONSTRAINT "h5_questionnaire_scope_target_check" CHECK (
    ("scope" = 'GENERAL' AND "target_compareciente_id" IS NULL AND "identity_key" = 'GENERAL')
    OR
    ("scope" = 'PERSONAL' AND "target_compareciente_id" IS NOT NULL
      AND "identity_key" = 'PERSONAL:' || "target_compareciente_id"::text)
  );

ALTER TABLE "compliance_questionnaire_assessment_revisions"
  ADD CONSTRAINT "h5_questionnaire_finalized_shape_check" CHECK (
    ("status" = 'DRAFT' AND "finalized_at" IS NULL AND "finalized_by_id" IS NULL)
    OR
    ("status" = 'FINALIZED' AND "completeness" = 'COMPLETE'
      AND "evaluation_status" = 'EVALUATED' AND "methodology_revision_id" IS NOT NULL
      AND "finalized_at" IS NOT NULL AND "finalized_by_id" IS NOT NULL)
  );

ALTER TABLE "compliance_operation_payment_revisions"
  ADD CONSTRAINT "h5_payment_currency_shape_check" CHECK (
    ("amount_original" IS NULL AND "currency_original" IS NULL)
    OR ("amount_original" >= 0 AND "currency_original" ~ '^[A-Z]{3}$')
  ),
  ADD CONSTRAINT "h5_payment_fx_shape_check" CHECK (
    "equivalent_mxn" IS NULL OR
    ("currency_original" = 'MXN' AND "amount_original" IS NOT NULL AND "equivalent_mxn" = "amount_original") OR
    ("exchange_rate" IS NOT NULL AND "exchange_rate" > 0
      AND "exchange_rate_date" IS NOT NULL AND "exchange_rate_source" IS NOT NULL
      AND "exchange_rate_criterion" IS NOT NULL)
  ),
  ADD CONSTRAINT "h5_payment_account_last4_check" CHECK (
    "account_last4" IS NULL OR "account_last4" ~ '^[0-9]{4}$'
  ),
  ADD CONSTRAINT "h5_payment_confirmed_shape_check" CHECK (
    ("status" = 'DRAFT' AND "confirmed_at" IS NULL AND "confirmed_by_id" IS NULL)
    OR ("status" = 'CONFIRMED' AND "confirmed_at" IS NOT NULL AND "confirmed_by_id" IS NOT NULL)
  );

CREATE UNIQUE INDEX "h5_active_methodology_definition_key"
  ON "compliance_risk_methodology_revisions"("organization_id", "compatible_definition_version_id")
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "h5_rule_results_context_identity_key"
  ON "compliance_rule_results"(
    "organization_id", "review_id", "rule_revision_id",
    COALESCE("expediente_acto_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "outcome_purpose", "context_kind", "context_key"
  );

CREATE OR REPLACE FUNCTION h5_guard_finalized_questionnaire_revision()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'H5_FINALIZED_QUESTIONNAIRE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER h5_questionnaire_revision_immutable
  BEFORE UPDATE OR DELETE ON "compliance_questionnaire_assessment_revisions"
  FOR EACH ROW EXECUTE FUNCTION h5_guard_finalized_questionnaire_revision();

CREATE OR REPLACE FUNCTION h5_guard_confirmed_payment_revision()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'H5_CONFIRMED_PAYMENT_REVISION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER h5_payment_revision_immutable
  BEFORE UPDATE OR DELETE ON "compliance_operation_payment_revisions"
  FOR EACH ROW EXECUTE FUNCTION h5_guard_confirmed_payment_revision();

CREATE OR REPLACE FUNCTION pravia_os.h5_validate_payment_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  revision_id pg_catalog.uuid;
  revision_scope pravia_os."CompliancePaymentScope";
  act_count pg_catalog.int4;
BEGIN
  IF TG_TABLE_NAME = 'compliance_operation_payment_revisions' THEN
    revision_id := COALESCE(NEW.id, OLD.id);
  ELSE
    revision_id := COALESCE(NEW.payment_revision_id, OLD.payment_revision_id);
  END IF;
  SELECT scope INTO revision_scope
    FROM pravia_os.compliance_operation_payment_revisions WHERE id = revision_id;
  SELECT pg_catalog.count(*) INTO act_count
    FROM pravia_os.compliance_operation_payment_acts WHERE payment_revision_id = revision_id;
  IF revision_scope = 'GENERAL_INSTRUMENT' AND act_count <> 0 THEN
    RAISE EXCEPTION 'H5_GENERAL_PAYMENT_CANNOT_HAVE_ACTS';
  END IF;
  IF revision_scope = 'EXPLICIT_ACT_SET' AND act_count = 0 THEN
    RAISE EXCEPTION 'H5_EXPLICIT_PAYMENT_REQUIRES_ACT';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER h5_payment_revision_scope_guard
  AFTER INSERT OR UPDATE OF scope ON pravia_os.compliance_operation_payment_revisions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pravia_os.h5_validate_payment_scope();
CREATE CONSTRAINT TRIGGER h5_payment_act_scope_guard
  AFTER INSERT OR UPDATE OR DELETE ON pravia_os.compliance_operation_payment_acts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pravia_os.h5_validate_payment_scope();

-- Approved technical role capability only. No legal applicability mapping is seeded.
INSERT INTO "caracteres_compareciente"
  ("id", "clave", "nombre", "descripcion", "activo", "created_at")
VALUES
  (gen_random_uuid(), 'PROVEEDOR_RECURSOS', 'Proveedor de Recursos',
   'Capacidad técnica para identificar a quien aporta recursos cuando una regla verificada lo exige.',
   true, CURRENT_TIMESTAMP)
ON CONFLICT ("clave") DO NOTHING;

-- Classify every legacy payment. Only rows with complete tenant, review, case and
-- actor lineage become canonical H5 payment revisions.
UPDATE "compliance_payments"
SET "h5_migration_status" = 'PRESERVED_AMBIGUOUS'
WHERE "h5_migration_status" IS NULL;

WITH deterministic AS (
  SELECT cp.*, r.expediente_id
  FROM "compliance_payments" cp
  JOIN "compliance_reviews" r
    ON r.id = cp.review_id AND r.organization_id = cp.organization_id
  JOIN "expedientes" e
    ON e.id = r.expediente_id AND e.organization_id = cp.organization_id
  JOIN "organization_memberships" m
    ON m.organization_id = cp.organization_id AND m.user_id = cp.created_by_id
  WHERE cp.organization_id IS NOT NULL AND cp.retired_at IS NULL
), inserted_payments AS (
  INSERT INTO "compliance_operation_payments"
    ("id", "organization_id", "expediente_id", "legacy_payment_id",
     "legacy_classification", "created_by_id", "created_at", "updated_at")
  SELECT md5('h5-payment:' || id::text)::uuid, organization_id, expediente_id, id,
         'MIGRATED_CANONICAL', created_by_id, created_at, created_at
  FROM deterministic
  ON CONFLICT ("organization_id", "legacy_payment_id") DO NOTHING
  RETURNING id
)
INSERT INTO "compliance_operation_payment_revisions"
  ("id", "organization_id", "payment_id", "expediente_id", "review_id",
   "revision_number", "status", "scope", "amount_original", "currency_original",
   "payment_date", "method_raw", "institution", "reference", "account_last4",
   "field_states", "source", "semantic_fingerprint", "idempotency_key",
   "created_by_id", "confirmed_by_id", "created_at", "confirmed_at")
SELECT md5('h5-payment-revision:' || d.id::text)::uuid,
       d.organization_id,
       md5('h5-payment:' || d.id::text)::uuid,
       d.expediente_id,
       d.review_id,
       1,
       'CONFIRMED',
       'GENERAL_INSTRUMENT',
       d.amount_mxn,
       'MXN',
       d.payment_date,
       d.method,
       d.institution,
       d.reference,
       NULLIF(right(regexp_replace(COALESCE(d.masked_account, ''), '[^0-9]', '', 'g'), 4), ''),
       jsonb_build_object(
         'amount', 'VALUE', 'currency', 'VALUE', 'date', 'VALUE',
         'method', CASE WHEN nullif(btrim(d.method), '') IS NULL
                       THEN 'CONFIRMED_UNKNOWN' ELSE 'VALUE' END
       ),
       'LEGACY',
       encode(digest(concat_ws('|', d.id::text, d.amount_mxn::text,
         d.payment_date::text, COALESCE(d.method, '')), 'sha256'), 'hex'),
       'LEGACY:' || d.id::text,
       d.created_by_id,
       d.created_by_id,
       d.created_at,
       d.created_at
FROM deterministic d
ON CONFLICT ("organization_id", "payment_id", "revision_number") DO NOTHING;

UPDATE "compliance_operation_payments" p
SET "current_revision_id" = r.id
FROM "compliance_operation_payment_revisions" r
WHERE r.payment_id = p.id
  AND r.organization_id = p.organization_id
  AND r.revision_number = 1;

UPDATE "compliance_payments" cp
SET "h5_migration_status" = 'MIGRATED_CANONICAL',
    "h5_canonical_payment_id" = p.id
FROM "compliance_operation_payments" p
WHERE p.legacy_payment_id = cp.id
  AND p.organization_id = cp.organization_id;

-- Reuse exact H2 evidence only when the document is physically scoped to the
-- same tenant and expediente. Unresolvable evidence remains on the legacy row.
WITH eligible AS (
  SELECT cp.*, r.expediente_id, d.checksum_sha256, d.storage_key
  FROM "compliance_payments" cp
  JOIN "compliance_reviews" r
    ON r.id = cp.review_id AND r.organization_id = cp.organization_id
  JOIN "documentos" d
    ON d.id = cp.evidence_document_id
   AND d.organization_id = cp.organization_id
   AND d.expediente_id = r.expediente_id
  WHERE cp.h5_migration_status = 'MIGRATED_CANONICAL'
    AND cp.evidence_document_id IS NOT NULL
)
INSERT INTO "compliance_evidence"
  ("id", "organization_id", "review_id", "documento_id", "tipo_evidencia",
   "agregado_por_id", "estatus", "created_at", "expediente_id", "document_version",
   "document_checksum_snapshot", "storage_key_snapshot", "source", "document_state",
   "validation_status", "linked_by_system")
SELECT md5('h5-evidence:' || id::text)::uuid, organization_id, review_id,
       evidence_document_id, 'PAYMENT_RECEIPT_LEGACY', created_by_id, 'ACTIVO',
       created_at, expediente_id, 'LEGACY', checksum_sha256, storage_key,
       'EXPEDIENTE', 'CANONICAL', 'PENDING_HUMAN', true
FROM eligible
ON CONFLICT (id) DO NOTHING;

INSERT INTO "compliance_operation_payment_evidence"
  ("id", "organization_id", "payment_revision_id", "evidence_id", "relation_kind")
SELECT md5('h5-payment-evidence:' || cp.id::text)::uuid,
       cp.organization_id,
       md5('h5-payment-revision:' || cp.id::text)::uuid,
       md5('h5-evidence:' || cp.id::text)::uuid,
       'RECEIPT'
FROM "compliance_payments" cp
JOIN "compliance_evidence" ce ON ce.id = md5('h5-evidence:' || cp.id::text)::uuid
WHERE cp.h5_migration_status = 'MIGRATED_CANONICAL'
ON CONFLICT ("organization_id", "payment_revision_id", "evidence_id") DO NOTHING;

-- Classify every historic provider flag. An exact role is added only where its
-- tenant, expediente, compareciente and act context are deterministic.
UPDATE "expediente_comparecientes"
SET "provider_migration_status" = 'PRESERVED_AMBIGUOUS'
WHERE "es_proveedor_recursos" = true
  AND "provider_migration_status" IS NULL;

WITH role AS (
  SELECT id FROM "caracteres_compareciente" WHERE clave = 'PROVEEDOR_RECURSOS'
), single_acts AS (
  SELECT organization_id, expediente_id, min(id::text)::uuid AS id
  FROM "expediente_actos"
  WHERE estatus = 'ACTIVO' AND removed_at IS NULL
  GROUP BY organization_id, expediente_id
  HAVING count(*) = 1
), resolved AS (
  SELECT ec.*,
         COALESCE(ec.expediente_acto_id, sa.id) AS resolved_act_id,
         role.id AS provider_role_id
  FROM "expediente_comparecientes" ec
  CROSS JOIN role
  LEFT JOIN single_acts sa
    ON sa.organization_id = ec.organization_id
   AND sa.expediente_id = ec.expediente_id
  WHERE ec.es_proveedor_recursos = true
    AND ec.organization_id IS NOT NULL
    AND ec.archived_at IS NULL
    AND ec.estatus = 'ACTIVO'
    AND (ec.expediente_acto_id IS NOT NULL OR sa.id IS NOT NULL)
), inserted AS (
  INSERT INTO "expediente_comparecientes"
    ("id", "organization_id", "expediente_id", "expediente_acto_id",
     "compareciente_id", "caracter_id", "forma_comparecencia",
     "orden_comparecencia", "es_principal", "observaciones", "estatus",
     "creado_por_id", "created_at", "datos_validados", "idempotency_key")
  SELECT md5('h5-provider-role:' || r.id::text)::uuid,
         r.organization_id, r.expediente_id, r.resolved_act_id,
         r.compareciente_id, r.provider_role_id, r.forma_comparecencia,
         r.orden_comparecencia, false,
         'Migración técnica H5 desde indicador histórico; aplicabilidad jurídica no inferida.',
         'ACTIVO', r.creado_por_id, COALESCE(r.created_at, CURRENT_TIMESTAMP),
         r.datos_validados, 'H5-PROVIDER-LEGACY:' || r.id::text
  FROM resolved r
  WHERE r.caracter_id <> r.provider_role_id
  ON CONFLICT ("organization_id", "expediente_id", "idempotency_key") DO NOTHING
  RETURNING id
)
UPDATE "expediente_comparecientes" ec
SET "provider_migration_status" = 'MIGRATED_EXACT_ROLE',
    "provider_migrated_relation_id" = CASE
      WHEN ec.caracter_id = (SELECT id FROM role) THEN ec.id
      ELSE md5('h5-provider-role:' || ec.id::text)::uuid
    END
WHERE ec.id IN (SELECT id FROM resolved);

-- A confirmed revision's N:M links are part of its immutable semantic snapshot.
-- Initial inserts are permitted only in the transaction creating that revision.
CREATE OR REPLACE FUNCTION pravia_os.h5_guard_payment_revision_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  parent_id pg_catalog.uuid;
  parent_confirmed pg_catalog.bool;
  parent_xid pg_catalog.text;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.payment_revision_id ELSE NEW.payment_revision_id END;
  SELECT status = 'CONFIRMED', xmin::pg_catalog.text INTO parent_confirmed, parent_xid
    FROM pravia_os.compliance_operation_payment_revisions WHERE id = parent_id;
  IF parent_confirmed AND (TG_OP <> 'INSERT' OR parent_xid <> (pg_catalog.txid_current() % 4294967296)::pg_catalog.text) THEN
    RAISE EXCEPTION 'H5_CONFIRMED_PAYMENT_LINK_IMMUTABLE';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.payment_revision_id <> NEW.payment_revision_id AND EXISTS (
    SELECT 1 FROM pravia_os.compliance_operation_payment_revisions WHERE id = OLD.payment_revision_id AND status = 'CONFIRMED'
  ) THEN RAISE EXCEPTION 'H5_CONFIRMED_PAYMENT_LINK_IMMUTABLE'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER h5_payment_acts_immutable BEFORE INSERT OR UPDATE OR DELETE ON pravia_os.compliance_operation_payment_acts
  FOR EACH ROW EXECUTE FUNCTION pravia_os.h5_guard_payment_revision_link();
CREATE TRIGGER h5_payment_parties_immutable BEFORE INSERT OR UPDATE OR DELETE ON pravia_os.compliance_operation_payment_parties
  FOR EACH ROW EXECUTE FUNCTION pravia_os.h5_guard_payment_revision_link();
CREATE TRIGGER h5_payment_evidence_immutable BEFORE INSERT OR UPDATE OR DELETE ON pravia_os.compliance_operation_payment_evidence
  FOR EACH ROW EXECUTE FUNCTION pravia_os.h5_guard_payment_revision_link();

CREATE OR REPLACE FUNCTION h5_guard_risk_methodology_content()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'status' - 'retired_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'retired_at') THEN
    RAISE EXCEPTION 'H5_METHODOLOGY_CONTENT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER h5_methodology_content_immutable BEFORE UPDATE OR DELETE ON compliance_risk_methodology_revisions
  FOR EACH ROW EXECUTE FUNCTION h5_guard_risk_methodology_content();

CREATE OR REPLACE FUNCTION h5_guard_verification_history()
RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'H5_VERIFICATION_HISTORY_IMMUTABLE'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER h5_verification_immutable BEFORE UPDATE OR DELETE ON compliance_operation_payment_verifications
  FOR EACH ROW EXECUTE FUNCTION h5_guard_verification_history();
CREATE TRIGGER h5_verification_rules_immutable BEFORE UPDATE OR DELETE ON compliance_operation_payment_verification_rules
  FOR EACH ROW EXECUTE FUNCTION h5_guard_verification_history();

COMMIT;
