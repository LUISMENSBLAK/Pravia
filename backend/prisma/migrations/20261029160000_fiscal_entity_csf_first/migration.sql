-- La CSF original permanece en documentos privados; esta relación sólo apunta
-- a la versión actual. Los documentos anteriores no se borran al sustituirla.
ALTER TABLE "pravia_os"."entidades_fiscales_cfdi"
  ADD COLUMN "regimenes_fiscales" JSONB,
  ADD COLUMN "csf_documento_id" UUID,
  ADD COLUMN "csf_extraction" JSONB;

ALTER TABLE "pravia_os"."entidades_fiscales_cfdi"
  ADD CONSTRAINT "cfdi_entidad_csf_documento_fkey"
  FOREIGN KEY ("csf_documento_id", "organization_id")
  REFERENCES "pravia_os"."documentos"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE INDEX "idx_cfdi_entidad_csf_documento"
  ON "pravia_os"."entidades_fiscales_cfdi"("organization_id", "csf_documento_id");
