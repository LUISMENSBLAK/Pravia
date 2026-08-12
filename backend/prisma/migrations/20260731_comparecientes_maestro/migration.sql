-- ════════════════════════════════════════════════════════════════
-- MÓDULO MAESTRO DE COMPARECIENTES — MIGRACIÓN TRANSACCIONAL DEFINITIVA
-- Fecha: 2026-07-31
-- Target: PostgreSQL / Supabase
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- 1. EXTENSIONES Y ENUMS SEGURAS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TipoPersona') THEN
        CREATE TYPE "TipoPersona" AS ENUM ('FISICA', 'MORAL');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ComparecienteEstatus') THEN
        CREATE TYPE "ComparecienteEstatus" AS ENUM ('ACTIVO', 'INACTIVO', 'SUSPENDIDO', 'ARCHIVADO');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Sexo') THEN
        CREATE TYPE "Sexo" AS ENUM ('MASCULINO', 'FEMENINO', 'OTRO');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EstadoCivil') THEN
        CREATE TYPE "EstadoCivil" AS ENUM ('SOLTERO', 'CASADO', 'DIVORCIADO', 'VIUDO', 'UNION_LIBRE', 'OTRO');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RegimenMatrimonial') THEN
        CREATE TYPE "RegimenMatrimonial" AS ENUM ('SEPARACION_DE_BIENES', 'SOCIEDAD_CONYUGAL', 'SOCIEDAD_LEGAL', 'OTRO');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TipoDomicilio') THEN
        CREATE TYPE "TipoDomicilio" AS ENUM ('PARTICULAR', 'FISCAL', 'SOCIAL', 'CONVENCIONAL', 'OTRO');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TipoContacto') THEN
        CREATE TYPE "TipoContacto" AS ENUM ('TELEFONO', 'WHATSAPP', 'CORREO', 'ALTERNO');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TipoIdentificacion') THEN
        CREATE TYPE "TipoIdentificacion" AS ENUM ('INE', 'PASAPORTE', 'CEDULA_PROFESIONAL', 'DOCUMENTO_MIGRATORIO', 'LICENCIA', 'OTRA');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EstatusIdentificacion') THEN
        CREATE TYPE "EstatusIdentificacion" AS ENUM ('VIGENTE', 'POR_VENCER', 'VENCIDO', 'RECHAZADO');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TipoInstrumentoMoral') THEN
        CREATE TYPE "TipoInstrumentoMoral" AS ENUM ('CONSTITUCION', 'REFORMA', 'PODER', 'ASAMBLEA', 'FUSION', 'OTRO');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EstatusInstrumento') THEN
        CREATE TYPE "EstatusInstrumento" AS ENUM ('HISTORICO', 'VIGENTE_REPRESENTACION', 'SUSTITUIDO', 'REVOCADO', 'PENDIENTE_VALIDACION');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TipoDocumentoCompareciente') THEN
        CREATE TYPE "TipoDocumentoCompareciente" AS ENUM (
            'IDENTIFICACION', 'CURP', 'RFC', 'COMPROBANTE_DOMICILIO', 'ACTA_NACIMIENTO', 
            'ACTA_MATRIMONIO', 'REGIMEN_MATRIMONIAL', 'DOCUMENTO_MIGRATORIO', 'ACTA_CONSTITUTIVA', 
            'REFORMAS', 'PODERES', 'INSCRIPCION_MERCANTIL', 'CONSTANCIA_FISCAL', 'ORGANIGRAMA', 'ASAMBLEAS', 'OTROS'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FormaComparecencia') THEN
        CREATE TYPE "FormaComparecencia" AS ENUM (
            'PROPIO_DERECHO', 'EN_REPRESENTACION_PERSONA_MORAL', 'EN_REPRESENTACION_PERSONA_FISICA', 
            'POR_PROPIO_DERECHO_Y_REPRESENTACION', 'CARACTER_INSTITUCIONAL', 'OTRO'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VinculoEstatus') THEN
        CREATE TYPE "VinculoEstatus" AS ENUM ('ACTIVO', 'INACTIVO', 'SUSTITUIDO', 'CANCELADO');
    ELSE
        BEGIN
            ALTER TYPE "VinculoEstatus" ADD VALUE IF NOT EXISTS 'CANCELADO';
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;
END $$;

-- LIMPIEZA DE TABLAS PREVIAS VACÍAS (PARA ALINEACIÓN NORMALIZADA SEGURA)
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

-- 2. TABLA MAESTRA COMPARECIENTES
CREATE TABLE "comparecientes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tipo_persona" "TipoPersona" NOT NULL DEFAULT 'FISICA',
  "nombre_busqueda" VARCHAR(255) NOT NULL,
  "estatus" "ComparecienteEstatus" NOT NULL DEFAULT 'ACTIVO',
  "creado_por_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "archived_at" TIMESTAMP WITH TIME ZONE,
  "version" INT NOT NULL DEFAULT 1
);

CREATE INDEX "idx_comparecientes_nombre_busqueda" ON "comparecientes"("nombre_busqueda");
CREATE INDEX "idx_comparecientes_tipo_persona" ON "comparecientes"("tipo_persona");

-- 3. PERFIL PERSONA FÍSICA
CREATE TABLE "personas_fisicas" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "compareciente_id" UUID UNIQUE NOT NULL REFERENCES "comparecientes"("id") ON DELETE RESTRICT,
  "nombre" VARCHAR(100) NOT NULL,
  "apellido_paterno" VARCHAR(100),
  "apellido_materno" VARCHAR(100),
  "nombre_completo_calculado" VARCHAR(300) NOT NULL,
  "sexo" "Sexo",
  "fecha_nacimiento" DATE,
  "lugar_nacimiento" VARCHAR(150),
  "nacionalidad" VARCHAR(100) DEFAULT 'Mexicana',
  "curp" VARCHAR(18),
  "rfc" VARCHAR(13),
  "estado_civil" "EstadoCivil",
  "regimen_matrimonial" "RegimenMatrimonial",
  "ocupacion" VARCHAR(150),
  "calidad_migratoria" VARCHAR(100),
  "actividad_economica" VARCHAR(200),
  "requiere_interprete" BOOLEAN DEFAULT FALSE,
  "idioma" VARCHAR(50) DEFAULT 'Español',
  "pep" BOOLEAN DEFAULT FALSE,
  "relacion_pep" VARCHAR(200),
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "archived_at" TIMESTAMP WITH TIME ZONE
);

