-- Keep all historical folio values untouched. New reservations are scoped by
-- organization and year; the composite indexes are the physical collision gate.
CREATE TABLE "pravia_os"."folio_counters" (
  "organization_id" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "series" VARCHAR(32) NOT NULL,
  "year" INTEGER NOT NULL,
  "last_value" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "folio_counters_pkey" PRIMARY KEY ("organization_id", "kind", "series", "year"),
  CONSTRAINT "folio_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

DROP INDEX IF EXISTS "pravia_os"."prospectos_folio_key";
DROP INDEX IF EXISTS "pravia_os"."cotizaciones_numero_cotizacion_key";
DROP INDEX IF EXISTS "pravia_os"."expedientes_numero_pravia_key";

CREATE UNIQUE INDEX "uq_prospecto_org_folio" ON "pravia_os"."prospectos"("organization_id", "folio");
CREATE UNIQUE INDEX "uq_cotizacion_org_folio" ON "pravia_os"."cotizaciones"("organization_id", "numero_cotizacion");
CREATE UNIQUE INDEX "uq_expediente_org_folio" ON "pravia_os"."expedientes"("organization_id", "numero_pravia");
