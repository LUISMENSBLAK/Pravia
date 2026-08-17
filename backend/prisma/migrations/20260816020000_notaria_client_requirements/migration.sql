-- Additive Notarías model improvements. Legacy free-text fields remain untouched.
ALTER TABLE "notarias"
  ADD COLUMN "horario_semanal" JSONB,
  ADD COLUMN "dias_presupuesto_estimados" INTEGER,
  ADD COLUMN "dias_firma_estimados" INTEGER,
  ADD COLUMN "contacto_principal_id" UUID;

-- Cargo remains available, but only the contact name is mandatory in the approved UX.
ALTER TABLE "notaria_contactos"
  ALTER COLUMN "cargo" DROP NOT NULL;

CREATE INDEX "idx_notarias_contacto_principal_fk"
  ON "notarias"("contacto_principal_id");

ALTER TABLE "notarias"
  ADD CONSTRAINT "notarias_contacto_principal_id_fkey"
  FOREIGN KEY ("contacto_principal_id")
  REFERENCES "notaria_contactos"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "notarias"
  ADD CONSTRAINT "notarias_dias_presupuesto_estimados_check"
  CHECK ("dias_presupuesto_estimados" IS NULL OR "dias_presupuesto_estimados" BETWEEN 1 AND 365) NOT VALID,
  ADD CONSTRAINT "notarias_dias_firma_estimados_check"
  CHECK ("dias_firma_estimados" IS NULL OR "dias_firma_estimados" BETWEEN 1 AND 365) NOT VALID,
  ADD CONSTRAINT "notarias_dias_respuesta_estimados_check"
  CHECK ("dias_respuesta_estimados" BETWEEN 1 AND 365) NOT VALID;
