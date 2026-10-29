CREATE TABLE "pravia_os"."entidad_fiscal_csf_versiones" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "entidad_fiscal_id" UUID NOT NULL,
  "documento_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "extraction" JSONB NOT NULL,
  "confirmed_by_id" UUID NOT NULL,
  "confirmed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "entidad_fiscal_csf_versiones_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "pravia_os"."entidad_fiscal_csf_versiones"
  ADD CONSTRAINT "cfdi_csf_version_entidad_fkey"
    FOREIGN KEY ("entidad_fiscal_id", "organization_id")
    REFERENCES "pravia_os"."entidades_fiscales_cfdi"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "cfdi_csf_version_documento_fkey"
    FOREIGN KEY ("documento_id", "organization_id")
    REFERENCES "pravia_os"."documentos"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "cfdi_csf_version_actor_fkey"
    FOREIGN KEY ("organization_id", "confirmed_by_id")
    REFERENCES "pravia_os"."organization_memberships"("organization_id", "user_id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE UNIQUE INDEX "uq_cfdi_csf_version_number" ON "pravia_os"."entidad_fiscal_csf_versiones"("organization_id", "entidad_fiscal_id", "version");
CREATE UNIQUE INDEX "uq_cfdi_csf_version_document" ON "pravia_os"."entidad_fiscal_csf_versiones"("documento_id", "organization_id");
CREATE INDEX "idx_cfdi_csf_version_history" ON "pravia_os"."entidad_fiscal_csf_versiones"("organization_id", "entidad_fiscal_id", "confirmed_at");

-- La primera CSF de entidades creadas antes de esta ampliación queda como v1.
-- No modifica ni elimina el documento original ni el dato fiscal confirmado.
INSERT INTO "pravia_os"."entidad_fiscal_csf_versiones"
  ("organization_id", "entidad_fiscal_id", "documento_id", "version", "extraction", "confirmed_by_id", "confirmed_at")
SELECT e."organization_id", e."id", e."csf_documento_id", 1,
       COALESCE(e."csf_extraction", '{}'::jsonb), e."created_by_id", e."created_at"
FROM "pravia_os"."entidades_fiscales_cfdi" e
WHERE e."csf_documento_id" IS NOT NULL;
