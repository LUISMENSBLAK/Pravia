ALTER TABLE "compareciente_documentos"
  ADD COLUMN "source_expediente_documento_id" UUID;

ALTER TABLE "expediente_documentos"
  ADD CONSTRAINT "uq_exp_documentos_id_tenant" UNIQUE ("id", "organization_id");

ALTER TABLE "compareciente_documentos"
  ADD CONSTRAINT "comp_documentos_source_exp_documento_fkey"
  FOREIGN KEY ("source_expediente_documento_id", "organization_id")
  REFERENCES "expediente_documentos"("id", "organization_id") ON DELETE RESTRICT;

CREATE INDEX "idx_comp_documentos_source_exp_documento"
  ON "compareciente_documentos"("source_expediente_documento_id");
