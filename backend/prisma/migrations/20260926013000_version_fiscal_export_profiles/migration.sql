-- Preserve legacy profiles as pending until their authority, source and
-- effective period are explicitly verified. No historical value is invented.
ALTER TABLE "fiscal_export_profiles"
  ADD COLUMN "authority" VARCHAR(240),
  ADD COLUMN "valid_from" DATE,
  ADD COLUMN "valid_to" DATE,
  ADD COLUMN "serialization" JSONB,
  ADD COLUMN "validation_rules" JSONB,
  ADD COLUMN "source_title" VARCHAR(500),
  ADD COLUMN "source_url" TEXT,
  ADD COLUMN "verification_status" VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE';

CREATE INDEX "idx_fiscal_export_profile_effective"
  ON "fiscal_export_profiles"("organization_id", "target", "valid_from", "valid_to");
