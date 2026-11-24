-- Explicit operational recipient choice, not a CFDI or an automatic generic RFC.
ALTER TABLE "expediente_ingresos_reportados"
  ADD COLUMN "facturar_publico_general" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "expediente_ingresos_reportados"
  ADD CONSTRAINT "ck_exp008_public_recipient_exclusive"
  CHECK (NOT "facturar_publico_general" OR
    ("facturar_a_vinculo_id" IS NULL AND "facturar_a_compareciente_id" IS NULL));
