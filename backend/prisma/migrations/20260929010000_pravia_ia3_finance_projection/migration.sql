-- PRAVIA IA 3.0 + proyección financiera.
-- Migración aditiva: no activa normas, no reescribe históricos y no crea datos sintéticos.

ALTER TABLE "knowledge_source_versions"
  ADD COLUMN "legal_status" VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE_VERIFICAR',
  ADD COLUMN "detected_at" TIMESTAMP(3),
  ADD COLUMN "official_published_at" TIMESTAMP(3),
  ADD COLUMN "activated_at" TIMESTAMP(3),
  ADD COLUMN "review_required" BOOLEAN NOT NULL DEFAULT true;

-- Preserve the previously certified lineage instead of reopening every historical
-- version merely because the richer legal-state model was introduced.  Dates are
-- derived exclusively from canonical validity/verification columns already stored.
UPDATE "knowledge_source_versions"
SET
  "legal_status" = CASE
    WHEN "verification_status" = 'SUPERADA'
      OR ("effective_to" IS NOT NULL AND "effective_to" < CURRENT_DATE)
      THEN 'HISTORICA'
    WHEN "verification_status" = 'VERIFICADA'
      AND "effective_from" IS NOT NULL
      AND "effective_from" > CURRENT_DATE
      THEN 'FUTURA'
    WHEN "verification_status" = 'VERIFICADA'
      THEN 'VIGENTE'
    ELSE 'PENDIENTE_VERIFICAR'
  END,
  "activated_at" = CASE
    WHEN "verification_status" = 'VERIFICADA'
      AND ("effective_from" IS NULL OR "effective_from" <= CURRENT_DATE)
      THEN COALESCE("verified_at", "effective_from")
    ELSE NULL
  END,
  "review_required" = CASE
    WHEN "verification_status" IN ('VERIFICADA', 'SUPERADA') THEN false
    ELSE true
  END;

ALTER TABLE "memoria_despacho"
  ADD COLUMN "user_id" UUID,
  ADD COLUMN "scope_type" VARCHAR(32) NOT NULL DEFAULT 'ORGANIZATION',
  ADD COLUMN "scope_id" UUID,
  ADD COLUMN "source_type" VARCHAR(40) NOT NULL DEFAULT 'USER_CONFIRMED',
  ADD COLUMN "source_reference" TEXT,
  ADD COLUMN "approval_status" VARCHAR(32) NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "approved_by_id" UUID,
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "last_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "confidence" DECIMAL(5,4),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "use_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "created_by_id" UUID,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "memoria_despacho"
  ADD CONSTRAINT "memoria_despacho_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "memoria_despacho_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "memoria_despacho_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "memoria_despacho_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_assistant_memory_scope" ON "memoria_despacho"("organization_id", "scope_type", "scope_id", "active");
CREATE INDEX "idx_assistant_memory_category" ON "memoria_despacho"("organization_id", "categoria", "active");

CREATE TABLE "assistant_alerts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID,
  "deterministic_key" VARCHAR(180) NOT NULL,
  "source_type" VARCHAR(64) NOT NULL,
  "source_id" UUID,
  "entity_type" VARCHAR(64),
  "entity_id" UUID,
  "severity" VARCHAR(20) NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "href" TEXT,
  "actions" JSONB NOT NULL,
  "state" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  "due_at" TIMESTAMP(3),
  "snoozed_until" TIMESTAMP(3),
  "acknowledged_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assistant_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assistant_alerts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uq_assistant_alert_dedup" ON "assistant_alerts"("organization_id", "deterministic_key");
CREATE INDEX "idx_assistant_alert_inbox" ON "assistant_alerts"("organization_id", "user_id", "state", "severity");

CREATE TABLE "knowledge_radar_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "source_version_id" UUID NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'DETECTED',
  "source_url" TEXT,
  "previous_checksum" VARCHAR(64),
  "detected_checksum" VARCHAR(64) NOT NULL,
  "diff_summary" JSONB NOT NULL,
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_radar_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_radar_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "knowledge_radar_runs_source_tenant_fkey" FOREIGN KEY ("source_version_id", "organization_id") REFERENCES "knowledge_source_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "knowledge_radar_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uq_knowledge_radar_detection" ON "knowledge_radar_runs"("organization_id", "source_version_id", "detected_checksum");
CREATE UNIQUE INDEX "uq_knowledge_radar_run_id_org" ON "knowledge_radar_runs"("id", "organization_id");
CREATE INDEX "idx_knowledge_radar_status" ON "knowledge_radar_runs"("organization_id", "status", "detected_at");
CREATE INDEX "idx_knowledge_radar_creator_fk" ON "knowledge_radar_runs"("created_by_id");

