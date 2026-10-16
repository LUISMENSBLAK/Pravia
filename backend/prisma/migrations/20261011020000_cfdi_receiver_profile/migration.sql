-- Fiscal identity is explicitly reviewed before use in a draft; extraction
-- suggestions from a CSF do not update the compareciente automatically.
CREATE TABLE "pravia_os"."compareciente_fiscal_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "compareciente_id" UUID NOT NULL,
  "rfc" VARCHAR(13) NOT NULL,
  "razon_social" VARCHAR(300) NOT NULL,
  "regimen_fiscal" VARCHAR(8) NOT NULL,
  "codigo_postal" VARCHAR(5) NOT NULL,
  "csf_documento_id" UUID,
  "confirmed_by_id" UUID NOT NULL,
  "confirmed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "compareciente_fiscal_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_cfdi_profile_compareciente_org"
  ON "pravia_os"."compareciente_fiscal_profiles" ("compareciente_id", "organization_id");
CREATE INDEX "idx_cfdi_profile_org_rfc"
  ON "pravia_os"."compareciente_fiscal_profiles" ("organization_id", "rfc");

ALTER TABLE "pravia_os"."compareciente_fiscal_profiles"
  ADD CONSTRAINT "cfdi_profile_compareciente_fkey"
  FOREIGN KEY ("compareciente_id", "organization_id")
  REFERENCES "pravia_os"."comparecientes" ("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "pravia_os"."compareciente_fiscal_profiles"
  ADD CONSTRAINT "cfdi_profile_confirmer_fkey"
  FOREIGN KEY ("organization_id", "confirmed_by_id")
  REFERENCES "pravia_os"."organization_memberships" ("organization_id", "user_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
