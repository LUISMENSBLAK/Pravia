ALTER TABLE "ai_usage_events"
  ADD CONSTRAINT "fk_ai_usage_events_migration_tenant"
  FOREIGN KEY ("migration_job_id", "organization_id")
  REFERENCES "migration_jobs"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
