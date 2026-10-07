ALTER TABLE "pravia_os"."prospectos"
  ADD COLUMN "cotizacion_responsable_id" UUID;

CREATE INDEX "idx_prospecto_quote_assignee"
  ON "pravia_os"."prospectos" ("organization_id", "cotizacion_responsable_id");

ALTER TABLE "pravia_os"."prospectos"
  ADD CONSTRAINT "prospecto_quote_assignee_membership_fkey"
  FOREIGN KEY ("organization_id", "cotizacion_responsable_id")
  REFERENCES "pravia_os"."organization_memberships" ("organization_id", "user_id")
  ON UPDATE CASCADE ON DELETE RESTRICT;