CREATE INDEX "idx_personas_fisicas_nombre" ON "personas_fisicas"("nombre_completo_calculado");

-- ÍNDICES ÚNICOS PARCIALES CONTROLADOS
CREATE UNIQUE INDEX "uq_persona_fisica_curp_activa" 
ON "personas_fisicas" (UPPER(TRIM("curp"))) 
WHERE "curp" IS NOT NULL AND TRIM("curp") != '' AND "archived_at" IS NULL;

CREATE UNIQUE INDEX "uq_persona_fisica_rfc_activo" 
ON "personas_fisicas" (UPPER(TRIM("rfc"))) 
WHERE "rfc" IS NOT NULL AND TRIM("rfc") != '' AND "archived_at" IS NULL;

-- 4. RELACIÓN CONYUGAL (CON INTEGRIDAD SIMÉTRICA Y PREVENCIÓN DE DUPLICADOS INVERSOS)
CREATE TABLE "relaciones_conyugales" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "persona_1_id" UUID NOT NULL REFERENCES "personas_fisicas"("id") ON DELETE RESTRICT,
  "persona_2_id" UUID NOT NULL REFERENCES "personas_fisicas"("id") ON DELETE RESTRICT,
  "regimen_matrimonial" "RegimenMatrimonial" DEFAULT 'SOCIEDAD_CONYUGAL',
  "fecha_matrimonio" DATE,
  "lugar_matrimonio" VARCHAR(150),
  "documento_soporte_id" UUID REFERENCES "documentos"("id") ON DELETE SET NULL,
  "vigente" BOOLEAN DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "archived_at" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "chk_distintas_personas_conyuges" CHECK ("persona_1_id" != "persona_2_id")
);

-- ÍNDICE SIMÉTRICO PARA EVITAR A->B Y B->A SIMULTÁNEOS
CREATE UNIQUE INDEX "uq_pareja_matrimonial_simetrica" 
ON "relaciones_conyugales" (LEAST("persona_1_id", "persona_2_id"), GREATEST("persona_1_id", "persona_2_id")) 
WHERE "archived_at" IS NULL AND "vigente" = TRUE;

