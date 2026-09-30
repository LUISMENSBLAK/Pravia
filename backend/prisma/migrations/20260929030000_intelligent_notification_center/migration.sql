-- PRAVIA OS — Centro canónico de notificaciones inteligentes.
-- Migración aditiva: preserva íntegramente las notificaciones históricas.

ALTER TABLE "notifications"
  ADD COLUMN "deterministic_key" VARCHAR(220) NOT NULL DEFAULT ('legacy:'::text || gen_random_uuid()::text),
  ADD COLUMN "target_scope" VARCHAR(24) NOT NULL DEFAULT 'USER',
  ADD COLUMN "target_role" "Role",
  ADD COLUMN "subtype" TEXT,
  ADD COLUMN "priority" VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "source_module" TEXT,
  ADD COLUMN "entity_type" TEXT,
  ADD COLUMN "entity_id" UUID,
  ADD COLUMN "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "last_reminder_at" TIMESTAMP(3),
  ADD COLUMN "snoozed_until" TIMESTAMP(3),
  ADD COLUMN "resolved_at" TIMESTAMP(3),
  ADD COLUMN "dismissed_at" TIMESTAMP(3),
  ADD COLUMN "not_applicable_at" TIMESTAMP(3),
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "uq_notifications_tenant_recipient_dedup"
  ON "notifications"("organization_id", "recipient_id", "deterministic_key");

CREATE INDEX "idx_notifications_recipient_inbox"
  ON "notifications"("recipient_id", "status", "read_at", "created_at");

CREATE INDEX "idx_notifications_source_object"
  ON "notifications"("organization_id", "source_module", "entity_type", "entity_id");

CREATE TABLE "notification_reminders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "notification_id" UUID NOT NULL,
  "reminder_key" VARCHAR(16) NOT NULL,
  "channel" VARCHAR(24) NOT NULL DEFAULT 'INTERNAL',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_reminders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_reminders_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_notification_reminder_daily_channel"
  ON "notification_reminders"("notification_id", "reminder_key", "channel");

CREATE INDEX "idx_notification_reminders_tenant_created"
  ON "notification_reminders"("organization_id", "created_at");
