-- ════════════════════════════════════════════════════════════════
-- MÓDULO MAESTRO DE COMPARECIENTES — SCRIPT DE ROLLBACK TRANSACCIONAL
-- Fecha: 2026-07-31
-- Target: PostgreSQL / Supabase
-- ════════════════════════════════════════════════════════════════

BEGIN;

DROP TRIGGER IF EXISTS trg_check_persona_moral_perfil ON "personas_morales";
DROP TRIGGER IF EXISTS trg_check_persona_fisica_perfil ON "personas_fisicas";
DROP FUNCTION IF EXISTS fn_check_compareciente_perfil();

DROP TABLE IF EXISTS "expediente_representaciones" CASCADE;
DROP TABLE IF EXISTS "expediente_comparecientes" CASCADE;
DROP TABLE IF EXISTS "tipo_acto_caracteres_compareciente" CASCADE;
DROP TABLE IF EXISTS "caracteres_compareciente" CASCADE;
DROP TABLE IF EXISTS "persona_moral_representantes" CASCADE;
DROP TABLE IF EXISTS "caracteres_representacion" CASCADE;
DROP TABLE IF EXISTS "compareciente_documentos" CASCADE;
DROP TABLE IF EXISTS "compareciente_identificaciones" CASCADE;
DROP TABLE IF EXISTS "compareciente_contactos" CASCADE;
DROP TABLE IF EXISTS "compareciente_domicilios" CASCADE;
DROP TABLE IF EXISTS "persona_moral_instrumentos" CASCADE;
DROP TABLE IF EXISTS "personas_morales" CASCADE;
DROP TABLE IF EXISTS "relaciones_conyugales" CASCADE;
DROP TABLE IF EXISTS "personas_fisicas" CASCADE;
DROP TABLE IF EXISTS "comparecientes" CASCADE;

DROP TYPE IF EXISTS "FormaComparecencia";
DROP TYPE IF EXISTS "TipoDocumentoCompareciente";
DROP TYPE IF EXISTS "EstatusInstrumento";
DROP TYPE IF EXISTS "TipoInstrumentoMoral";
DROP TYPE IF EXISTS "EstatusIdentificacion";
DROP TYPE IF EXISTS "TipoIdentificacion";
DROP TYPE IF EXISTS "TipoContacto";
DROP TYPE IF EXISTS "TipoDomicilio";
DROP TYPE IF EXISTS "RegimenMatrimonial";
DROP TYPE IF EXISTS "EstadoCivil";
DROP TYPE IF EXISTS "Sexo";
DROP TYPE IF EXISTS "ComparecienteEstatus";
DROP TYPE IF EXISTS "TipoPersona";

COMMIT;