CREATE TABLE "knowledge_impacts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "radar_run_id" UUID NOT NULL,
  "source_version_id" UUID NOT NULL,
  "entity_type" VARCHAR(80) NOT NULL,
  "entity_id" UUID,
  "impact_type" VARCHAR(80) NOT NULL,
  "summary" TEXT NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING_REVIEW',
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_impacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_impacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "knowledge_impacts_radar_tenant_fkey" FOREIGN KEY ("radar_run_id", "organization_id") REFERENCES "knowledge_radar_runs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "knowledge_impacts_source_tenant_fkey" FOREIGN KEY ("source_version_id", "organization_id") REFERENCES "knowledge_source_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "knowledge_impacts_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_knowledge_impact_review" ON "knowledge_impacts"("organization_id", "status", "entity_type");
CREATE INDEX "idx_knowledge_impact_radar_tenant_fk" ON "knowledge_impacts"("radar_run_id", "organization_id");
CREATE INDEX "idx_knowledge_impact_source_tenant_fk" ON "knowledge_impacts"("source_version_id", "organization_id");
CREATE INDEX "idx_knowledge_impact_reviewer_fk" ON "knowledge_impacts"("reviewed_by_id");

CREATE TABLE "gastos_recurrentes_financieros" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "concepto" TEXT NOT NULL,
  "monto" DECIMAL(14,2) NOT NULL,
  "periodicidad" VARCHAR(24) NOT NULL DEFAULT 'MENSUAL',
  "fecha_inicio" DATE NOT NULL,
  "fecha_fin" DATE,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gastos_recurrentes_financieros_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gastos_recurrentes_financieros_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "gastos_recurrentes_financieros_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "gastos_recurrentes_financieros_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_recurring_expense_projection" ON "gastos_recurrentes_financieros"("organization_id", "activo", "fecha_inicio", "fecha_fin");
CREATE INDEX "idx_recurring_expense_creator_fk" ON "gastos_recurrentes_financieros"("created_by_id");
CREATE INDEX "idx_recurring_expense_updater_fk" ON "gastos_recurrentes_financieros"("updated_by_id");

CREATE TABLE "consultas_financieras_guardadas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "query_text" TEXT NOT NULL,
  "typed_plan" JSONB NOT NULL,
  "saved" BOOLEAN NOT NULL DEFAULT false,
  "use_count" INTEGER NOT NULL DEFAULT 1,
  "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consultas_financieras_guardadas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consultas_financieras_guardadas_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "consultas_financieras_guardadas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_financial_query_owner" ON "consultas_financieras_guardadas"("organization_id", "user_id", "saved", "last_used_at");

CREATE INDEX "idx_assistant_memory_owner_fk" ON "memoria_despacho"("user_id");
CREATE INDEX "idx_assistant_memory_creator_fk" ON "memoria_despacho"("created_by_id");
CREATE INDEX "idx_assistant_memory_approver_fk" ON "memoria_despacho"("approved_by_id");

-- Every tenant-owned relation to a user must also prove that the user belongs
-- to that organization.  The canonical trigger accepts nullable actors.
DO $$
DECLARE relation RECORD; trigger_name TEXT;
BEGIN
  FOR relation IN SELECT * FROM (VALUES
    ('memoria_despacho','user_id'),
    ('memoria_despacho','created_by_id'),
    ('memoria_despacho','approved_by_id'),
    ('assistant_alerts','user_id'),
    ('knowledge_radar_runs','created_by_id'),
    ('knowledge_impacts','reviewed_by_id'),
    ('gastos_recurrentes_financieros','created_by_id'),
    ('gastos_recurrentes_financieros','updated_by_id'),
    ('consultas_financieras_guardadas','user_id')
  ) AS v(child_table, user_column)
  LOOP
    trigger_name := 'trg_ia3_member_' || substr(md5(relation.child_table || ':' || relation.user_column), 1, 20);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON pravia_os.%I FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership(%L)',
      trigger_name, relation.child_table, relation.user_column
    );
  END LOOP;
END $$;
-- Finance accounts are tenant-owned. The original uniqueness rule was global
-- and prevented two independent organizations from using the same bank alias.
DROP INDEX IF EXISTS "pravia_os"."cuentas_financieras_institucion_alias_key";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cuentas_financieras_org_institucion_alias"
  ON "pravia_os"."cuentas_financieras" ("organization_id", "institucion", "alias");
