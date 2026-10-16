-- CFDI drafts can reserve a portion of one canonical EXP-008 income without
-- creating a second financial movement or an independent receivable.
ALTER TABLE "pravia_os"."expediente_ingresos_reportados"
  ADD CONSTRAINT "uq_exp008_ingreso_cfdi_scope"
  UNIQUE ("id", "organization_id", "expediente_id");

ALTER TABLE "pravia_os"."documentos_cfdi"
  ADD COLUMN "ingreso_reportado_id" UUID;

CREATE INDEX "idx_documentos_cfdi_ingreso"
  ON "pravia_os"."documentos_cfdi" ("ingreso_reportado_id", "organization_id", "expediente_id");

ALTER TABLE "pravia_os"."documentos_cfdi"
  ADD CONSTRAINT "cfdi_documento_ingreso_fkey"
  FOREIGN KEY ("ingreso_reportado_id", "organization_id", "expediente_id")
  REFERENCES "pravia_os"."expediente_ingresos_reportados" ("id", "organization_id", "expediente_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
