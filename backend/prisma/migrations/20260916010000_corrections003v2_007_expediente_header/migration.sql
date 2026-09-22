-- Correcciones 003 v2 + 007: datos operativos canónicos de la ficha/listado.
-- La migración es aditiva; los históricos permanecen NULL cuando no existe
-- una fuente demostrable y nunca se infieren desde updated_at o firma.
ALTER TABLE "pravia_os"."expedientes"
  ADD COLUMN IF NOT EXISTS "fecha_escritura" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "fecha_estimada_entrega" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "folio_desde" TEXT,
  ADD COLUMN IF NOT EXISTS "folio_hasta" TEXT,
  ADD COLUMN IF NOT EXISTS "numero_escritura" TEXT;

CREATE INDEX IF NOT EXISTS "idx_expedientes_fecha_escritura"
  ON "pravia_os"."expedientes"("fecha_escritura");
