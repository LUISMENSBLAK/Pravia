CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TYPE "CotizacionConceptoOrigen" ADD VALUE IF NOT EXISTS 'IA_PROPUESTA';

CREATE TABLE "knowledge_sources" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "inventory_code" VARCHAR(80) NOT NULL,
  "title" VARCHAR(500) NOT NULL,
  "jurisdiction" VARCHAR(80) NOT NULL,
  "authority" VARCHAR(240),
  "category" VARCHAR(120) NOT NULL,
  "source_url" TEXT,
  "applicability" TEXT,
  "priority" VARCHAR(12),
  "ingestion_status" VARCHAR(40) NOT NULL DEFAULT 'INVENTARIADA',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_sources_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "knowledge_sources_creator_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uq_knowledge_source_org_code" ON "knowledge_sources"("organization_id", "inventory_code");
CREATE UNIQUE INDEX "uq_knowledge_source_id_org" ON "knowledge_sources"("id", "organization_id");
CREATE INDEX "idx_knowledge_source_filters" ON "knowledge_sources"("organization_id", "jurisdiction", "category", "active");
CREATE INDEX "idx_knowledge_source_title_trgm" ON "knowledge_sources" USING GIN ("title" gin_trgm_ops);

CREATE TABLE "knowledge_source_versions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "label" VARCHAR(160) NOT NULL,
  "effective_from" DATE,
  "effective_to" DATE,
  "verification_status" VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE',
  "content_text" TEXT,
  "checksum_sha256" VARCHAR(64),
  "provenance" JSONB NOT NULL,
  "created_by_id" UUID NOT NULL,
  "verified_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verified_at" TIMESTAMP(3),
  CONSTRAINT "knowledge_source_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_versions_source_tenant_fkey" FOREIGN KEY ("source_id", "organization_id") REFERENCES "knowledge_sources"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "knowledge_versions_creator_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "knowledge_versions_verifier_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "knowledge_versions_dates_check" CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "knowledge_versions_status_check" CHECK ("verification_status" IN ('PENDIENTE','VERIFICADA','RECHAZADA','SUPERADA'))
);
CREATE UNIQUE INDEX "uq_knowledge_source_version" ON "knowledge_source_versions"("source_id", "version");
CREATE UNIQUE INDEX "uq_knowledge_version_id_org" ON "knowledge_source_versions"("id", "organization_id");
CREATE INDEX "idx_knowledge_version_verified" ON "knowledge_source_versions"("organization_id", "verification_status", "effective_from");
CREATE INDEX "idx_knowledge_version_fts" ON "knowledge_source_versions" USING GIN (to_tsvector('spanish', coalesce("content_text", '')));

CREATE TABLE "knowledge_articles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "version_id" UUID NOT NULL,
  "article_key" VARCHAR(160) NOT NULL, "heading" VARCHAR(500) NOT NULL, "body" TEXT NOT NULL, "ordinal" INTEGER NOT NULL,
  "metadata" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_articles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_articles_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "knowledge_articles_version_tenant_fkey" FOREIGN KEY ("version_id", "organization_id") REFERENCES "knowledge_source_versions"("id", "organization_id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "uq_knowledge_article_version_key" ON "knowledge_articles"("version_id", "article_key");
CREATE INDEX "idx_knowledge_article_version_order" ON "knowledge_articles"("organization_id", "version_id", "ordinal");
CREATE INDEX "idx_knowledge_article_body_fts" ON "knowledge_articles" USING GIN (to_tsvector('spanish', coalesce("body", '')));

CREATE TABLE "knowledge_criteria" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "title" VARCHAR(300) NOT NULL,
  "content" TEXT NOT NULL,
  "scope" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "knowledge_criteria_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_criteria_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "knowledge_criteria_creator_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uq_knowledge_criterion_org_code" ON "knowledge_criteria"("organization_id", "code");
CREATE INDEX "idx_knowledge_criterion_active" ON "knowledge_criteria"("organization_id", "active");
CREATE INDEX "idx_knowledge_criterion_fts" ON "knowledge_criteria" USING GIN (to_tsvector('spanish', coalesce("title", '') || ' ' || coalesce("content", '')));

CREATE TABLE "cotizacion_ia_proposals" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "cotizacion_id" UUID NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
  "proposal" JSONB NOT NULL,
  "evidence_packet" JSONB NOT NULL,
  "model_version" VARCHAR(120) NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "decided_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TIMESTAMP(3),
  CONSTRAINT "cotizacion_ia_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quote_ai_proposals_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "quote_ai_proposals_quote_tenant_fkey" FOREIGN KEY ("cotizacion_id", "organization_id") REFERENCES "cotizaciones"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "quote_ai_proposals_creator_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "quote_ai_proposals_decider_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "quote_ai_proposals_status_check" CHECK ("status" IN ('PENDIENTE','APLICADA','DESCARTADA','SUPERADA'))
);
CREATE UNIQUE INDEX "uq_quote_ai_proposal_idempotency" ON "cotizacion_ia_proposals"("organization_id", "cotizacion_id", "idempotency_key");
CREATE INDEX "idx_quote_ai_proposal_quote" ON "cotizacion_ia_proposals"("organization_id", "cotizacion_id", "status", "created_at");

