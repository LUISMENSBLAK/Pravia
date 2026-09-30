-- Foreign-key support indexes for the Projection, Knowledge, COT-IA and ISR additions.
-- These do not alter data or referential semantics; they keep deletes, updates and
-- tenant-scoped relationship checks from degrading into full table scans.

CREATE INDEX IF NOT EXISTS "quote_ai_proposals_created_by_idx"
  ON "pravia_os"."cotizacion_ia_proposals" ("created_by_id");

CREATE INDEX IF NOT EXISTS "quote_ai_proposals_decided_by_idx"
  ON "pravia_os"."cotizacion_ia_proposals" ("decided_by_id");

CREATE INDEX IF NOT EXISTS "fiscal_export_profiles_created_by_idx"
  ON "pravia_os"."fiscal_export_profiles" ("created_by_id");

CREATE INDEX IF NOT EXISTS "fiscal_reference_revisions_created_by_idx"
  ON "pravia_os"."fiscal_reference_revisions" ("created_by_id");

CREATE INDEX IF NOT EXISTS "fiscal_reference_revisions_verified_by_idx"
  ON "pravia_os"."fiscal_reference_revisions" ("verified_by_id");

CREATE INDEX IF NOT EXISTS "knowledge_criteria_created_by_idx"
  ON "pravia_os"."knowledge_criteria" ("created_by_id");

CREATE INDEX IF NOT EXISTS "knowledge_versions_created_by_idx"
  ON "pravia_os"."knowledge_source_versions" ("created_by_id");

CREATE INDEX IF NOT EXISTS "knowledge_versions_source_tenant_idx"
  ON "pravia_os"."knowledge_source_versions" ("source_id", "organization_id");

CREATE INDEX IF NOT EXISTS "knowledge_versions_verified_by_idx"
  ON "pravia_os"."knowledge_source_versions" ("verified_by_id");

CREATE INDEX IF NOT EXISTS "knowledge_sources_created_by_idx"
  ON "pravia_os"."knowledge_sources" ("created_by_id");

CREATE INDEX IF NOT EXISTS "project_fact_snapshots_created_by_idx"
  ON "pravia_os"."project_fact_snapshots" ("created_by_id");

CREATE INDEX IF NOT EXISTS "project_instruction_apps_created_by_idx"
  ON "pravia_os"."project_instruction_applications" ("created_by_id");

CREATE INDEX IF NOT EXISTS "project_instruction_apps_result_document_idx"
  ON "pravia_os"."project_instruction_applications" ("result_project_document_id");

CREATE INDEX IF NOT EXISTS "project_instruction_apps_source_document_idx"
  ON "pravia_os"."project_instruction_applications" ("source_project_document_id");
