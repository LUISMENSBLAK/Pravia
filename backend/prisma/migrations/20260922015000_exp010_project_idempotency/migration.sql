ALTER TABLE "expediente_documentos"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_exp_documentos_idempotency"
  ON "expediente_documentos" ("organization_id", "expediente_id", "idempotency_key");