CREATE TABLE "project_fact_snapshots" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "project_document_id" UUID NOT NULL,
  "project_version" INTEGER NOT NULL,
  "facts" JSONB NOT NULL,
  "conflicts" JSONB NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_fact_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_fact_snapshots_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "project_fact_snapshots_case_tenant_fkey" FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "expedientes"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "project_fact_snapshots_document_fkey" FOREIGN KEY ("project_document_id") REFERENCES "documentos"("id") ON DELETE RESTRICT,
  CONSTRAINT "project_fact_snapshots_creator_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uq_project_fact_snapshot_document" ON "project_fact_snapshots"("organization_id", "expediente_id", "project_document_id");
CREATE INDEX "idx_project_fact_snapshot_version" ON "project_fact_snapshots"("organization_id", "expediente_id", "project_version");

CREATE TABLE "project_instruction_applications" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "source_project_document_id" UUID NOT NULL,
  "result_project_document_id" UUID NOT NULL,
  "instructions" TEXT NOT NULL,
  "patches" JSONB NOT NULL,
  "diff" JSONB NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_instruction_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_instruction_apps_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "project_instruction_apps_case_tenant_fkey" FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "expedientes"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "project_instruction_apps_source_document_fkey" FOREIGN KEY ("source_project_document_id") REFERENCES "documentos"("id") ON DELETE RESTRICT,
  CONSTRAINT "project_instruction_apps_result_document_fkey" FOREIGN KEY ("result_project_document_id") REFERENCES "documentos"("id") ON DELETE RESTRICT,
  CONSTRAINT "project_instruction_apps_creator_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uq_project_instruction_app_idempotency" ON "project_instruction_applications"("organization_id", "expediente_id", "idempotency_key");
CREATE INDEX "idx_project_instruction_app_history" ON "project_instruction_applications"("organization_id", "expediente_id", "created_at");

CREATE TABLE "fiscal_reference_revisions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "reference_type" VARCHAR(80) NOT NULL,
  "code" VARCHAR(120) NOT NULL,
  "version" INTEGER NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "value" JSONB NOT NULL,
  "source_title" VARCHAR(500) NOT NULL,
  "source_url" TEXT NOT NULL,
  "verification_status" VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE',
  "created_by_id" UUID NOT NULL,
  "verified_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verified_at" TIMESTAMP(3),
  CONSTRAINT "fiscal_reference_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiscal_reference_revisions_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "fiscal_reference_revisions_creator_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "fiscal_reference_revisions_verifier_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "fiscal_reference_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "fiscal_reference_status_check" CHECK ("verification_status" IN ('PENDIENTE','VERIFICADA','RECHAZADA','SUPERADA'))
);
CREATE UNIQUE INDEX "uq_fiscal_reference_revision" ON "fiscal_reference_revisions"("organization_id", "reference_type", "code", "version");
CREATE INDEX "idx_fiscal_reference_effective" ON "fiscal_reference_revisions"("organization_id", "reference_type", "code", "effective_from");

CREATE TABLE "fiscal_export_profiles" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "name" VARCHAR(240) NOT NULL,
  "target" VARCHAR(80) NOT NULL,
  "version" INTEGER NOT NULL,
  "definition" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_export_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiscal_export_profiles_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "fiscal_export_profiles_creator_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uq_fiscal_export_profile_version" ON "fiscal_export_profiles"("organization_id", "code", "version");
CREATE INDEX "idx_fiscal_export_profile_active" ON "fiscal_export_profiles"("organization_id", "target", "active");