-- 5. PERFIL PERSONA MORAL
CREATE TABLE "personas_morales" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "compareciente_id" UUID UNIQUE NOT NULL REFERENCES "comparecientes"("id") ON DELETE RESTRICT,
  "razon_social" VARCHAR(255) NOT NULL,
  "nombre_comercial" VARCHAR(255),
  "tipo_societario" VARCHAR(100),
  "nacionalidad" VARCHAR(100) DEFAULT 'Mexicana',
  "rfc" VARCHAR(13),
  "fecha_constitucion" DATE,
  "duracion" VARCHAR(100) DEFAULT 'Indefinida',
  "objeto_social_resumido" TEXT,
  "folio_mercantil" VARCHAR(100),
  "fecha_inscripcion_mercantil" DATE,
  "estatus_societario" VARCHAR(50) DEFAULT 'ACTIVA',
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "archived_at" TIMESTAMP WITH TIME ZONE
);

CREATE INDEX "idx_personas_morales_razon" ON "personas_morales"("razon_social");
CREATE INDEX "idx_personas_morales_folio" ON "personas_morales"("folio_mercantil");

CREATE UNIQUE INDEX "uq_persona_moral_rfc_activo" 
ON "personas_morales" (UPPER(TRIM("rfc"))) 
WHERE "rfc" IS NOT NULL AND TRIM("rfc") != '' AND "archived_at" IS NULL;

-- 6. INSTRUMENTOS DE PERSONA MORAL
CREATE TABLE "persona_moral_instrumentos" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "persona_moral_id" UUID NOT NULL REFERENCES "personas_morales"("id") ON DELETE RESTRICT,
  "tipo_instrumento" "TipoInstrumentoMoral" NOT NULL DEFAULT 'CONSTITUCION',
  "estatus_instrumento" "EstatusInstrumento" NOT NULL DEFAULT 'VIGENTE_REPRESENTACION',
  "numero" VARCHAR(50),
  "fecha" DATE,
  "notario_o_corredor" VARCHAR(150),
  "numero_notaria_o_correduria" VARCHAR(50),
  "municipio" VARCHAR(100),
  "estado" VARCHAR(100),
  "folio_mercantil" VARCHAR(100),
  "fecha_inscripcion" DATE,
  "documento_soporte_id" UUID REFERENCES "documentos"("id") ON DELETE SET NULL,
  "vigente" BOOLEAN DEFAULT TRUE,
  "observaciones" TEXT,
  "creado_por_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "validado_por_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "validado_at" TIMESTAMP WITH TIME ZONE,
  "version" INT NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "archived_at" TIMESTAMP WITH TIME ZONE
);

-- 7. DOMICILIOS DE COMPARECIENTE
CREATE TABLE "compareciente_domicilios" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "compareciente_id" UUID NOT NULL REFERENCES "comparecientes"("id") ON DELETE RESTRICT,
  "tipo" "TipoDomicilio" NOT NULL DEFAULT 'PARTICULAR',
  "pais" VARCHAR(100) DEFAULT 'México',
  "estado" VARCHAR(100),
  "municipio" VARCHAR(100),
  "localidad" VARCHAR(100),
  "colonia" VARCHAR(100),
  "calle" VARCHAR(150),
  "exterior" VARCHAR(50),
  "interior" VARCHAR(50),
  "codigo_postal" VARCHAR(10),
  "referencia" TEXT,
  "principal" BOOLEAN DEFAULT TRUE,
  "vigente" BOOLEAN DEFAULT TRUE,
  "fecha_inicio" DATE,
  "fecha_terminacion" DATE,
  "creado_por_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "archived_at" TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX "uq_domicilio_principal_tipo" 
ON "compareciente_domicilios" ("compareciente_id", "tipo") 
WHERE "principal" = TRUE AND "vigente" = TRUE AND "archived_at" IS NULL;

-- 8. CONTACTOS DE COMPARECIENTE
CREATE TABLE "compareciente_contactos" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "compareciente_id" UUID NOT NULL REFERENCES "comparecientes"("id") ON DELETE RESTRICT,
  "tipo" "TipoContacto" NOT NULL DEFAULT 'TELEFONO',
  "valor" VARCHAR(200) NOT NULL,
  "principal" BOOLEAN DEFAULT TRUE,
  "validado" BOOLEAN DEFAULT FALSE,
  "fecha_validacion" TIMESTAMP WITH TIME ZONE,
  "activo" BOOLEAN DEFAULT TRUE,
  "creado_por_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "archived_at" TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX "uq_contacto_principal_tipo" 
