-- Optional, tenant-bound destination of a documentary folder. Historical folders remain unlinked.
ALTER TABLE "expediente_documento_carpetas"
  ADD COLUMN "linked_compareciente_id" UUID,
  ADD COLUMN "linked_predio_id" UUID;

ALTER TABLE "expediente_documento_carpetas"
  ADD CONSTRAINT "exp_document_folder_one_destination_ck"
  CHECK ("linked_compareciente_id" IS NULL OR "linked_predio_id" IS NULL),
  ADD CONSTRAINT "exp_document_folder_compareciente_tenant_fkey"
  FOREIGN KEY ("linked_compareciente_id", "organization_id")
  REFERENCES "comparecientes"("id", "organization_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "exp_document_folder_predio_tenant_fkey"
  FOREIGN KEY ("linked_predio_id", "organization_id")
  REFERENCES "predios"("id", "organization_id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "uq_exp_folder_active_compareciente_destination"
  ON "expediente_documento_carpetas"("organization_id", "expediente_id", "linked_compareciente_id")
  WHERE "archived_at" IS NULL AND "linked_compareciente_id" IS NOT NULL;

CREATE UNIQUE INDEX "uq_exp_folder_active_predio_destination"
  ON "expediente_documento_carpetas"("organization_id", "expediente_id", "linked_predio_id")
  WHERE "archived_at" IS NULL AND "linked_predio_id" IS NOT NULL;
