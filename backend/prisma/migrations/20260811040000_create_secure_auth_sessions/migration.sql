-- Fase 10: autenticación real y sesiones renovables.
-- Migración aditiva: no elimina ni reescribe usuarios existentes.

ALTER TYPE pravia_os."Role" ADD VALUE IF NOT EXISTS 'CONSULTA';

ALTER TABLE pravia_os.users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS requires_password_change BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS pravia_os.auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  expires_at TIMESTAMP(3) NOT NULL,
  last_used_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP(3),
  revoked_reason TEXT,
  rotated_from_id UUID,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_refresh_token_hash_key
  ON pravia_os.auth_sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS auth_sessions_user_revoked_expires_idx
  ON pravia_os.auth_sessions(user_id, revoked_at, expires_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_sessions_user_id_fkey') THEN
    ALTER TABLE pravia_os.auth_sessions
      ADD CONSTRAINT auth_sessions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES pravia_os.users(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pravia_os.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  used_at TIMESTAMP(3),
  requested_ip TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_token_hash_key
  ON pravia_os.password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_used_expires_idx
  ON pravia_os.password_reset_tokens(user_id, used_at, expires_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'password_reset_tokens_user_id_fkey') THEN
    ALTER TABLE pravia_os.password_reset_tokens
      ADD CONSTRAINT password_reset_tokens_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES pravia_os.users(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
