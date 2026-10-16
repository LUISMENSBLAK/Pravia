-- Alta integral de actos. Los valores históricos quedan UNKNOWN (NULL), sin
-- inferencias ni mutación de actos existentes.
ALTER TABLE "pravia_os"."configuracion_actos"
  ADD COLUMN "jurisdiccion" TEXT,
  ADD COLUMN "registrable" BOOLEAN,
  ADD COLUMN "actividad_vulnerable" BOOLEAN;
