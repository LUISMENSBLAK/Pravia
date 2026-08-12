-- ════════════════════════════════════════════════════════════════
-- MÓDULO COMPARECIENTES (ALTA SESIONADA CON IA) — ROLLBACK COMPLETO
-- Fecha: 2026-07-31
-- Target: PostgreSQL / Supabase
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- 1. ELIMINACIÓN DE TABLAS CREADAS EN ORDEN INVERSO DE DEPENDENCIAS
DROP TABLE IF EXISTS "compareciente_actividades_economicas" CASCADE;
DROP TABLE IF EXISTS "actividades_economicas" CASCADE;
DROP TABLE IF EXISTS "compareciente_aliases" CASCADE;
DROP TABLE IF EXISTS "compareciente_datos_fuente" CASCADE;
DROP TABLE IF EXISTS "storage_compensation_jobs" CASCADE;
DROP TABLE IF EXISTS "carga_temporal_documentos" CASCADE;
DROP TABLE IF EXISTS "compareciente_alta_sessions" CASCADE;

-- 2. REMOCIÓN DE COLUMNA DE TABLA MODIFICADA
ALTER TABLE "personas_fisicas" DROP COLUMN IF EXISTS "pep_estado";

-- 3. ELIMINACIÓN DE ENUMS CREADOS
DROP TYPE IF EXISTS "PepEstado";
DROP TYPE IF EXISTS "CalidadLectura";
DROP TYPE IF EXISTS "DatoFuenteEstado";
DROP TYPE IF EXISTS "StorageCompensationEstatus";
DROP TYPE IF EXISTS "CargaTemporalEstatus";
DROP TYPE IF EXISTS "AltaComparecienteEstatus";

COMMIT;
