-- ════════════════════════════════════════════════════════════════
-- MÓDULO COMPARECIENTES (ALTA SESIONADA CON IA & TRAZABILIDAD) — MIGRACIÓN TRANSACCIONAL
-- Fecha: 2026-07-31
-- Target: PostgreSQL / Supabase
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- 1. ENUMS REQUERIDOS
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AltaComparecienteEstatus') THEN
        CREATE TYPE "AltaComparecienteEstatus" AS ENUM (
            'BORRADOR', 'EN_EXTRACCION', 'PENDIENTE_CONFIRMACION', 'GUARDANDO', 
            'COMPLETADO', 'CANCELADO', 'EXPIRADO', 'FALLIDO'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CargaTemporalEstatus') THEN
        CREATE TYPE "CargaTemporalEstatus" AS ENUM (
            'TEMPORAL', 'PROCESADO', 'CONFIRMADO', 'DESCARTADO'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StorageCompensationEstatus') THEN
        CREATE TYPE "StorageCompensationEstatus" AS ENUM (
            'PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'FALLIDO'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DatoFuenteEstado') THEN
        CREATE TYPE "DatoFuenteEstado" AS ENUM (
            'NO_ENCONTRADO', 'DETECTADO', 'PENDIENTE_CONFIRMACION', 'CONFIRMADO', 
            'EDITADO_MANUALMENTE', 'EN_CONFLICTO', 'DESCARTADO'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CalidadLectura') THEN
        CREATE TYPE "CalidadLectura" AS ENUM (
            'LECTURA_CLARA', 'LECTURA_DUDOSA', 'LECTURA_DEFICIENTE'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PepEstado') THEN
        CREATE TYPE "PepEstado" AS ENUM (
            'PENDIENTE', 'SI', 'NO'
        );
    END IF;
END $$;

-- 2. MODIFICACIÓN SEGURA DE TABLA EXISTENTE (personas_fisicas)
ALTER TABLE "personas_fisicas" 
ADD COLUMN IF NOT EXISTS "pep_estado" "PepEstado" NOT NULL DEFAULT 'PENDIENTE';

-- 3. CREACIÓN DE TABLAS DE SESIÓN Y CARGAS TEMPORALES

-- Tabla: compareciente_alta_sessions
CREATE TABLE IF NOT EXISTS "compareciente_alta_sessions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "tipo_persona" "TipoPersona",
    "estatus" "AltaComparecienteEstatus" NOT NULL DEFAULT 'BORRADOR',
    "origen_expediente_id" UUID,
    "idempotency_key" TEXT,
    "correlation_id" TEXT,
    "borrador_json" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ultima_actividad_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmado_at" TIMESTAMP(3),
    "cancelado_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "fk_alta_session_usuario" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_alta_session_expediente" FOREIGN KEY ("origen_expediente_id") REFERENCES "expedientes"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "compareciente_alta_sessions_usuario_idempotency_key" 
ON "compareciente_alta_sessions"("usuario_id", "idempotency_key") 
WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_alta_sessions_usuario_estatus" 
ON "compareciente_alta_sessions"("usuario_id", "estatus");

CREATE INDEX IF NOT EXISTS "idx_alta_sessions_expires_at" 
ON "compareciente_alta_sessions"("expires_at");

-- Tabla: carga_temporal_documentos
CREATE TABLE IF NOT EXISTS "carga_temporal_documentos" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "alta_session_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "tipo_documento" TEXT NOT NULL,
    "nombre_original" TEXT NOT NULL,
    "storage_key_temporal" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "estado" "CargaTemporalEstatus" NOT NULL DEFAULT 'TEMPORAL',
    "intentos_limpieza" INTEGER NOT NULL DEFAULT 0,
    "ultimo_error_limpieza" TEXT,
    "limpieza_programada_at" TIMESTAMP(3),
    "eliminado_storage_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "fk_carga_temporal_session" FOREIGN KEY ("alta_session_id") REFERENCES "compareciente_alta_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fk_carga_temporal_usuario" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_cargas_temporales_session" 
ON "carga_temporal_documentos"("alta_session_id");

CREATE INDEX IF NOT EXISTS "idx_cargas_temporales_usuario" 
ON "carga_temporal_documentos"("usuario_id");

CREATE INDEX IF NOT EXISTS "idx_cargas_temporales_estado" 
ON "carga_temporal_documentos"("estado");

-- Tabla: storage_compensation_jobs
CREATE TABLE IF NOT EXISTS "storage_compensation_jobs" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "carga_temporal_id" UUID,
    "storage_key" TEXT NOT NULL,
    "tipo_operacion" TEXT NOT NULL DEFAULT 'ELIMINAR_TEMPORAL',
    "estatus" "StorageCompensationEstatus" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ultimo_error" TEXT,
    "proxima_ejecucion_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fk_storage_job_carga_temporal" FOREIGN KEY ("carga_temporal_id") REFERENCES "carga_temporal_documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_storage_compensation_jobs_estatus_exec" 
ON "storage_compensation_jobs"("estatus", "proxima_ejecucion_at");

-- Tabla: compareciente_datos_fuente
CREATE TABLE IF NOT EXISTS "compareciente_datos_fuente" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "compareciente_id" UUID NOT NULL,
    "campo" TEXT NOT NULL,
    "entidad_destino" TEXT,
    "registro_destino_id" TEXT,
    "valor_detectado" TEXT,
    "valor_confirmado" TEXT,
    "documento_id" UUID,
    "carga_temporal_id" UUID,
    "pagina" INTEGER,
    "fragmento_fuente" TEXT,
    "proveedor_ia" TEXT,
    "modelo_ia" TEXT,
    "confianza" "CalidadLectura",
    "estado" "DatoFuenteEstado" NOT NULL DEFAULT 'DETECTADO',
    "confirmado_por_id" UUID,
    "confirmado_at" TIMESTAMP(3),
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "fk_datos_fuente_compareciente" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_datos_fuente_documento" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fk_datos_fuente_carga_temporal" FOREIGN KEY ("carga_temporal_id") REFERENCES "carga_temporal_documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fk_datos_fuente_confirmador" FOREIGN KEY ("confirmado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_compareciente_datos_fuente_comp" 
ON "compareciente_datos_fuente"("compareciente_id");

CREATE INDEX IF NOT EXISTS "idx_compareciente_datos_fuente_campo" 
ON "compareciente_datos_fuente"("campo");

-- Tabla: compareciente_aliases
CREATE TABLE IF NOT EXISTS "compareciente_aliases" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "compareciente_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "tipo" TEXT DEFAULT 'COMERCIAL_O_CONOCIDO',
    "principal" BOOLEAN NOT NULL DEFAULT FALSE,
    "activo" BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "fk_compareciente_aliases_comp" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_compareciente_aliases_comp" 
ON "compareciente_aliases"("compareciente_id");

CREATE INDEX IF NOT EXISTS "idx_compareciente_aliases_alias" 
ON "compareciente_aliases"("alias");

-- Tabla: actividades_economicas
CREATE TABLE IF NOT EXISTS "actividades_economicas" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "clave" TEXT UNIQUE NOT NULL,
    "descripcion" TEXT NOT NULL,
    "sector" TEXT,
    "vigente" BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_actividades_economicas_clave" 
ON "actividades_economicas"("clave");

CREATE INDEX IF NOT EXISTS "idx_actividades_economicas_descripcion" 
ON "actividades_economicas"("descripcion");

-- Tabla: compareciente_actividades_economicas
CREATE TABLE IF NOT EXISTS "compareciente_actividades_economicas" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "compareciente_id" UUID NOT NULL,
    "actividad_id" UUID NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT TRUE,
    "fecha_inicio" TIMESTAMP(3),
    "fecha_fin" TIMESTAMP(3),
    "fuente" TEXT,
    "vigente" BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fk_comp_actividades_comp" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fk_comp_actividades_act" FOREIGN KEY ("actividad_id") REFERENCES "actividades_economicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "uq_compareciente_actividad" UNIQUE ("compareciente_id", "actividad_id")
);

COMMIT;
