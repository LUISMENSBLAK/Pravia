-- Expand only. Historical notarias and their references remain intact until
-- every organization's institutional source has been reviewed explicitly.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "notary_number" TEXT,
  ADD COLUMN IF NOT EXISTS "notary_holder" TEXT,
  ADD COLUMN IF NOT EXISTS "state" TEXT,
  ADD COLUMN IF NOT EXISTS "municipality" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "postal_code" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "logo_storage_key" TEXT,
  ADD COLUMN IF NOT EXISTS "institutional_header" TEXT;

-- Backfill only when there is exactly one active, non-archived legacy notary
-- explicitly owned by this Organization. Never pick an arbitrary row from a
-- multi-notary tenant or a global historical notary. Legacy rows/FKs survive.
UPDATE "organizations" AS organization
SET
  "notary_number" = COALESCE(organization."notary_number", legacy."numero_notaria"),
  "notary_holder" = COALESCE(organization."notary_holder", legacy."notario_titular"),
  "address" = COALESCE(organization."address", legacy."direccion"),
  "postal_code" = COALESCE(organization."postal_code", legacy."codigo_postal"),
  "phone" = COALESCE(organization."phone", legacy."telefono"),
  "email" = COALESCE(organization."email", legacy."correo_general")
FROM "notarias" AS legacy
WHERE legacy."organization_id" = organization."id"
  AND legacy."activa" = TRUE
  AND legacy."archived_at" IS NULL
  AND (
    SELECT COUNT(*)
    FROM "notarias" AS candidate
    WHERE candidate."organization_id" = organization."id"
      AND candidate."activa" = TRUE
      AND candidate."archived_at" IS NULL
  ) = 1;

-- estado/municipio are intentionally not copied here: the old Notaria fields
-- carry defaults that may not have been explicitly confirmed by the tenant.
