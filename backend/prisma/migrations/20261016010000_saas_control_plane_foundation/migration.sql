-- CreateTable
CREATE TABLE "platform_shards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(80) NOT NULL,
    "provider_type" VARCHAR(40) NOT NULL,
    "region" VARCHAR(80) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    "capacity_class" VARCHAR(32) NOT NULL DEFAULT 'SHARED',
    "connection_secret_ref" VARCHAR(240) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_shards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_placements" (
    "organization_id" UUID NOT NULL,
    "shard_id" UUID NOT NULL,
    "deployment_type" VARCHAR(32) NOT NULL DEFAULT 'SHARED',
    "region" VARCHAR(80) NOT NULL,
    "placement_version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    "moved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_placements_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "plan_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_code" VARCHAR(80) NOT NULL,
    "version" INTEGER NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "monthly_price_minor" BIGINT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "included_storage_bytes" BIGINT NOT NULL,
    "included_users" INTEGER,
    "features_json" JSONB NOT NULL DEFAULT '{}',
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'TRIAL',
    "billing_cycle_anchor" TIMESTAMPTZ(6),
    "current_period_start" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "provider_reference" VARCHAR(240),
    "idempotency_key" VARCHAR(180) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_entitlements" (
    "organization_id" UUID NOT NULL,
    "included_storage_bytes" BIGINT NOT NULL,
    "addon_storage_bytes" BIGINT NOT NULL DEFAULT 0,
    "total_storage_capacity_bytes" BIGINT NOT NULL,
    "included_users" INTEGER,
    "max_users" INTEGER,
    "features_json" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_entitlements_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "storage_addon_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" VARCHAR(80) NOT NULL,
    "version" INTEGER NOT NULL,
    "capacity_bytes" BIGINT NOT NULL,
    "monthly_price_minor" BIGINT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_addon_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_storage_addons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "addon_version_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "price_snapshot_minor" BIGINT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "idempotency_key" VARCHAR(180) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_storage_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_storage_usage" (
    "organization_id" UUID NOT NULL,
    "production_bytes" BIGINT NOT NULL DEFAULT 0,
    "temporary_bytes" BIGINT NOT NULL DEFAULT 0,
    "reserved_bytes" BIGINT NOT NULL DEFAULT 0,
    "last_reconciled_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_storage_usage_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "storage_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "bytes" BIGINT NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'RESERVED',
    "storage_class" VARCHAR(24) NOT NULL DEFAULT 'PRODUCTION',
    "idempotency_key" VARCHAR(180) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "committed_at" TIMESTAMPTZ(6),
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_alert_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "resource_type" VARCHAR(40) NOT NULL,
    "threshold" INTEGER NOT NULL,
    "crossed_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "last_notified_at" TIMESTAMPTZ(6),

    CONSTRAINT "usage_alert_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_ledger_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "blob_id" UUID,
    "event_type" VARCHAR(40) NOT NULL,
    "production_delta_bytes" BIGINT NOT NULL DEFAULT 0,
    "temporary_delta_bytes" BIGINT NOT NULL DEFAULT 0,
    "reserved_delta_bytes" BIGINT NOT NULL DEFAULT 0,
    "source_type" VARCHAR(80) NOT NULL,
    "source_id" VARCHAR(180),
    "idempotency_key" VARCHAR(180) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_ledger_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_provider_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(80) NOT NULL,
    "provider_type" VARCHAR(40) NOT NULL,
    "region" VARCHAR(80),
    "secret_ref" VARCHAR(240),
    "capabilities_json" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_provider_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_blobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "sha256" CHAR(64),
    "size_bytes" BIGINT NOT NULL,
    "mime_type" VARCHAR(255) NOT NULL,
    "original_filename" VARCHAR(500) NOT NULL,
    "immutable" BOOLEAN NOT NULL DEFAULT true,
    "source" VARCHAR(80) NOT NULL DEFAULT 'APPLICATION_UPLOAD',
    "provenance_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "storage_blobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_blob_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "blob_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "location_role" VARCHAR(24) NOT NULL DEFAULT 'PRIMARY',
    "object_key" VARCHAR(1024) NOT NULL,
    "storage_class" VARCHAR(24) NOT NULL DEFAULT 'STANDARD',
    "status" VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE',
    "last_verified_at" TIMESTAMPTZ(6),
    "last_accessed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_blob_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_blob_refs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "blob_id" UUID NOT NULL,
    "owner_type" VARCHAR(80) NOT NULL,
    "owner_id" UUID NOT NULL,
    "document_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_blob_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_reconciliation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "provider_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "expected_bytes" BIGINT NOT NULL DEFAULT 0,
    "physical_bytes" BIGINT NOT NULL DEFAULT 0,
    "difference_bytes" BIGINT NOT NULL DEFAULT 0,
    "status" VARCHAR(24) NOT NULL DEFAULT 'RUNNING',
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_reconciliation_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "object_key" VARCHAR(1024) NOT NULL,
    "discrepancy_type" VARCHAR(48) NOT NULL,
    "expected_bytes" BIGINT,
    "physical_bytes" BIGINT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_reconciliation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_cost_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resource_code" VARCHAR(100) NOT NULL,
    "provider_code" VARCHAR(80) NOT NULL,
    "unit" VARCHAR(40) NOT NULL,
    "cost_amount" DECIMAL(20,8) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_cost_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_sku_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" VARCHAR(40) NOT NULL,
    "sale_price_minor" BIGINT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "min_markup_multiplier" DECIMAL(8,4) NOT NULL DEFAULT 2,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_sku_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku_version_id" UUID NOT NULL,
    "organization_id" UUID,
    "old_price_minor" BIGINT,
    "new_price_minor" BIGINT NOT NULL,
    "calculated_cost_minor" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "approval_metadata" JSONB NOT NULL DEFAULT '{}',
    "approved_by_platform_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_wallets" (
    "organization_id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "balance_minor" BIGINT NOT NULL DEFAULT 0,
    "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_wallets_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "ai_wallet_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "usage_event_id" UUID,
    "payment_ref" VARCHAR(240),
    "idempotency_key" VARCHAR(180) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_balance_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "estimated_max_charge_minor" BIGINT NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'RESERVED',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "usage_event_id" UUID,
    "idempotency_key" VARCHAR(180) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMPTZ(6),

    CONSTRAINT "ai_balance_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "operation_code" VARCHAR(100) NOT NULL,
    "provider_code" VARCHAR(80) NOT NULL,
    "model_code" VARCHAR(120) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "provider_cost_amount" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "provider_cost_currency" VARCHAR(3) NOT NULL,
    "fx_rate" DECIMAL(20,8) NOT NULL DEFAULT 1,
    "fx_snapshot" JSONB NOT NULL DEFAULT '{}',
    "commercial_charge_minor" BIGINT NOT NULL,
    "pricing_version_id" UUID,
    "latency_ms" INTEGER,
    "status" VARCHAR(24) NOT NULL,
    "error_code" VARCHAR(100),
    "trace_id" VARCHAR(180) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_operation_catalog" (
    "operation_code" VARCHAR(100) NOT NULL,
    "required_capability" VARCHAR(120) NOT NULL,
    "quality_tier" VARCHAR(24) NOT NULL,
    "max_input" INTEGER NOT NULL,
    "max_output" INTEGER NOT NULL,
    "max_charge_minor" BIGINT,
    "allow_fallback" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ai_operation_catalog_pkey" PRIMARY KEY ("operation_code")
);

-- CreateTable
CREATE TABLE "ai_model_registry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_code" VARCHAR(80) NOT NULL,
    "model_code" VARCHAR(120) NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "quality_tier" VARCHAR(24) NOT NULL,
    "pricing_reference" VARCHAR(240),
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ai_model_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_routing_policy_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operation_code" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL,
    "routing_rules_json" JSONB NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_routing_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_provider_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "provider_code" VARCHAR(80) NOT NULL,
    "provider_customer_ref" VARCHAR(240) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_provider_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_cycles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "subscription_amount" BIGINT NOT NULL DEFAULT 0,
    "storage_addon_amount" BIGINT NOT NULL DEFAULT 0,
    "other_addons_amount" BIGINT NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "status" VARCHAR(24) NOT NULL DEFAULT 'OPEN',
    "provider_invoice_ref" VARCHAR(240),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "provider_code" VARCHAR(80) NOT NULL,
    "provider_event_id" VARCHAR(240) NOT NULL,
    "event_type" VARCHAR(80) NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "payload_digest" CHAR(64),
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "job_type" VARCHAR(80) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "idempotency_key" VARCHAR(180) NOT NULL,
    "payload_ref" JSONB NOT NULL DEFAULT '{}',
    "last_error" TEXT,
    "lease_owner" VARCHAR(180),
    "lease_expires_at" TIMESTAMPTZ(6),
    "heartbeat_at" TIMESTAMPTZ(6),
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_pricing_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "min_bytes" BIGINT NOT NULL,
    "max_bytes" BIGINT,
    "base_price_minor" BIGINT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "source_system" VARCHAR(180) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'UPLOADING',
    "declared_bytes" BIGINT NOT NULL DEFAULT 0,
    "temporary_bytes" BIGINT NOT NULL DEFAULT 0,
    "estimated_production_bytes" BIGINT NOT NULL DEFAULT 0,
    "detected_files" INTEGER NOT NULL DEFAULT 0,
    "detected_records" INTEGER NOT NULL DEFAULT 0,
    "duplicate_files" INTEGER NOT NULL DEFAULT 0,
    "corrupt_files" INTEGER NOT NULL DEFAULT 0,
    "dangerous_files" INTEGER NOT NULL DEFAULT 0,
    "quote_id" UUID,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "idempotency_key" VARCHAR(180) NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "verification_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "migration_job_id" UUID NOT NULL,
    "entry_index" INTEGER NOT NULL,
    "source_path" VARCHAR(2048) NOT NULL,
    "source_record_id" VARCHAR(240),
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64),
    "mime_type" VARCHAR(255),
    "scan_status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "duplicate_of" UUID,
    "final_blob_id" UUID,
    "status" VARCHAR(32) NOT NULL DEFAULT 'UPLOADED',
    "error_code" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "migration_job_id" UUID NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "source_field" VARCHAR(240) NOT NULL,
    "target_field" VARCHAR(240),
    "transform" JSONB NOT NULL DEFAULT '{}',
    "confidence" DECIMAL(6,5),
    "status" VARCHAR(32) NOT NULL DEFAULT 'NEEDS_REVIEW',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),

    CONSTRAINT "migration_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_conflicts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "migration_job_id" UUID NOT NULL,
    "conflict_type" VARCHAR(80) NOT NULL,
    "source_ref" VARCHAR(500) NOT NULL,
    "candidate_ref" VARCHAR(500),
    "resolution" JSONB,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "migration_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_provenance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "migration_job_id" UUID NOT NULL,
    "source_system" VARCHAR(180) NOT NULL,
    "source_record_id" VARCHAR(240) NOT NULL,
    "source_file" VARCHAR(2048),
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" UUID NOT NULL,
    "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_provenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resumable_upload_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "migration_job_id" UUID NOT NULL,
    "provider_upload_id" VARCHAR(500),
    "object_key" VARCHAR(1024) NOT NULL,
    "declared_bytes" BIGINT NOT NULL,
    "uploaded_bytes" BIGINT NOT NULL DEFAULT 0,
    "part_size_bytes" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'CREATED',
    "sha256" CHAR(64),
    "idempotency_key" VARCHAR(180) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resumable_upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resumable_upload_parts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "upload_session_id" UUID NOT NULL,
    "part_number" INTEGER NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum_sha256" CHAR(64) NOT NULL,
    "provider_etag" VARCHAR(240),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resumable_upload_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "scope" JSONB NOT NULL,
    "format" VARCHAR(24) NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "manifest_blob_id" UUID,
    "archive_blob_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "idempotency_key" VARCHAR(180) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_artifacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "export_job_id" UUID NOT NULL,
    "blob_id" UUID NOT NULL,
    "artifact_type" VARCHAR(40) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "scope" VARCHAR(80) NOT NULL,
    "provider" VARCHAR(80) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "manifest_ref" VARCHAR(1024),
    "restore_point_ref" VARCHAR(1024),
    "checksum_sha256" CHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restore_drills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "backup_run_id" UUID NOT NULL,
    "tested_at" TIMESTAMPTZ(6) NOT NULL,
    "result" VARCHAR(24) NOT NULL,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "report_ref" VARCHAR(1024),
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "restore_drills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "resource_type" VARCHAR(80) NOT NULL,
    "quantity" DECIMAL(24,8) NOT NULL,
    "unit" VARCHAR(40) NOT NULL,
    "source_type" VARCHAR(80) NOT NULL,
    "source_id" VARCHAR(180),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(180) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_cost_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "period" DATE NOT NULL,
    "storage_cost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "ai_cost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "egress_cost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "other_cost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "subscription_revenue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "storage_revenue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "ai_sales" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "commercial_ai_consumption" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "gross_margin_estimate" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_cost_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_administrators" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "platform_administrators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_access_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "platform_administrator_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "scope" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "approval_metadata" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "platform_actor_id" UUID,
    "organization_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "target_type" VARCHAR(80),
    "target_id" VARCHAR(180),
    "reason" TEXT,
    "before_metadata" JSONB,
    "after_metadata" JSONB,
    "trace_id" VARCHAR(180) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_metric_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "metric_code" VARCHAR(100) NOT NULL,
    "value" DECIMAL(24,8) NOT NULL,
    "unit" VARCHAR(40) NOT NULL,
    "dimensions" JSONB NOT NULL DEFAULT '{}',
    "trace_id" VARCHAR(180),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_metric_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_shards_code_key" ON "platform_shards"("code");

