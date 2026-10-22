-- Keep historical usage in the only class previously supported by the gateway.
-- Existing operation catalog rows remain unclassified and fail closed until
-- their intended billing class is explicitly configured.
ALTER TABLE "ai_operation_catalog"
  ADD COLUMN "billing_class" VARCHAR(32);

ALTER TABLE "ai_usage_events"
  ALTER COLUMN "user_id" DROP NOT NULL,
  ADD COLUMN "billing_class" VARCHAR(32) NOT NULL DEFAULT 'CUSTOMER_WALLET',
  ADD COLUMN "migration_job_id" UUID,
  ADD COLUMN "cost_center" VARCHAR(100),
  ADD COLUMN "wallet_debit_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "idempotency_key" VARCHAR(180);

UPDATE "ai_usage_events"
SET "wallet_debit_minor" = "commercial_charge_minor"
WHERE "commercial_charge_minor" > 0;

CREATE UNIQUE INDEX "uq_ai_usage_events_idempotency"
  ON "ai_usage_events"("organization_id", "idempotency_key");
