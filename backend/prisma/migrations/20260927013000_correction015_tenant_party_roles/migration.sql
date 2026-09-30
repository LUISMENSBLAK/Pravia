-- Correction 015: preserve canonical global roles while allowing each Notaría
-- to register reusable roles without exposing them to another tenant.
ALTER TABLE "pravia_os"."caracteres_compareciente"
  ADD COLUMN "organization_id" UUID;

CREATE INDEX "idx_caracteres_compareciente_tenant_active"
  ON "pravia_os"."caracteres_compareciente"("organization_id", "activo");

ALTER TABLE "pravia_os"."caracteres_compareciente"
  ADD CONSTRAINT "caracteres_compareciente_organization_fkey"
  FOREIGN KEY ("organization_id")
  REFERENCES "pravia_os"."organizations"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