-- CreateIndex
CREATE INDEX "idx_platform_shards_status" ON "platform_shards"("status", "capacity_class");

-- CreateIndex
CREATE INDEX "idx_tenant_placements_shard" ON "tenant_placements"("shard_id", "status");

-- CreateIndex
CREATE INDEX "idx_plan_versions_effective" ON "plan_versions"("active", "effective_from", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "uq_plan_versions_code_version" ON "plan_versions"("plan_code", "version");

-- CreateIndex
CREATE INDEX "idx_tenant_subscriptions_org_status" ON "tenant_subscriptions"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tenant_subscriptions_idempotency" ON "tenant_subscriptions"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "idx_storage_addon_versions_effective" ON "storage_addon_versions"("active", "effective_from", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "uq_storage_addon_versions_sku_version" ON "storage_addon_versions"("sku", "version");

-- CreateIndex
CREATE INDEX "idx_tenant_storage_addons_active" ON "tenant_storage_addons"("organization_id", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tenant_storage_addons_idempotency" ON "tenant_storage_addons"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "idx_storage_reservations_expiry" ON "storage_reservations"("organization_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_storage_reservations_idempotency" ON "storage_reservations"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "idx_usage_alert_states_active" ON "usage_alert_states"("organization_id", "resource_type", "resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_usage_alert_states_threshold" ON "usage_alert_states"("organization_id", "resource_type", "threshold");

-- CreateIndex
CREATE INDEX "idx_storage_ledger_events_timeline" ON "storage_ledger_events"("organization_id", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_storage_ledger_events_blob" ON "storage_ledger_events"("organization_id", "blob_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_storage_ledger_events_idempotency" ON "storage_ledger_events"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "storage_provider_records_code_key" ON "storage_provider_records"("code");

-- CreateIndex
CREATE INDEX "idx_storage_blobs_tenant_created" ON "storage_blobs"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_storage_blobs_tenant_hash_size" ON "storage_blobs"("organization_id", "sha256", "size_bytes");

-- CreateIndex
CREATE UNIQUE INDEX "uq_storage_blobs_id_org" ON "storage_blobs"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_storage_blob_locations_blob" ON "storage_blob_locations"("organization_id", "blob_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_storage_blob_locations_provider_key" ON "storage_blob_locations"("provider_id", "object_key");

-- CreateIndex
CREATE INDEX "idx_storage_blob_refs_owner" ON "storage_blob_refs"("organization_id", "owner_type", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_storage_blob_refs_owner_blob" ON "storage_blob_refs"("organization_id", "owner_type", "owner_id", "blob_id");

-- CreateIndex
CREATE INDEX "idx_storage_reconciliation_runs_org" ON "storage_reconciliation_runs"("organization_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_storage_reconciliation_runs_id_org" ON "storage_reconciliation_runs"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_storage_reconciliation_items_run" ON "storage_reconciliation_items"("run_id", "discrepancy_type");

-- CreateIndex
CREATE INDEX "idx_storage_reconciliation_items_object" ON "storage_reconciliation_items"("organization_id", "object_key");

-- CreateIndex
CREATE INDEX "idx_resource_cost_versions_effective" ON "resource_cost_versions"("resource_code", "effective_from", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "uq_resource_cost_versions_identity" ON "resource_cost_versions"("resource_code", "provider_code", "version");

-- CreateIndex
CREATE INDEX "idx_commercial_sku_versions_effective" ON "commercial_sku_versions"("kind", "active", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "uq_commercial_sku_versions_identity" ON "commercial_sku_versions"("sku", "version");

-- CreateIndex
CREATE INDEX "idx_pricing_overrides_scope" ON "pricing_overrides"("sku_version_id", "organization_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_ai_wallet_transactions_timeline" ON "ai_wallet_transactions"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_wallet_transactions_idempotency" ON "ai_wallet_transactions"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "idx_ai_balance_reservations_expiry" ON "ai_balance_reservations"("organization_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_balance_reservations_idempotency" ON "ai_balance_reservations"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "idx_ai_usage_events_timeline" ON "ai_usage_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_ai_usage_events_user" ON "ai_usage_events"("organization_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_ai_usage_events_operation" ON "ai_usage_events"("organization_id", "operation_code", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_usage_events_trace" ON "ai_usage_events"("organization_id", "trace_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_model_registry_provider_model" ON "ai_model_registry"("provider_code", "model_code");

-- CreateIndex
CREATE INDEX "idx_ai_routing_policy_versions_active" ON "ai_routing_policy_versions"("operation_code", "active", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_routing_policy_versions_identity" ON "ai_routing_policy_versions"("operation_code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_billing_provider_accounts_org_provider" ON "billing_provider_accounts"("organization_id", "provider_code");

-- CreateIndex
CREATE INDEX "idx_billing_cycles_org_status" ON "billing_cycles"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_billing_cycles_period" ON "billing_cycles"("organization_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "idx_billing_events_org" ON "billing_events"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_billing_events_provider_event" ON "billing_events"("provider_code", "provider_event_id");

-- CreateIndex
CREATE INDEX "idx_background_jobs_claim" ON "background_jobs"("status", "scheduled_at", "priority");

-- CreateIndex
CREATE INDEX "idx_background_jobs_fairness" ON "background_jobs"("organization_id", "status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_background_jobs_tenant_idempotency" ON "background_jobs"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "idx_migration_pricing_rules_effective" ON "migration_pricing_rules"("active", "effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "idx_migration_jobs_org_status" ON "migration_jobs"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_migration_jobs_idempotency" ON "migration_jobs"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_migration_jobs_id_org" ON "migration_jobs"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_migration_assets_job" ON "migration_assets"("organization_id", "migration_job_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_migration_assets_job_entry" ON "migration_assets"("migration_job_id", "entry_index");

-- CreateIndex
CREATE INDEX "idx_migration_mappings_review" ON "migration_mappings"("organization_id", "migration_job_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_migration_mappings_source" ON "migration_mappings"("migration_job_id", "entity_type", "source_field");

-- CreateIndex
CREATE INDEX "idx_migration_conflicts_open" ON "migration_conflicts"("organization_id", "migration_job_id", "resolved_at");

-- CreateIndex
CREATE INDEX "idx_migration_provenance_target" ON "migration_provenance"("organization_id", "target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_migration_provenance_source" ON "migration_provenance"("organization_id", "migration_job_id", "source_system", "source_record_id", "target_type");

-- CreateIndex
CREATE INDEX "idx_resumable_upload_sessions_open" ON "resumable_upload_sessions"("organization_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_resumable_upload_sessions_idempotency" ON "resumable_upload_sessions"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_resumable_upload_sessions_id_org" ON "resumable_upload_sessions"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_resumable_upload_parts_session" ON "resumable_upload_parts"("organization_id", "upload_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_resumable_upload_parts_number" ON "resumable_upload_parts"("upload_session_id", "part_number");

-- CreateIndex
CREATE INDEX "idx_export_jobs_org_status" ON "export_jobs"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_export_jobs_idempotency" ON "export_jobs"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_export_jobs_id_org" ON "export_jobs"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_export_artifacts_job" ON "export_artifacts"("organization_id", "export_job_id");

-- CreateIndex
CREATE INDEX "idx_backup_runs_scope" ON "backup_runs"("organization_id", "started_at");

-- CreateIndex
CREATE INDEX "idx_restore_drills_backup" ON "restore_drills"("backup_run_id", "tested_at");

-- CreateIndex
CREATE INDEX "idx_usage_events_resource" ON "usage_events"("organization_id", "resource_type", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_usage_events_idempotency" ON "usage_events"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "idx_tenant_cost_snapshots_period" ON "tenant_cost_snapshots"("period");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tenant_cost_snapshots_period" ON "tenant_cost_snapshots"("organization_id", "period");

-- CreateIndex
CREATE INDEX "idx_platform_administrators_status" ON "platform_administrators"("status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_platform_administrators_user" ON "platform_administrators"("user_id");

-- CreateIndex
CREATE INDEX "idx_platform_access_grants_admin" ON "platform_access_grants"("platform_administrator_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "idx_platform_access_grants_tenant" ON "platform_access_grants"("organization_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "idx_platform_audit_events_tenant" ON "platform_audit_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_platform_audit_events_actor" ON "platform_audit_events"("platform_actor_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_platform_metric_events_code" ON "platform_metric_events"("metric_code", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_platform_metric_events_tenant" ON "platform_metric_events"("organization_id", "occurred_at");

-- -----------------------------------------------------------------------------
-- Referential integrity and invariants. Organization is the canonical tenant.
-- -----------------------------------------------------------------------------
ALTER TABLE "tenant_placements" ADD CONSTRAINT "tenant_placements_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_placements" ADD CONSTRAINT "tenant_placements_shard_fkey" FOREIGN KEY ("shard_id") REFERENCES "platform_shards"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_plan_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_entitlements" ADD CONSTRAINT "tenant_entitlements_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_storage_addons" ADD CONSTRAINT "tenant_storage_addons_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_storage_addons" ADD CONSTRAINT "tenant_storage_addons_version_fkey" FOREIGN KEY ("addon_version_id") REFERENCES "storage_addon_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_storage_usage" ADD CONSTRAINT "tenant_storage_usage_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "storage_reservations" ADD CONSTRAINT "storage_reservations_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "usage_alert_states" ADD CONSTRAINT "usage_alert_states_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "storage_ledger_events" ADD CONSTRAINT "storage_ledger_events_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "storage_ledger_events" ADD CONSTRAINT "storage_ledger_events_blob_fkey" FOREIGN KEY ("blob_id", "organization_id") REFERENCES "storage_blobs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "storage_blobs" ADD CONSTRAINT "storage_blobs_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "storage_blob_locations" ADD CONSTRAINT "storage_blob_locations_blob_fkey" FOREIGN KEY ("blob_id", "organization_id") REFERENCES "storage_blobs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "storage_blob_locations" ADD CONSTRAINT "storage_blob_locations_provider_fkey" FOREIGN KEY ("provider_id") REFERENCES "storage_provider_records"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "storage_blob_refs" ADD CONSTRAINT "storage_blob_refs_blob_fkey" FOREIGN KEY ("blob_id", "organization_id") REFERENCES "storage_blobs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "storage_reconciliation_runs" ADD CONSTRAINT "storage_reconciliation_runs_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "storage_reconciliation_runs" ADD CONSTRAINT "storage_reconciliation_runs_provider_fkey" FOREIGN KEY ("provider_id") REFERENCES "storage_provider_records"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "storage_reconciliation_items" ADD CONSTRAINT "storage_reconciliation_items_run_fkey" FOREIGN KEY ("run_id", "organization_id") REFERENCES "storage_reconciliation_runs"("id", "organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "pricing_overrides" ADD CONSTRAINT "pricing_overrides_sku_fkey" FOREIGN KEY ("sku_version_id") REFERENCES "commercial_sku_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "pricing_overrides" ADD CONSTRAINT "pricing_overrides_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ai_wallets" ADD CONSTRAINT "ai_wallets_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ai_wallet_transactions" ADD CONSTRAINT "ai_wallet_transactions_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ai_balance_reservations" ADD CONSTRAINT "ai_balance_reservations_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_membership_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "billing_provider_accounts" ADD CONSTRAINT "billing_provider_accounts_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "billing_cycles" ADD CONSTRAINT "billing_cycles_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_creator_fkey" FOREIGN KEY ("organization_id", "created_by") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "migration_assets" ADD CONSTRAINT "migration_assets_job_fkey" FOREIGN KEY ("migration_job_id", "organization_id") REFERENCES "migration_jobs"("id", "organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "migration_mappings" ADD CONSTRAINT "migration_mappings_job_fkey" FOREIGN KEY ("migration_job_id", "organization_id") REFERENCES "migration_jobs"("id", "organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "migration_conflicts" ADD CONSTRAINT "migration_conflicts_job_fkey" FOREIGN KEY ("migration_job_id", "organization_id") REFERENCES "migration_jobs"("id", "organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "migration_provenance" ADD CONSTRAINT "migration_provenance_job_fkey" FOREIGN KEY ("migration_job_id", "organization_id") REFERENCES "migration_jobs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "resumable_upload_sessions" ADD CONSTRAINT "resumable_upload_sessions_job_fkey" FOREIGN KEY ("migration_job_id", "organization_id") REFERENCES "migration_jobs"("id", "organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "resumable_upload_parts" ADD CONSTRAINT "resumable_upload_parts_session_fkey" FOREIGN KEY ("upload_session_id", "organization_id") REFERENCES "resumable_upload_sessions"("id", "organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_creator_fkey" FOREIGN KEY ("organization_id", "created_by") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "export_artifacts" ADD CONSTRAINT "export_artifacts_job_fkey" FOREIGN KEY ("export_job_id", "organization_id") REFERENCES "export_jobs"("id", "organization_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "restore_drills" ADD CONSTRAINT "restore_drills_backup_fkey" FOREIGN KEY ("backup_run_id") REFERENCES "backup_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_cost_snapshots" ADD CONSTRAINT "tenant_cost_snapshots_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "platform_administrators" ADD CONSTRAINT "platform_administrators_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "platform_access_grants" ADD CONSTRAINT "platform_access_grants_admin_fkey" FOREIGN KEY ("platform_administrator_id") REFERENCES "platform_administrators"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "platform_access_grants" ADD CONSTRAINT "platform_access_grants_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_admin_fkey" FOREIGN KEY ("platform_actor_id") REFERENCES "platform_administrators"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "platform_metric_events" ADD CONSTRAINT "platform_metric_events_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "tenant_storage_addons" ADD CONSTRAINT "tenant_storage_addons_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "tenant_storage_usage" ADD CONSTRAINT "tenant_storage_usage_nonnegative_check" CHECK ("production_bytes" >= 0 AND "temporary_bytes" >= 0 AND "reserved_bytes" >= 0);
ALTER TABLE "tenant_entitlements" ADD CONSTRAINT "tenant_entitlements_capacity_check" CHECK ("included_storage_bytes" >= 0 AND "addon_storage_bytes" >= 0 AND "total_storage_capacity_bytes" = "included_storage_bytes" + "addon_storage_bytes");
ALTER TABLE "storage_reservations" ADD CONSTRAINT "storage_reservations_bytes_check" CHECK ("bytes" > 0);
ALTER TABLE "usage_alert_states" ADD CONSTRAINT "usage_alert_states_threshold_check" CHECK ("threshold" IN (70, 80, 90, 95, 100));
ALTER TABLE "storage_blobs" ADD CONSTRAINT "storage_blobs_size_check" CHECK ("size_bytes" >= 0);
ALTER TABLE "ai_wallets" ADD CONSTRAINT "ai_wallets_balance_check" CHECK ("balance_minor" >= 0);
ALTER TABLE "ai_balance_reservations" ADD CONSTRAINT "ai_balance_reservations_charge_check" CHECK ("estimated_max_charge_minor" > 0);
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_progress_check" CHECK ("progress" BETWEEN 0 AND 100 AND "attempts" >= 0 AND "max_attempts" > 0);
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_progress_check" CHECK ("progress" BETWEEN 0 AND 100);
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_progress_check" CHECK ("progress" BETWEEN 0 AND 100);

-- -----------------------------------------------------------------------------
-- Tenant RLS. The backend still enforces ActorContext/RBAC/object scope. These
-- policies provide database defense for restricted roles and direct SQL tests.
-- Platform operations must opt in explicitly through a transaction-local flag.
-- -----------------------------------------------------------------------------
DO $rls$
DECLARE
  table_name text;
  tenant_tables text[] := ARRAY[
    'tenant_placements','tenant_subscriptions','tenant_entitlements','tenant_storage_addons',
    'tenant_storage_usage','storage_reservations','usage_alert_states','storage_ledger_events',
    'storage_blobs','storage_blob_locations','storage_blob_refs','storage_reconciliation_runs',
    'storage_reconciliation_items','pricing_overrides','ai_wallets','ai_wallet_transactions',
    'ai_balance_reservations','ai_usage_events','billing_provider_accounts','billing_cycles',
    'billing_events','background_jobs','migration_jobs','migration_assets','migration_mappings',
    'migration_conflicts','migration_provenance','resumable_upload_sessions','resumable_upload_parts',
    'export_jobs','export_artifacts','backup_runs','usage_events','tenant_cost_snapshots',
    'platform_access_grants','platform_audit_events','platform_metric_events'
  ];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = NULLIF(current_setting(''app.current_organization_id'', true), '''')::uuid OR current_setting(''app.platform_operation'', true) = ''true'') WITH CHECK (organization_id = NULLIF(current_setting(''app.current_organization_id'', true), '''')::uuid OR current_setting(''app.platform_operation'', true) = ''true'')',
      'tenant_isolation_' || table_name,
      table_name
    );
  END LOOP;
END
$rls$;

-- -----------------------------------------------------------------------------
-- Idempotent compatibility backfill. Prices remain NULL until commercially
-- configured. No domain data is rewritten and no physical object is moved.
-- -----------------------------------------------------------------------------
INSERT INTO "platform_shards" (
  "id", "code", "provider_type", "region", "status", "capacity_class", "connection_secret_ref"
) VALUES (
  '00000000-0000-4000-8000-000000000500', 'primary-shared', 'POSTGRESQL', 'configured-primary', 'ACTIVE', 'SHARED', 'env:DATABASE_URL'
) ON CONFLICT ("code") DO NOTHING;

INSERT INTO "storage_provider_records" (
  "id", "code", "provider_type", "region", "secret_ref", "capabilities_json", "status"
) VALUES (
  '00000000-0000-4000-8000-000000000502', 'runtime-primary', 'RUNTIME_CONFIGURED', NULL, 'env:STORAGE_PROVIDER',
  '{"put":true,"head":true,"download":true,"delete":true,"signedUrl":true,"copy":false,"list":false,"resumable":false}'::jsonb,
  'ACTIVE'
) ON CONFLICT ("code") DO NOTHING;

INSERT INTO "plan_versions" (
  "id", "plan_code", "version", "name", "monthly_price_minor", "currency", "included_storage_bytes", "included_users", "features_json", "effective_from", "active"
) VALUES (
  '00000000-0000-4000-8000-000000000501', 'PRAVIA_BASE', 1, 'PRAVIA Base', NULL, 'MXN', 53687091200, NULL,
  '{"commercial_configuration":"PENDING","legacy_compatible":true}'::jsonb, '2026-10-16T00:00:00Z', true
) ON CONFLICT ("plan_code", "version") DO NOTHING;

INSERT INTO "tenant_placements" (
  "organization_id", "shard_id", "deployment_type", "region", "placement_version", "status"
)
SELECT "id", '00000000-0000-4000-8000-000000000500', 'SHARED', 'configured-primary', 1, 'ACTIVE'
FROM "organizations"
ON CONFLICT ("organization_id") DO NOTHING;

INSERT INTO "tenant_subscriptions" (
  "organization_id", "plan_version_id", "status", "idempotency_key"
)
SELECT "id", '00000000-0000-4000-8000-000000000501', 'ACTIVE', 'foundation:legacy-base-v1'
FROM "organizations"
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;

INSERT INTO "tenant_entitlements" (
  "organization_id", "included_storage_bytes", "addon_storage_bytes", "total_storage_capacity_bytes", "features_json", "version"
)
SELECT "id", 53687091200, 0, 53687091200, '{"source":"PRAVIA_BASE:1"}'::jsonb, 1
FROM "organizations"
ON CONFLICT ("organization_id") DO NOTHING;

INSERT INTO "tenant_storage_usage" (
  "organization_id", "production_bytes", "temporary_bytes", "reserved_bytes", "version"
)
SELECT organization."id", COALESCE(SUM(document."size_bytes"), 0)::bigint, 0, 0, 1
FROM "organizations" organization
LEFT JOIN "documentos" document ON document."organization_id" = organization."id"
GROUP BY organization."id"
ON CONFLICT ("organization_id") DO NOTHING;

-- Existing Documento metadata is not proof that the provider still has the
-- object or that its recorded checksum is correct. Keep each historical key
-- separately addressable; reconciliation will verify bytes and checksums.
INSERT INTO "storage_blobs" (
  "id", "organization_id", "sha256", "size_bytes", "mime_type",
  "original_filename", "source", "provenance_json", "created_at"
)
SELECT document."id", document."organization_id", NULL,
       document."size_bytes"::bigint, document."mime_type", document."nombre_original",
       'LEGACY_DOCUMENT_BACKFILL',
       jsonb_build_object(
         'documentId', document."id", 'recordedChecksumSha256', document."checksum_sha256",
         'verification', 'PENDING_PROVIDER_RECONCILIATION'
       ), document."fecha_carga"
FROM "documentos" document
WHERE document."organization_id" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "storage_blob_locations" (
  "blob_id", "organization_id", "provider_id", "object_key",
  "storage_class", "status", "created_at"
)
SELECT document."id", document."organization_id",
       '00000000-0000-4000-8000-000000000502', document."storage_key",
       'PRODUCTION', 'LEGACY_UNVERIFIED', document."fecha_carga"
FROM "documentos" document
WHERE document."organization_id" IS NOT NULL
ON CONFLICT ("provider_id", "object_key") DO NOTHING;

INSERT INTO "storage_blob_refs" (
  "organization_id", "blob_id", "owner_type", "owner_id", "created_at"
)
SELECT document."organization_id", document."id", 'DOCUMENTO', document."id",
       document."fecha_carga"
FROM "documentos" document
WHERE document."organization_id" IS NOT NULL
ON CONFLICT ("organization_id", "owner_type", "owner_id", "blob_id") DO NOTHING;

INSERT INTO "storage_ledger_events" (
  "organization_id", "event_type", "production_delta_bytes", "temporary_delta_bytes",
  "reserved_delta_bytes", "source_type", "source_id", "idempotency_key"
)
SELECT "organization_id", 'RECONCILIATION_ADJUSTMENT', "production_bytes", 0, 0,
       'FOUNDATION_BACKFILL', NULL, 'foundation:existing-document-bytes-v1'
FROM "tenant_storage_usage"
WHERE "production_bytes" <> 0
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;

INSERT INTO "ai_wallets" ("organization_id", "currency", "balance_minor", "status", "version")
SELECT "id", 'MXN', 0, 'ACTIVE', 1 FROM "organizations"
ON CONFLICT ("organization_id") DO NOTHING;

WITH credited AS (
  INSERT INTO "ai_wallet_transactions" (
    "organization_id", "type", "amount_minor", "idempotency_key", "expires_at"
  )
  SELECT "id", 'PROMO_CREDIT', 300000, 'foundation:promo-credit-3000-mxn-v1', NULL
  FROM "organizations"
  ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING
  RETURNING "organization_id", "amount_minor"
)
UPDATE "ai_wallets" wallet
SET "balance_minor" = wallet."balance_minor" + credited."amount_minor",
    "version" = wallet."version" + 1,
    "updated_at" = CURRENT_TIMESTAMP
FROM credited
WHERE wallet."organization_id" = credited."organization_id";
