-- PRAVIA IA 2.0 puede reintentar una generación documental cuando la red
-- no confirma el primer resultado. La clave queda acotada al tenant y a la
-- cotización; los documentos históricos permanecen sin clave y sin cambios.

ALTER TABLE "cotizacion_documentos"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_cot_documentos_idempotency"
  ON "cotizacion_documentos" ("organization_id", "cotizacion_id", "idempotency_key");
