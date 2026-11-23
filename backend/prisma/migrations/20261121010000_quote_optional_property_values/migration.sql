-- Additive client update 3. Unknown historical values remain NULL.
-- These are operation/property reference data, never payments or budget lines.
ALTER TABLE "cotizaciones"
  ADD COLUMN "valor_operacion" DECIMAL(18,2),
  ADD COLUMN "valor_catastral" DECIMAL(18,2),
  ADD COLUMN "cuenta_predial" VARCHAR(180),
  ADD COLUMN "importe_predial" DECIMAL(18,2),
  ADD CONSTRAINT "ck_cotizaciones_property_values_nonnegative" CHECK (
    ("valor_operacion" IS NULL OR "valor_operacion" >= 0) AND
    ("valor_catastral" IS NULL OR "valor_catastral" >= 0) AND
    ("importe_predial" IS NULL OR "importe_predial" >= 0)
  );
