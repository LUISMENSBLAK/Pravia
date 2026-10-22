ALTER TABLE "migration_provenance"
  ADD COLUMN "source_row" INTEGER;

ALTER TABLE "migration_provenance"
  ADD CONSTRAINT "migration_provenance_source_row_positive"
  CHECK ("source_row" IS NULL OR "source_row" > 0);

CREATE INDEX "idx_migration_provenance_source_row"
  ON "migration_provenance" ("organization_id", "migration_job_id", "source_file", "source_row");

COMMENT ON COLUMN "migration_provenance"."source_row" IS
  'One-based data-row position in the source file. Historical rows remain NULL rather than receiving an invented position.';