ON "compareciente_contactos" ("compareciente_id", "tipo") 
WHERE "principal" = TRUE AND "activo" = TRUE AND "archived_at" IS NULL;

-- 9. IDENTIFICACIONES DE COMPARECIENTE
CREATE TABLE "compareciente_identificaciones" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "compareciente_id" UUID NOT NULL REFERENCES "comparecientes"("id") ON DELETE RESTRICT,
  "tipo_identificacion" "TipoIdentificacion" NOT NULL DEFAULT 'INE',
  "numero" VARCHAR(100),
  "autoridad_emisora" VARCHAR(150),
  "pais_emisor" VARCHAR(100) DEFAULT 'México',
  "fecha_expedicion" DATE,
  "fecha_vencimiento" DATE,
  "principal" BOOLEAN DEFAULT TRUE,
  "documento_id" UUID REFERENCES "documentos"("id") ON DELETE SET NULL,
  "estatus" "EstatusIdentificacion" DEFAULT 'VIGENTE',
  "creado_por_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "validado_por_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "validado_at" TIMESTAMP WITH TIME ZONE,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "archived_at" TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX "uq_identificacion_principal" 
ON "compareciente_identificaciones" ("compareciente_id", "tipo_identificacion") 
WHERE "principal" = TRUE AND "estatus" = 'VIGENTE' AND "archived_at" IS NULL;

-- 10. DOCUMENTOS COMPARECIENTE
CREATE TABLE "compareciente_documentos" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "compareciente_id" UUID NOT NULL REFERENCES "comparecientes"("id") ON DELETE RESTRICT,
  "documento_id" UUID NOT NULL REFERENCES "documentos"("id") ON DELETE RESTRICT,
  "categoria" "TipoDocumentoCompareciente" NOT NULL DEFAULT 'IDENTIFICACION',
  "subcategoria" VARCHAR(100),
  "principal" BOOLEAN DEFAULT FALSE,
  "fecha_documento" DATE,
  "fecha_vencimiento" DATE,
  "fecha_validacion" TIMESTAMP WITH TIME ZONE,
  "validado_por_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "estatus" "VinculoEstatus" DEFAULT 'ACTIVO',
  "observaciones" TEXT,
  "creado_por_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "archived_at" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "uq_compareciente_doc" UNIQUE ("compareciente_id", "documento_id", "categoria")
);

-- 11. CARACTERES Y REPRESENTACIÓN CORPORATIVA
CREATE TABLE "caracteres_representacion" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "clave" VARCHAR(100) UNIQUE NOT NULL,
  "nombre" VARCHAR(150) NOT NULL,
  "descripcion" TEXT,
  "activo" BOOLEAN DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE "persona_moral_representantes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "persona_moral_id" UUID NOT NULL REFERENCES "personas_morales"("id") ON DELETE RESTRICT,
  "representante_persona_fisica_id" UUID NOT NULL REFERENCES "personas_fisicas"("id") ON DELETE RESTRICT,
  "caracter_representacion_id" UUID REFERENCES "caracteres_representacion"("id") ON DELETE SET NULL,
  "cargo_descripcion" VARCHAR(100) NOT NULL,
  "instrumento_id" UUID REFERENCES "persona_moral_instrumentos"("id") ON DELETE SET NULL,
  "fecha_inicio" DATE,
  "fecha_fin" DATE,
  "facultades_resumen" TEXT,
  "vigente" BOOLEAN DEFAULT TRUE,
  "principal" BOOLEAN DEFAULT TRUE,
  "documento_soporte_id" UUID REFERENCES "documentos"("id") ON DELETE SET NULL,
  "observaciones" TEXT,
  "creado_por_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "archived_at" TIMESTAMP WITH TIME ZONE
);

-- 12. CARACTERES COMPARECIENTE Y TIPO DE ACTO
CREATE TABLE "caracteres_compareciente" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "clave" VARCHAR(100) UNIQUE NOT NULL,
  "nombre" VARCHAR(150) NOT NULL,
  "descripcion" TEXT,
  "activo" BOOLEAN DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE "tipo_acto_caracteres_compareciente" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tipo_acto_id" UUID NOT NULL REFERENCES "tipos_acto"("id") ON DELETE RESTRICT,
  "caracter_id" UUID NOT NULL REFERENCES "caracteres_compareciente"("id") ON DELETE RESTRICT,
  "sugerido" BOOLEAN DEFAULT TRUE,
  "orden" INT DEFAULT 0,
  CONSTRAINT "uq_tipo_acto_caracter" UNIQUE ("tipo_acto_id", "caracter_id")
);

