DROP INDEX "uq_postal_code_catalog_revision";

ALTER TABLE "postal_code_catalog"
  ALTER COLUMN "state_code" SET NOT NULL,
  ALTER COLUMN "municipality_code" SET NOT NULL,
  ALTER COLUMN "settlement_code" SET NOT NULL,
  ADD COLUMN "office_code" VARCHAR(20),
  ADD COLUMN "administration_cp" VARCHAR(10),
  ADD COLUMN "settlement_type_code" VARCHAR(20),
  ADD COLUMN "city_code" VARCHAR(20);

CREATE UNIQUE INDEX "uq_postal_code_catalog_revision"
  ON "postal_code_catalog"("postal_code", "state_code", "municipality_code", "settlement_code", "source_version");
