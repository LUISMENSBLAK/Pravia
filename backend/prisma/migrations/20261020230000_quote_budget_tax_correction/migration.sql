-- Expand-only budget correction. Historical IVA rows and issued quote versions
-- remain untouched; the application distinguishes derived new rows by origin.
ALTER TYPE "pravia_os"."PresupuestoConceptoCategoria" ADD VALUE IF NOT EXISTS 'OTRO_GASTO';
ALTER TYPE "pravia_os"."CotizacionConceptoOrigen" ADD VALUE IF NOT EXISTS 'DERIVADO';

CREATE TYPE "pravia_os"."PresupuestoTratamientoIva" AS ENUM (
  'SIN_IMPUESTO', 'GRAVADO', 'EXENTO', 'NO_OBJETO', 'REQUIERE_REVISION'
);

ALTER TABLE "pravia_os"."cotizacion_conceptos"
  ADD COLUMN "tratamiento_iva" "pravia_os"."PresupuestoTratamientoIva",
  ADD COLUMN "iva_tasa" DECIMAL(9,6),
  ADD COLUMN "regla_fiscal_fuente" VARCHAR(240),
  ADD COLUMN "regla_fiscal_version" VARCHAR(80);

ALTER TABLE "pravia_os"."cotizacion_version_conceptos"
  ADD COLUMN "tratamiento_iva" "pravia_os"."PresupuestoTratamientoIva",
  ADD COLUMN "iva_tasa" DECIMAL(9,6),
  ADD COLUMN "regla_fiscal_fuente" VARCHAR(240),
  ADD COLUMN "regla_fiscal_version" VARCHAR(80);

ALTER TABLE "pravia_os"."expediente_presupuesto_conceptos"
  ADD COLUMN "tratamiento_iva" "pravia_os"."PresupuestoTratamientoIva",
  ADD COLUMN "iva_tasa" DECIMAL(9,6),
  ADD COLUMN "regla_fiscal_fuente" VARCHAR(240),
  ADD COLUMN "regla_fiscal_version" VARCHAR(80);

-- Constraints for future writes; NULL is deliberately accepted for legacy.
ALTER TABLE "pravia_os"."cotizacion_conceptos"
  ADD CONSTRAINT "ck_quote_other_tax_rate" CHECK (("tratamiento_iva" = 'GRAVADO' AND "iva_tasa" > 0 AND "iva_tasa" <= 1) OR ("tratamiento_iva" IS DISTINCT FROM 'GRAVADO' AND "iva_tasa" IS NULL));
ALTER TABLE "pravia_os"."cotizacion_version_conceptos"
  ADD CONSTRAINT "ck_quote_version_other_tax_rate" CHECK (("tratamiento_iva" = 'GRAVADO' AND "iva_tasa" > 0 AND "iva_tasa" <= 1) OR ("tratamiento_iva" IS DISTINCT FROM 'GRAVADO' AND "iva_tasa" IS NULL));
ALTER TABLE "pravia_os"."expediente_presupuesto_conceptos"
  ADD CONSTRAINT "ck_case_budget_other_tax_rate" CHECK (("tratamiento_iva" = 'GRAVADO' AND "iva_tasa" > 0 AND "iva_tasa" <= 1) OR ("tratamiento_iva" IS DISTINCT FROM 'GRAVADO' AND "iva_tasa" IS NULL));