-- 13. COMPARECIENTES EN EXPEDIENTE
CREATE TABLE "expediente_comparecientes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "expediente_id" UUID NOT NULL REFERENCES "expedientes"("id") ON DELETE RESTRICT,
  "compareciente_id" UUID NOT NULL REFERENCES "comparecientes"("id") ON DELETE RESTRICT,
  "caracter_id" UUID NOT NULL REFERENCES "caracteres_compareciente"("id") ON DELETE RESTRICT,
  "forma_comparecencia" "FormaComparecencia" DEFAULT 'PROPIO_DERECHO',
  "orden_comparecencia" INT DEFAULT 1,
  "es_principal" BOOLEAN DEFAULT TRUE,
  "observaciones" TEXT,
  "estatus" VARCHAR(50) DEFAULT 'ACTIVO',
  "creado_por_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "archived_at" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "uq_expediente_compareciente_caracter" UNIQUE ("expediente_id", "compareciente_id", "caracter_id", "forma_comparecencia")
);

-- 14. REPRESENTACIÓN EN EXPEDIENTE
CREATE TABLE "expediente_representaciones" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "expediente_id" UUID NOT NULL REFERENCES "expedientes"("id") ON DELETE RESTRICT,
  "representado_compareciente_id" UUID NOT NULL REFERENCES "comparecientes"("id") ON DELETE RESTRICT,
  "representante_compareciente_id" UUID NOT NULL REFERENCES "comparecientes"("id") ON DELETE RESTRICT,
  "expediente_compareciente_representado_id" UUID REFERENCES "expediente_comparecientes"("id") ON DELETE SET NULL,
  "expediente_compareciente_representante_id" UUID REFERENCES "expediente_comparecientes"("id") ON DELETE SET NULL,
  "caracter_representacion_id" UUID REFERENCES "caracteres_representacion"("id") ON DELETE SET NULL,
  "cargo_o_caracter_descripcion" VARCHAR(150) NOT NULL,
  "instrumento_representacion_id" UUID REFERENCES "persona_moral_instrumentos"("id") ON DELETE SET NULL,
  "facultades_aplicables" TEXT,
  "fecha_vigencia" DATE,
  "validada" BOOLEAN DEFAULT FALSE,
  "creado_por_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "validado_por_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "observaciones" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "archived_at" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "chk_distintos_comparecientes_rep" CHECK ("representado_compareciente_id" != "representante_compareciente_id")
);

-- 15. FUNCIÓN TRIGGER PARA GARANTIZAR EXCLUSIVIDAD DE PERFIL (FISICA vs MORAL)
CREATE OR REPLACE FUNCTION fn_check_compareciente_perfil()
RETURNS TRIGGER AS $$
DECLARE
    v_tipo "TipoPersona";
    v_fisica_count INT;
    v_moral_count INT;
BEGIN
    SELECT "tipo_persona" INTO v_tipo FROM "comparecientes" WHERE "id" = NEW."compareciente_id";
    
    SELECT COUNT(*) INTO v_fisica_count FROM "personas_fisicas" WHERE "compareciente_id" = NEW."compareciente_id";
    SELECT COUNT(*) INTO v_moral_count FROM "personas_morales" WHERE "compareciente_id" = NEW."compareciente_id";

    IF v_tipo = 'FISICA' AND v_moral_count > 0 THEN
        RAISE EXCEPTION 'Un compareciente de tipo FISICA no puede poseer un perfil de Persona Moral';
    END IF;

    IF v_tipo = 'MORAL' AND v_fisica_count > 0 THEN
        RAISE EXCEPTION 'Un compareciente de tipo MORAL no puede poseer un perfil de Persona Física';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_persona_fisica_perfil ON "personas_fisicas";
CREATE CONSTRAINT TRIGGER trg_check_persona_fisica_perfil
AFTER INSERT OR UPDATE ON "personas_fisicas"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_check_compareciente_perfil();

DROP TRIGGER IF EXISTS trg_check_persona_moral_perfil ON "personas_morales";
CREATE CONSTRAINT TRIGGER trg_check_persona_moral_perfil
AFTER INSERT OR UPDATE ON "personas_morales"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_check_compareciente_perfil();

COMMIT;
