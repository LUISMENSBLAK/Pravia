ALTER TABLE "users" ADD COLUMN "telefono" TEXT;

CREATE TABLE "user_preferences" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "default_view" TEXT NOT NULL DEFAULT 'CARDS',
  "density" TEXT NOT NULL DEFAULT 'COMFORTABLE',
  "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
  "date_format" TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  "theme" TEXT NOT NULL DEFAULT 'SYSTEM',
  "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
  "assistant_suggestions_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences"("user_id");
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "user_invitations" (
  "id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "apellido" TEXT NOT NULL,
  "rol" "Role" NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "accepted_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_by_id" UUID NOT NULL,
  "accepted_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_invitations_token_hash_key" ON "user_invitations"("token_hash");
CREATE UNIQUE INDEX "user_invitations_accepted_user_id_key" ON "user_invitations"("accepted_user_id");
CREATE INDEX "user_invitations_email_accepted_at_revoked_at_expires_at_idx" ON "user_invitations"("email", "accepted_at", "revoked_at", "expires_at");
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_accepted_user_id_fkey" FOREIGN KEY ("accepted_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "notifications" (
  "id" UUID NOT NULL,
  "recipient_id" UUID NOT NULL,
  "created_by_id" UUID,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "href" TEXT,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_recipient_id_read_at_created_at_idx" ON "notifications"("recipient_id", "read_at", "created_at");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
