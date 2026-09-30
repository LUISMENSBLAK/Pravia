-- Corrección 015: el porcentaje objeto pertenece a la instancia del acto.
-- El valor 100 representa transmisión total para actos existentes; nunca
-- completa ni inventa porcentajes de comparecientes.
ALTER TABLE "pravia_os"."expediente_actos"
  ADD COLUMN "porcentaje_objeto" DECIMAL(9,6) NOT NULL DEFAULT 100;

ALTER TABLE "pravia_os"."expediente_actos"
  ADD CONSTRAINT "expediente_actos_porcentaje_objeto_check"
  CHECK ("porcentaje_objeto" > 0 AND "porcentaje_objeto" <= 100);
