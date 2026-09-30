CREATE TABLE "postal_code_catalog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "postal_code" VARCHAR(5) NOT NULL,
  "settlement" VARCHAR(240) NOT NULL,
  "settlement_type" VARCHAR(120),
  "municipality" VARCHAR(240) NOT NULL,
  "state" VARCHAR(160) NOT NULL,
  "city" VARCHAR(240),
  "state_code" VARCHAR(10),
  "municipality_code" VARCHAR(20),
  "settlement_code" VARCHAR(20),
  "zone" VARCHAR(80),
  "source_version" VARCHAR(80) NOT NULL,
  "source_updated_at" DATE NOT NULL,
  "source_url" TEXT NOT NULL,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "postal_code_catalog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_postal_code_catalog_code" CHECK ("postal_code" ~ '^[0-9]{5}$')
);

CREATE UNIQUE INDEX "uq_postal_code_catalog_revision"
  ON "postal_code_catalog"("postal_code", "settlement", "municipality", "state", "source_version");
CREATE INDEX "idx_postal_code_catalog_code"
  ON "postal_code_catalog"("postal_code", "source_version");
CREATE INDEX "idx_postal_code_catalog_location"
  ON "postal_code_catalog"("state", "municipality", "settlement");
