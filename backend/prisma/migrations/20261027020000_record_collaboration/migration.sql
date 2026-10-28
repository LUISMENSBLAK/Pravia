CREATE TABLE "pravia_os"."record_collaborations" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "prospecto_id" UUID,
  "cotizacion_id" UUID,
  "expediente_id" UUID,
  "user_id" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "assigned_by_id" UUID NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_by_id" UUID,
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "record_collaborations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "record_collaborations_one_target_check" CHECK (
    ("prospecto_id" IS NOT NULL)::integer + ("cotizacion_id" IS NOT NULL)::integer + ("expediente_id" IS NOT NULL)::integer = 1
  ),
  CONSTRAINT "record_collaborations_prospecto_fkey" FOREIGN KEY ("prospecto_id", "organization_id") REFERENCES "pravia_os"."prospectos"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "record_collaborations_cotizacion_fkey" FOREIGN KEY ("cotizacion_id", "organization_id") REFERENCES "pravia_os"."cotizaciones"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "record_collaborations_expediente_fkey" FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "pravia_os"."expedientes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "record_collaborations_member_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "pravia_os"."organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "record_collaborations_org_prospecto_active_idx" ON "pravia_os"."record_collaborations"("organization_id", "prospecto_id", "active");
CREATE INDEX "record_collaborations_org_cotizacion_active_idx" ON "pravia_os"."record_collaborations"("organization_id", "cotizacion_id", "active");
CREATE INDEX "record_collaborations_org_expediente_active_idx" ON "pravia_os"."record_collaborations"("organization_id", "expediente_id", "active");
CREATE UNIQUE INDEX "record_collaborations_active_prospecto_user_key" ON "pravia_os"."record_collaborations"("organization_id", "prospecto_id", "user_id") WHERE "active" AND "prospecto_id" IS NOT NULL;
CREATE UNIQUE INDEX "record_collaborations_active_cotizacion_user_key" ON "pravia_os"."record_collaborations"("organization_id", "cotizacion_id", "user_id") WHERE "active" AND "cotizacion_id" IS NOT NULL;
CREATE UNIQUE INDEX "record_collaborations_active_expediente_user_key" ON "pravia_os"."record_collaborations"("organization_id", "expediente_id", "user_id") WHERE "active" AND "expediente_id" IS NOT NULL;
