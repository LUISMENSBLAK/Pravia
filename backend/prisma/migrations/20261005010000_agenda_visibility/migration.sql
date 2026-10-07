BEGIN;

SET LOCAL search_path TO pravia_os, public;

CREATE TYPE "AgendaVisibilidad" AS ENUM ('PRIVATE', 'ORGANIZATION');

ALTER TABLE "eventos_agenda"
  ADD COLUMN "created_by_id" UUID,
  ADD COLUMN "visibilidad" "AgendaVisibilidad" NOT NULL DEFAULT 'PRIVATE';

-- Los eventos históricos permanecen privados. El responsable anterior es la
-- única identidad de autoría verificable; no se infiere un público mayor.
UPDATE "eventos_agenda"
  SET "created_by_id" = "user_id"
  WHERE "created_by_id" IS NULL AND "user_id" IS NOT NULL;

ALTER TABLE "eventos_agenda"
  ADD CONSTRAINT "eventos_agenda_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE UNIQUE INDEX "uq_eventos_agenda_id_org"
  ON "eventos_agenda"("id", "organization_id");
CREATE INDEX "idx_agenda_org_visibility_date"
  ON "eventos_agenda"("organization_id", "visibilidad", "fecha_inicio");
CREATE INDEX "idx_agenda_created_by_fk"
  ON "eventos_agenda"("created_by_id");

CREATE TABLE "evento_agenda_participantes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "evento_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "evento_agenda_participantes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agenda_participants_event_tenant_fkey"
    FOREIGN KEY ("evento_id", "organization_id")
    REFERENCES "eventos_agenda"("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "agenda_participants_membership_fkey"
    FOREIGN KEY ("organization_id", "user_id")
    REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "uq_agenda_participant_event_user"
  ON "evento_agenda_participantes"("organization_id", "evento_id", "user_id");
CREATE INDEX "idx_agenda_participant_user"
  ON "evento_agenda_participantes"("organization_id", "user_id", "evento_id");

COMMIT;
