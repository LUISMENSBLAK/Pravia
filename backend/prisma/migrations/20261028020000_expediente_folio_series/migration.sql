-- COL46: organization-scoped configuration for new EXP series only.
-- Existing folios/counters are not rewritten or renumbered.
CREATE TABLE "pravia_os"."expediente_folio_series" (
  "organization_id" UUID NOT NULL,
  "code" VARCHAR(16) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID NOT NULL,
  CONSTRAINT "expediente_folio_series_pkey" PRIMARY KEY ("organization_id", "code"),
  CONSTRAINT "expediente_folio_series_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "expediente_folio_series_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9]{1,15}$' AND "code" <> 'EXP')
);
