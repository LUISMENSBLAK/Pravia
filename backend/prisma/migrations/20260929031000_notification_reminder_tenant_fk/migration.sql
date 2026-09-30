-- PRAVIA OS — Paridad física tenant del historial de recordatorios.
-- Aditiva sobre Notification y sin reescritura de datos históricos.

CREATE UNIQUE INDEX IF NOT EXISTS "uq_notifications_id_org"
  ON "notifications"("id", "organization_id");

ALTER TABLE "notification_reminders"
  DROP CONSTRAINT IF EXISTS "notification_reminders_notification_id_fkey";

ALTER TABLE "notification_reminders"
  ADD CONSTRAINT "notification_reminders_notification_tenant_fkey"
  FOREIGN KEY ("notification_id", "organization_id")
  REFERENCES "notifications"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "idx_notification_reminders_notification_org"
  ON "notification_reminders"("notification_id", "organization_id");
