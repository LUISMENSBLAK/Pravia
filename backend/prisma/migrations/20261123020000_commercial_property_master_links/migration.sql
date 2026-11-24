-- Additive only: no historical tax references, amounts, folios or documents are rewritten.
ALTER TABLE "prospectos" ADD COLUMN "predio_principal_id" UUID;
ALTER TABLE "cotizaciones" ADD COLUMN "predio_principal_id" UUID,
  ADD COLUMN "valor_avaluo" DECIMAL(18,2);
ALTER TABLE "cotizaciones" ADD CONSTRAINT "ck_quote_appraisal_nonnegative"
  CHECK ("valor_avaluo" IS NULL OR "valor_avaluo" >= 0);
ALTER TABLE "prospectos" ADD CONSTRAINT "ck_prospect_property_requires_tenant"
  CHECK ("predio_principal_id" IS NULL OR "organization_id" IS NOT NULL);
ALTER TABLE "cotizaciones" ADD CONSTRAINT "ck_quote_property_requires_tenant"
  CHECK ("predio_principal_id" IS NULL OR "organization_id" IS NOT NULL);
ALTER TABLE "prospectos" ADD CONSTRAINT "fk_prospecto_predio_principal_tenant"
  FOREIGN KEY ("predio_principal_id", "organization_id") REFERENCES "predios"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "cotizaciones" ADD CONSTRAINT "fk_cotizacion_predio_principal_tenant"
  FOREIGN KEY ("predio_principal_id", "organization_id") REFERENCES "predios"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "idx_prospecto_predio_principal" ON "prospectos"("predio_principal_id", "organization_id");
CREATE INDEX "idx_cotizacion_predio_principal" ON "cotizaciones"("predio_principal_id", "organization_id");
