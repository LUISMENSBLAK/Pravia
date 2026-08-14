-- Fase 14: diferencia sesiones de navegador de sesiones persistentes.
-- Aditiva y compatible con sesiones existentes, que conservan el valor seguro false.
ALTER TABLE "auth_sessions"
ADD COLUMN "persistent" BOOLEAN NOT NULL DEFAULT false;
