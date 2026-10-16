-- Mi Día configuration and personal notebook are tenant-scoped. No existing
-- dashboard data is rewritten; an absent row uses a permission-filtered default.
CREATE TABLE "pravia_os"."mi_dia_tenant_config" (
  "organization_id" UUID NOT NULL,
  "enabled_cards" JSONB NOT NULL,
  "default_layout" JSONB NOT NULL,
  "recommended_cards" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mi_dia_tenant_config_pkey" PRIMARY KEY ("organization_id"),
  CONSTRAINT "mi_dia_tenant_config_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TABLE "pravia_os"."mi_dia_user_layouts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "layout" JSONB NOT NULL,
  "personalized" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mi_dia_user_layouts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mi_dia_user_layouts_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "mi_dia_user_layouts_membership_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "pravia_os"."organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "mi_dia_user_layouts_organization_id_user_id_key" ON "pravia_os"."mi_dia_user_layouts"("organization_id", "user_id");

CREATE TABLE "pravia_os"."mi_dia_card_permissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "card_key" VARCHAR(80) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "max_scope" VARCHAR(20) NOT NULL DEFAULT 'OWN',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mi_dia_card_permissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mi_dia_card_permissions_scope_check" CHECK ("max_scope" IN ('OWN', 'TEAM', 'ORGANIZATION')),
  CONSTRAINT "mi_dia_card_permissions_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "mi_dia_card_permissions_membership_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "pravia_os"."organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "mi_dia_card_permissions_organization_id_user_id_card_key_key" ON "pravia_os"."mi_dia_card_permissions"("organization_id", "user_id", "card_key");
CREATE INDEX "mi_dia_card_permissions_organization_id_card_key_idx" ON "pravia_os"."mi_dia_card_permissions"("organization_id", "card_key");

CREATE TABLE "pravia_os"."mi_dia_personal_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "title" VARCHAR(300) NOT NULL,
  "notes" TEXT,
  "original_on" DATE NOT NULL,
  "effective_on" DATE NOT NULL,
  "completed_at" TIMESTAMPTZ(6),
  "canceled_at" TIMESTAMPTZ(6),
  "carry_history" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mi_dia_personal_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mi_dia_personal_tasks_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "mi_dia_personal_tasks_membership_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "pravia_os"."organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "mi_dia_personal_tasks_organization_id_user_id_effective_on_completed_at_idx" ON "pravia_os"."mi_dia_personal_tasks"("organization_id", "user_id", "effective_on", "completed_at");
