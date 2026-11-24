-- Nullable: no default book/tome capacity and no reinterpretation of historical assignments.
ALTER TABLE "organizations" ADD COLUMN "archive_protocol_config" JSONB;
