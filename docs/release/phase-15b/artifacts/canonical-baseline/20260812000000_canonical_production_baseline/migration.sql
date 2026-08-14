-- PRAVIA OS canonical production baseline (S0).
-- Generated from structural, read-only production introspection on 2026-08-13.
-- This is a new canonical starting point, NOT a reconstruction of either lost legacy migration.
-- It contains no production rows, identifiers, credentials, ownership or grants.
CREATE SCHEMA IF NOT EXISTS "pravia_os";
SET search_path TO "pravia_os", public;

-- CreateEnum
CREATE TYPE "AltaComparecienteEstatus" AS ENUM ('BORRADOR', 'EN_EXTRACCION', 'PENDIENTE_CONFIRMACION', 'GUARDANDO', 'COMPLETADO', 'CANCELADO', 'EXPIRADO', 'FALLIDO');

-- CreateEnum
CREATE TYPE "CalidadLectura" AS ENUM ('LECTURA_CLARA', 'LECTURA_DUDOSA', 'LECTURA_DEFICIENTE');

-- CreateEnum
CREATE TYPE "CargaTemporalEstatus" AS ENUM ('TEMPORAL', 'PROCESADO', 'CONFIRMADO', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "CategoriaIngreso" AS ENUM ('HONORARIOS_ESPERADOS', 'HONORARIOS_RECIBIDOS', 'INGRESO_REAL_RECIBIDO', 'ANTICIPO_NOTARIA', 'PAGO_NOTARIA');

-- CreateEnum
CREATE TYPE "ComparecePor" AS ENUM ('PROPIO_DERECHO', 'REPRESENTACION');

-- CreateEnum
CREATE TYPE "ComparecienteEstatus" AS ENUM ('ACTIVO', 'INACTIVO', 'SUSPENDIDO', 'ARCHIVADO');

-- CreateEnum
CREATE TYPE "CotizacionEstado" AS ENUM ('BORRADOR', 'ENVIADA_NOTARIA', 'PRESUPUESTO_RECIBIDO', 'EN_REVISION_ABOGADO', 'ENVIADA_CLIENTE', 'EN_NEGOCIACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CONVERTIDA_EXPEDIENTE');

-- CreateEnum
CREATE TYPE "DatoFuenteEstado" AS ENUM ('NO_ENCONTRADO', 'DETECTADO', 'PENDIENTE_CONFIRMACION', 'CONFIRMADO', 'EDITADO_MANUALMENTE', 'EN_CONFLICTO', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "DocCategoria" AS ENUM ('PROYECTO', 'FIRMA', 'REGISTRO', 'CATASTRO', 'UIF', 'BANCO', 'SAT', 'FIDEICOMISO', 'OTROS');

-- CreateEnum
CREATE TYPE "DocEstatus" AS ENUM ('PENDIENTE', 'VIGENTE', 'POR_VENCER', 'VENCIDO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "EstadoCivil" AS ENUM ('SOLTERO', 'CASADO', 'DIVORCIADO', 'VIUDO', 'UNION_LIBRE', 'OTRO');

-- CreateEnum
CREATE TYPE "EstatusIdentificacion" AS ENUM ('VIGENTE', 'POR_VENCER', 'VENCIDO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "EstatusInstrumento" AS ENUM ('HISTORICO', 'VIGENTE_REPRESENTACION', 'SUSTITUIDO', 'REVOCADO', 'PENDIENTE_VALIDACION');

-- CreateEnum
CREATE TYPE "EstatusMovimiento" AS ENUM ('PENDIENTE', 'RECIBIDO', 'VALIDADO', 'RECHAZADO', 'REVERTIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "EventoAgendaEstatus" AS ENUM ('ACTIVO', 'COMPLETADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "ExpedienteEstatus" AS ENUM ('ABIERTO', 'EN_INTEGRACION', 'EN_PROCESO', 'PENDIENTE_CLIENTE', 'PENDIENTE_NOTARIA', 'FIRMA_PROGRAMADA', 'FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'ENTREGADO', 'SUSPENDIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "FormaComparecencia" AS ENUM ('PROPIO_DERECHO', 'EN_REPRESENTACION_PERSONA_MORAL', 'EN_REPRESENTACION_PERSONA_FISICA', 'POR_PROPIO_DERECHO_Y_REPRESENTACION', 'CARACTER_INSTITUCIONAL', 'OTRO');

-- CreateEnum
CREATE TYPE "NaturalezaMovimiento" AS ENUM ('INGRESO', 'EGRESO');

-- CreateEnum
CREATE TYPE "NotaEstatus" AS ENUM ('PENDIENTE', 'COMPLETADA', 'POSPUESTA');

-- CreateEnum
CREATE TYPE "NotaPrioridad" AS ENUM ('BAJA', 'MEDIA', 'ALTA');

-- CreateEnum
CREATE TYPE "OutboxEstatus" AS ENUM ('PENDIENTE', 'PROCESANDO', 'PROCESADO', 'FALLIDO');

-- CreateEnum
CREATE TYPE "PagoEstatus" AS ENUM ('PENDIENTE', 'RECIBIDO', 'PARCIAL', 'CANCELADO', 'VALIDADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "PepEstado" AS ENUM ('PENDIENTE', 'SI', 'NO');

-- CreateEnum
CREATE TYPE "ProcessingLogEstatus" AS ENUM ('PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'FALLIDO');

-- CreateEnum
CREATE TYPE "ProspectoEstado" AS ENUM ('NUEVO', 'INFO_PENDIENTE', 'DOCS_RECIBIDOS', 'EN_REVISION', 'COTIZACION_SOLICITADA', 'COTIZACION_ENVIADA', 'SEGUIMIENTO', 'ACEPTADO', 'PERDIDO', 'CANCELADO', 'ARCHIVADO');

-- CreateEnum
CREATE TYPE "ProspectoPrioridad" AS ENUM ('BAJA', 'MEDIA', 'ALTA');

-- CreateEnum
CREATE TYPE "RegimenMatrimonial" AS ENUM ('SEPARACION_DE_BIENES', 'SOCIEDAD_CONYUGAL', 'SOCIEDAD_LEGAL', 'OTRO');

-- CreateEnum
CREATE TYPE "RequisitoDocEstatus" AS ENUM ('PENDIENTE', 'RECIBIDO', 'EN_REVISION', 'VALIDADO', 'RECHAZADO', 'VENCIDO', 'OMITIDO_JUSTIFICADO');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('DIRECCION', 'ADMINISTRACION', 'ABOGADO', 'RECEPCION', 'GESTORIA', 'CONSULTA');

-- CreateEnum
CREATE TYPE "Sexo" AS ENUM ('MASCULINO', 'FEMENINO', 'OTRO');

-- CreateEnum
CREATE TYPE "StorageCompensationEstatus" AS ENUM ('PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'FALLIDO');

-- CreateEnum
CREATE TYPE "TareaEstatus" AS ENUM ('PENDIENTE', 'EN_PROCESO', 'COMPLETADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TareaExternaEstatus" AS ENUM ('PENDIENTE', 'EN_PROCESO', 'COMPLETADA', 'BLOQUEADA');

-- CreateEnum
CREATE TYPE "TareaPrioridad" AS ENUM ('BAJA', 'MEDIA', 'ALTA', 'URGENTE');

-- CreateEnum
CREATE TYPE "TipoActividad" AS ENUM ('CAMBIO_ESTATUS', 'CAMBIO_ETAPA', 'SEGUIMIENTO', 'DOCUMENTO', 'PAGO', 'TAREA', 'COMUNICACION', 'COMPARECIENTE', 'AUDITORIA');

-- CreateEnum
CREATE TYPE "TipoContacto" AS ENUM ('TELEFONO', 'WHATSAPP', 'CORREO', 'ALTERNO');

-- CreateEnum
CREATE TYPE "TipoDocumentoCompareciente" AS ENUM ('IDENTIFICACION', 'CURP', 'RFC', 'COMPROBANTE_DOMICILIO', 'ACTA_NACIMIENTO', 'ACTA_MATRIMONIO', 'REGIMEN_MATRIMONIAL', 'DOCUMENTO_MIGRATORIO', 'ACTA_CONSTITUTIVA', 'REFORMAS', 'PODERES', 'INSCRIPCION_MERCANTIL', 'CONSTANCIA_FISCAL', 'ORGANIGRAMA', 'ASAMBLEAS', 'OTROS');

-- CreateEnum
CREATE TYPE "TipoDomicilio" AS ENUM ('PARTICULAR', 'FISCAL', 'SOCIAL', 'CONVENCIONAL', 'OTRO');

-- CreateEnum
CREATE TYPE "TipoEvento" AS ENUM ('PERSONAL', 'DESPACHO', 'FIRMA', 'AUDIENCIA', 'VENCIMIENTO', 'CITA', 'NOTARIA', 'SEGUIMIENTO', 'OTRO');

-- CreateEnum
CREATE TYPE "TipoIdentificacion" AS ENUM ('INE', 'PASAPORTE', 'CEDULA_PROFESIONAL', 'DOCUMENTO_MIGRATORIO', 'LICENCIA', 'OTRA');

-- CreateEnum
CREATE TYPE "TipoInstrumentoMoral" AS ENUM ('CONSTITUCION', 'REFORMA', 'PODER', 'ASAMBLEA', 'FUSION', 'OTRO');

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('PAGO_UNICO', 'ANTICIPO', 'ABONO', 'PAGO_CONTRA_FIRMA', 'PAGO_CONTRA_ENTREGA', 'AJUSTE', 'DEVOLUCION', 'EGRESO_NOTARIA', 'EGRESO_TERCEROS');

-- CreateEnum
CREATE TYPE "TipoPersona" AS ENUM ('FISICA', 'MORAL');

-- CreateEnum
CREATE TYPE "TipoTareaExterna" AS ENUM ('CATASTRO', 'REGISTRO_PUBLICO', 'BANCO', 'NOTARIA', 'OTRA_GESTION');

-- CreateEnum
CREATE TYPE "VinculoEstatus" AS ENUM ('ACTIVO', 'INACTIVO', 'SUSTITUIDO', 'CANCELADO');

-- CreateTable
CREATE TABLE "actividades_economicas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clave" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "sector" TEXT,
    "vigente" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actividades_economicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL DEFAULT 'OPENAI',
    "modelo" TEXT NOT NULL,
    "operacion" TEXT NOT NULL,
    "estatus" TEXT NOT NULL DEFAULT 'COMPLETADO',
    "usuario_id" UUID,
    "expediente_id" UUID,
    "compareciente_alta_session_id" UUID,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "reasoning_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "duracion_ms" INTEGER NOT NULL DEFAULT 0,
    "costo_estimado_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "documentos_enviados" INTEGER NOT NULL DEFAULT 0,
    "escalamiento_utilizado" BOOLEAN NOT NULL DEFAULT false,
    "escalamiento_motivo" TEXT,
    "error_codigo" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" UUID NOT NULL,
    "detalles" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlation_id" UUID,
    "event_id" UUID,
    "ip_address" TEXT,
    "session_id" TEXT,
    "user_agent" TEXT,
    "valores_anteriores" JSONB,
    "valores_nuevos" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "rotated_from_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caracteres_compareciente" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clave" VARCHAR(100) NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caracteres_compareciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caracteres_representacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clave" VARCHAR(100) NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caracteres_representacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carga_temporal_documentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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

    CONSTRAINT "carga_temporal_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" UUID NOT NULL,
    "tipo_acto_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "categoria" "DocCategoria" NOT NULL DEFAULT 'PROYECTO',
    "obligatorio" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compareciente_actividades_economicas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "compareciente_id" UUID NOT NULL,
    "actividad_id" UUID NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT true,
    "fecha_inicio" TIMESTAMP(3),
    "fecha_fin" TIMESTAMP(3),
    "fuente" TEXT,
    "vigente" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compareciente_actividades_economicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compareciente_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "compareciente_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "tipo" TEXT DEFAULT 'COMERCIAL_O_CONOCIDO',
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "compareciente_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compareciente_alta_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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

    CONSTRAINT "compareciente_alta_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compareciente_contactos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "compareciente_id" UUID NOT NULL,
    "tipo" "TipoContacto" NOT NULL DEFAULT 'TELEFONO',
    "valor" VARCHAR(200) NOT NULL,
    "principal" BOOLEAN DEFAULT true,
    "validado" BOOLEAN DEFAULT false,
    "fecha_validacion" TIMESTAMPTZ(6),
    "activo" BOOLEAN DEFAULT true,
    "creado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "compareciente_contactos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compareciente_datos_fuente" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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

    CONSTRAINT "compareciente_datos_fuente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compareciente_documentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "compareciente_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "categoria" "TipoDocumentoCompareciente" NOT NULL DEFAULT 'IDENTIFICACION',
    "subcategoria" VARCHAR(100),
    "principal" BOOLEAN DEFAULT false,
    "fecha_documento" DATE,
    "fecha_vencimiento" DATE,
    "fecha_validacion" TIMESTAMPTZ(6),
    "validado_por_id" UUID,
    "estatus" "VinculoEstatus" DEFAULT 'ACTIVO',
    "observaciones" TEXT,
    "creado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "compareciente_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compareciente_domicilios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "compareciente_id" UUID NOT NULL,
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
    "principal" BOOLEAN DEFAULT true,
    "vigente" BOOLEAN DEFAULT true,
    "fecha_inicio" DATE,
    "fecha_terminacion" DATE,
    "creado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "comprobado" BOOLEAN NOT NULL DEFAULT false,
    "documento_comprobante_id" UUID,

    CONSTRAINT "compareciente_domicilios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compareciente_identificaciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "compareciente_id" UUID NOT NULL,
    "tipo_identificacion" "TipoIdentificacion" NOT NULL DEFAULT 'INE',
    "numero" VARCHAR(100),
    "autoridad_emisora" VARCHAR(150),
    "pais_emisor" VARCHAR(100) DEFAULT 'México',
    "fecha_expedicion" DATE,
    "fecha_vencimiento" DATE,
    "principal" BOOLEAN DEFAULT true,
    "documento_id" UUID,
    "estatus" "EstatusIdentificacion" DEFAULT 'VIGENTE',
    "creado_por_id" UUID NOT NULL,
    "validado_por_id" UUID,
    "validado_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "compareciente_identificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparecientes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo_persona" "TipoPersona" NOT NULL DEFAULT 'FISICA',
    "nombre_busqueda" VARCHAR(255) NOT NULL,
    "estatus" "ComparecienteEstatus" NOT NULL DEFAULT 'ACTIVO',
    "creado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "comparecientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "review_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "tipo_evidencia" TEXT NOT NULL,
    "observaciones" TEXT,
    "agregado_por_id" UUID NOT NULL,
    "estatus" TEXT NOT NULL DEFAULT 'ACTIVO',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "expediente_id" UUID NOT NULL,
    "rule_set_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "estatus" TEXT NOT NULL DEFAULT 'BORRADOR',
    "fecha_operacion" TIMESTAMP(3),
    "rule_version_snapshot" TEXT NOT NULL,
    "cuestionario_json" JSONB NOT NULL,
    "resultado_json" JSONB,
    "explicacion" TEXT,
    "creado_por_id" UUID NOT NULL,
    "revisado_por_id" UUID,
    "revisado_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_rule_sets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "estatus" TEXT NOT NULL DEFAULT 'BORRADOR',
    "vigencia_desde" TIMESTAMP(3) NOT NULL,
    "vigencia_hasta" TIMESTAMP(3),
    "fuente_nombre" TEXT NOT NULL,
    "fuente_url" TEXT NOT NULL,
    "fuente_publicada_at" TIMESTAMP(3),
    "parametros" JSONB NOT NULL,
    "cuestionario" JSONB NOT NULL,
    "notas" TEXT,
    "creado_por_id" UUID NOT NULL,
    "aprobado_por_id" UUID,
    "aprobado_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comunicacion_documentos" (
    "id" UUID NOT NULL,
    "comunicacion_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "tipo_vinculo" TEXT NOT NULL,
    "fecha_vinculo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" UUID NOT NULL,
    "estatus" "VinculoEstatus" NOT NULL DEFAULT 'ACTIVO',
    "inactivado_at" TIMESTAMP(3),
    "inactivado_por_id" UUID,
    "motivo_inactivacion" TEXT,
    "observaciones" TEXT,

    CONSTRAINT "comunicacion_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comunicaciones" (
    "id" UUID NOT NULL,
    "expediente_id" UUID,
    "user_id" UUID NOT NULL,
    "canal" TEXT NOT NULL,
    "destinatario" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "enviado" BOOLEAN NOT NULL DEFAULT false,
    "fecha_envio" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comunicaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cotizacion_documentos" (
    "id" UUID NOT NULL,
    "cotizacion_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "tipo_vinculo" TEXT NOT NULL,
    "fecha_vinculo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" UUID NOT NULL,
    "estatus" "VinculoEstatus" NOT NULL DEFAULT 'ACTIVO',
    "inactivado_at" TIMESTAMP(3),
    "inactivado_por_id" UUID,
    "motivo_inactivacion" TEXT,
    "observaciones" TEXT,

    CONSTRAINT "cotizacion_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cotizacion_seguimientos" (
    "id" UUID NOT NULL,
    "cotizacion_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "destinatario" TEXT NOT NULL,
    "resumen" TEXT NOT NULL,
    "resultado" TEXT,
    "proxima_accion" TEXT,
    "responsable" TEXT,
    "fecha_proximo_seguimiento" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cotizacion_seguimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cotizacion_versiones" (
    "id" UUID NOT NULL,
    "cotizacion_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "total_cliente" DECIMAL(14,2) NOT NULL,
    "notas" TEXT,
    "pdf_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creada_por_id" UUID,
    "desglose_notaria" JSONB,
    "desglose_pravia" JSONB,
    "honorarios_pravia" DECIMAL(14,2) NOT NULL,
    "montos_extraidos_ia" JSONB,
    "total_notaria" DECIMAL(14,2) NOT NULL,
    "aprobada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "cotizacion_versiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cotizaciones" (
    "id" UUID NOT NULL,
    "prospecto_id" UUID,
    "user_id" UUID NOT NULL,
    "estado" "CotizacionEstado" NOT NULL DEFAULT 'BORRADOR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cuerpo_correo_cliente" TEXT,
    "cuerpo_correo_notaria" TEXT,
    "fecha_aceptacion_cliente" TIMESTAMP(3),
    "fecha_enviada_cliente" TIMESTAMP(3),
    "fecha_limite_respuesta_notaria" TIMESTAMP(3),
    "fecha_presupuesto_recibido" TIMESTAMP(3),
    "fecha_solicitud_notaria" TIMESTAMP(3),
    "honorarios_pravia" DECIMAL(14,2),
    "notaria_id" UUID,
    "numero_cotizacion" TEXT,
    "numero_solicitud" TEXT,
    "total_cliente" DECIMAL(14,2),
    "total_notaria" DECIMAL(14,2),
    "version_actual" INTEGER NOT NULL DEFAULT 1,
    "fecha_aprobacion_version" TIMESTAMP(3),
    "fecha_conversion_expediente" TIMESTAMP(3),

    CONSTRAINT "cotizaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos" (
    "id" UUID NOT NULL,
    "nombre_original" TEXT NOT NULL,
    "nombre_interno" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "categoria" "DocCategoria" NOT NULL DEFAULT 'PROYECTO',
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "fecha_carga" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_emision" TIMESTAMP(3),
    "fecha_vigencia" TIMESTAMP(3),
    "observaciones" TEXT,
    "datos_extraidos" JSONB,
    "estatus" "DocEstatus" NOT NULL DEFAULT 'PENDIENTE',
    "subido_por_id" UUID NOT NULL,
    "prospecto_id" UUID,
    "cotizacion_id" UUID,
    "expediente_id" UUID,
    "compareciente_id" UUID,

    CONSTRAINT "documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_event_outbox" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL DEFAULT 'Expediente',
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "actor_user_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "estatus" "OutboxEstatus" NOT NULL DEFAULT 'PENDIENTE',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_event_processing_logs" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "handler_name" TEXT NOT NULL,
    "estatus" "ProcessingLogEstatus" NOT NULL DEFAULT 'PENDIENTE',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "correlation_id" UUID,

    CONSTRAINT "domain_event_processing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_agenda" (
    "id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "tipo" "TipoEvento" NOT NULL,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3),
    "todo_el_dia" BOOLEAN NOT NULL DEFAULT false,
    "user_id" UUID,
    "expediente_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_id" UUID,
    "idempotency_key" TEXT,
    "estatus" "EventoAgendaEstatus" NOT NULL DEFAULT 'ACTIVO',
    "compareciente_id" UUID,
    "recordatorios" JSONB,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelado_at" TIMESTAMP(6),
    "cancelado_por_id" UUID,
    "motivo_cancelacion" TEXT,

    CONSTRAINT "eventos_agenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expediente_actividades" (
    "id" UUID NOT NULL,
    "expediente_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "tipo" "TipoActividad" NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "metadatos" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expediente_actividades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expediente_comparecientes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "expediente_id" UUID NOT NULL,
    "compareciente_id" UUID NOT NULL,
    "caracter_id" UUID NOT NULL,
    "forma_comparecencia" "FormaComparecencia" DEFAULT 'PROPIO_DERECHO',
    "orden_comparecencia" INTEGER DEFAULT 1,
    "es_principal" BOOLEAN DEFAULT true,
    "observaciones" TEXT,
    "estatus" VARCHAR(50) DEFAULT 'ACTIVO',
    "creado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "datos_validados" BOOLEAN NOT NULL DEFAULT false,
    "validado_por_id" UUID,
    "validado_at" TIMESTAMPTZ(6),

    CONSTRAINT "expediente_comparecientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expediente_documentos" (
    "id" UUID NOT NULL,
    "expediente_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "tipo_vinculo" TEXT NOT NULL,
    "fecha_vinculo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" UUID NOT NULL,
    "estatus" "VinculoEstatus" NOT NULL DEFAULT 'ACTIVO',
    "inactivado_at" TIMESTAMP(3),
    "inactivado_por_id" UUID,
    "motivo_inactivacion" TEXT,
    "observaciones" TEXT,

    CONSTRAINT "expediente_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expediente_estatus_log" (
    "id" UUID NOT NULL,
    "expediente_id" UUID NOT NULL,
    "estatus_anterior" "ExpedienteEstatus",
    "estatus_nuevo" "ExpedienteEstatus" NOT NULL,
    "user_id" UUID NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_efectiva" TIMESTAMP(3),
    "notas" TEXT,

    CONSTRAINT "expediente_estatus_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expediente_etapas" (
    "id" UUID NOT NULL,
    "expediente_id" UUID NOT NULL,
    "flujo_etapa_id" UUID,
    "flujo_version_id" UUID,
    "clave_snapshot" TEXT NOT NULL,
    "nombre_snapshot" TEXT NOT NULL,
    "orden_snapshot" INTEGER NOT NULL DEFAULT 1,
    "duracion_esperada_snapshot" INTEGER,
    "fecha_inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_fin" TIMESTAMP(3),
    "duracion_dias_naturales" DOUBLE PRECISION,
    "duracion_horas" DOUBLE PRECISION,
    "responsable_id" UUID,
    "observaciones" TEXT,
    "evidencia_url" TEXT,
    "motivo_retraso" TEXT,
    "completada" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expediente_etapas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expediente_representaciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "expediente_id" UUID NOT NULL,
    "representado_compareciente_id" UUID NOT NULL,
    "representante_compareciente_id" UUID NOT NULL,
    "expediente_compareciente_representado_id" UUID,
    "expediente_compareciente_representante_id" UUID,
    "caracter_representacion_id" UUID,
    "cargo_o_caracter_descripcion" VARCHAR(150) NOT NULL,
    "instrumento_representacion_id" UUID,
    "facultades_aplicables" TEXT,
    "fecha_vigencia" DATE,
    "validada" BOOLEAN DEFAULT false,
    "creado_por_id" UUID NOT NULL,
    "validado_por_id" UUID,
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "expediente_representaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expediente_requisitos_doc" (
    "id" UUID NOT NULL,
    "expediente_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" "DocCategoria" NOT NULL DEFAULT 'PROYECTO',
    "obligatorio" BOOLEAN NOT NULL DEFAULT true,
    "estatus" "RequisitoDocEstatus" NOT NULL DEFAULT 'PENDIENTE',
    "fecha_vencimiento" TIMESTAMP(3),
    "responsable_entrega" TEXT,
    "observaciones" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expediente_requisitos_doc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expedientes" (
    "id" UUID NOT NULL,
    "numero_pravia" TEXT NOT NULL,
    "numero_notaria" TEXT,
    "tipo_acto_id" UUID NOT NULL,
    "abogado_id" UUID NOT NULL,
    "creador_id" UUID NOT NULL,
    "cotizacion_id" UUID,
    "cliente_alias" TEXT,
    "fecha_apertura" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estatus" "ExpedienteEstatus" NOT NULL DEFAULT 'ABIERTO',
    "archived_at" TIMESTAMP(3),
    "archived_by" UUID,
    "avance_documental" INTEGER NOT NULL DEFAULT 0,
    "avance_financiero" INTEGER NOT NULL DEFAULT 0,
    "avance_general" INTEGER NOT NULL DEFAULT 0,
    "avance_operativo" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "datos_operacion" JSONB,
    "descripcion" TEXT,
    "etapa_actual_nombre" TEXT DEFAULT 'Apertura de Expediente',
    "expediente_etapa_actual_id" UUID,
    "fecha_entrega_cliente" TIMESTAMP(3),
    "fecha_estimada_firma" TIMESTAMP(3),
    "fecha_limite_accion" TIMESTAMP(3),
    "fecha_real_firma" TIMESTAMP(3),
    "flujo_version_id" UUID,
    "formulario_version_id" UUID,
    "gestor_id" UUID,
    "motivo_archivo" TEXT,
    "notaria_id" UUID,
    "plantilla_doc_version_id" UUID,
    "proxima_accion" TEXT,
    "subtipo_acto" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valor_operacion" DECIMAL(14,2),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "expedientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flujo_etapas" (
    "id" UUID NOT NULL,
    "tipo_acto_id" UUID NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 1,
    "obligatoria" BOOLEAN NOT NULL DEFAULT true,
    "se_puede_omitir" BOOLEAN NOT NULL DEFAULT false,
    "duracion_esperada_dias" INTEGER NOT NULL DEFAULT 3,
    "estado_general_relacionado" TEXT NOT NULL,
    "etapa_siguiente_id" UUID,
    "reglas_entrada_json" JSONB,
    "reglas_salida_json" JSONB,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "flujo_etapas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flujo_versiones" (
    "id" UUID NOT NULL,
    "tipo_acto_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "etapas_json" JSONB NOT NULL,
    "ponderaciones_json" JSONB,
    "vigente_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" UUID NOT NULL,

    CONSTRAINT "flujo_versiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulario_campos" (
    "id" UUID NOT NULL,
    "seccion_id" UUID NOT NULL,
    "clave_tecnica" TEXT NOT NULL,
    "etiqueta" TEXT NOT NULL,
    "tipo_dato" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "obligatorio" BOOLEAN NOT NULL DEFAULT false,
    "valor_predeterminado" TEXT,
    "opciones_json" JSONB,
    "validaciones_json" JSONB,
    "condicion_visibilidad_json" JSONB,
    "texto_ayuda" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "formulario_campos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulario_secciones" (
    "id" UUID NOT NULL,
    "tipo_acto_id" UUID NOT NULL,
    "clave" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "descripcion" TEXT,

    CONSTRAINT "formulario_secciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulario_versiones" (
    "id" UUID NOT NULL,
    "tipo_acto_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "secciones_json" JSONB NOT NULL,
    "campos_json" JSONB NOT NULL,
    "vigente_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" UUID NOT NULL,

    CONSTRAINT "formulario_versiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memoria_despacho" (
    "id" UUID NOT NULL,
    "categoria" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "tipo_acto" TEXT,
    "institucion" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memoria_despacho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimiento_documentos" (
    "id" UUID NOT NULL,
    "movimiento_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "tipo_vinculo" TEXT NOT NULL,
    "fecha_vinculo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" UUID NOT NULL,
    "estatus" "VinculoEstatus" NOT NULL DEFAULT 'ACTIVO',
    "inactivado_at" TIMESTAMP(3),
    "inactivado_por_id" UUID,
    "motivo_inactivacion" TEXT,
    "observaciones" TEXT,

    CONSTRAINT "movimiento_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_financieros" (
    "id" UUID NOT NULL,
    "expediente_id" UUID,
    "cotizacion_id" UUID,
    "tipo_movimiento" "TipoMovimiento" NOT NULL,
    "naturaleza" "NaturalezaMovimiento" NOT NULL,
    "categoria" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "fecha_movimiento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forma_pago" TEXT,
    "cuenta_receptora" TEXT,
    "referencia" TEXT,
    "comprobante_url" TEXT,
    "factura_url" TEXT,
    "estatus" "EstatusMovimiento" NOT NULL DEFAULT 'PENDIENTE',
    "capturado_por_id" UUID NOT NULL,
    "validado_por_id" UUID,
    "fecha_validacion" TIMESTAMP(3),
    "movimiento_origen_id" UUID,
    "motivo_reversion" TEXT,
    "revertido_por_id" UUID,
    "fecha_reversion" TIMESTAMP(3),

    CONSTRAINT "movimientos_financieros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notaria_contactos" (
    "id" UUID NOT NULL,
    "notaria_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "cargo" TEXT NOT NULL,
    "telefono" TEXT,
    "whatsapp" TEXT,
    "correo" TEXT,
    "observaciones" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notaria_contactos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notarias" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "ciudad" TEXT,
    "contacto_principal" TEXT,
    "dias_respuesta_estimados" INTEGER NOT NULL DEFAULT 5,
    "requisitos_frecuentes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "codigo_postal" TEXT,
    "color_identificador" TEXT DEFAULT '#D4AF37',
    "correo_general" TEXT,
    "correo_proyectos" TEXT,
    "demarcacion" TEXT,
    "dias_atencion" TEXT,
    "direccion" TEXT,
    "entidad_federativa" TEXT NOT NULL DEFAULT 'Nayarit',
    "horario" TEXT,
    "instituciones_json" JSONB,
    "instrucciones_especiales" TEXT,
    "municipio" TEXT NOT NULL DEFAULT 'Tepic',
    "municipios_atendidos_json" JSONB,
    "notario_titular" TEXT,
    "numero_notaria" TEXT,
    "observaciones_generales" TEXT,
    "pagina_web" TEXT,
    "predeterminada" BOOLEAN NOT NULL DEFAULT false,
    "telefono" TEXT,
    "tiempo_firma" TEXT,
    "tiempo_presupuesto" TEXT,
    "tiempo_respuesta" TEXT,
    "tipos_acto_json" JSONB,
    "whatsapp" TEXT,

    CONSTRAINT "notarias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notas" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "contenido" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estatus" "NotaEstatus" NOT NULL DEFAULT 'PENDIENTE',
    "fecha_limite" TIMESTAMP(3),
    "prioridad" "NotaPrioridad" NOT NULL DEFAULT 'MEDIA',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos" (
    "id" UUID NOT NULL,
    "expediente_id" UUID,
    "categoria_ingreso" "CategoriaIngreso" NOT NULL,
    "concepto" TEXT NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "fecha_pago" TIMESTAMP(3),
    "fecha_registro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estatus" "PagoEstatus" NOT NULL DEFAULT 'PENDIENTE',
    "comprobante_url" TEXT,
    "factura_url" TEXT,
    "notas" TEXT,
    "cotizacion_id" UUID,
    "fecha_validacion" TIMESTAMP(3),
    "validado_por_id" UUID,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "requested_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persona_moral_instrumentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "persona_moral_id" UUID NOT NULL,
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
    "documento_soporte_id" UUID,
    "vigente" BOOLEAN DEFAULT true,
    "observaciones" TEXT,
    "creado_por_id" UUID NOT NULL,
    "validado_por_id" UUID,
    "validado_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "persona_moral_instrumentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persona_moral_representantes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "persona_moral_id" UUID NOT NULL,
    "representante_persona_fisica_id" UUID NOT NULL,
    "caracter_representacion_id" UUID,
    "cargo_descripcion" VARCHAR(100) NOT NULL,
    "instrumento_id" UUID,
    "fecha_inicio" DATE,
    "fecha_fin" DATE,
    "facultades_resumen" TEXT,
    "vigente" BOOLEAN DEFAULT true,
    "principal" BOOLEAN DEFAULT true,
    "documento_soporte_id" UUID,
    "observaciones" TEXT,
    "creado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "persona_moral_representantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personas_fisicas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "compareciente_id" UUID NOT NULL,
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
    "requiere_interprete" BOOLEAN DEFAULT false,
    "idioma" VARCHAR(50) DEFAULT 'Español',
    "pep" BOOLEAN DEFAULT false,
    "relacion_pep" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "pep_estado" "PepEstado" NOT NULL DEFAULT 'PENDIENTE',
    "pais_nacimiento" VARCHAR,
    "escolaridad" VARCHAR,
    "giro" VARCHAR,

    CONSTRAINT "personas_fisicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personas_morales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "compareciente_id" UUID NOT NULL,
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
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "personas_morales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantilla_documental_versiones" (
    "id" UUID NOT NULL,
    "tipo_acto_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requisitos_json" JSONB NOT NULL,
    "vigente_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" UUID NOT NULL,

    CONSTRAINT "plantilla_documental_versiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospecto_documentos" (
    "id" UUID NOT NULL,
    "prospecto_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "tipo_vinculo" TEXT NOT NULL,
    "fecha_vinculo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" UUID NOT NULL,
    "estatus" "VinculoEstatus" NOT NULL DEFAULT 'ACTIVO',
    "inactivado_at" TIMESTAMP(3),
    "inactivado_por_id" UUID,
    "motivo_inactivacion" TEXT,
    "observaciones" TEXT,

    CONSTRAINT "prospecto_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospecto_seguimientos" (
    "id" UUID NOT NULL,
    "prospecto_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_proximo_seguimiento" TIMESTAMP(3),
    "proxima_accion" TEXT,
    "usuario_id" UUID NOT NULL,

    CONSTRAINT "prospecto_seguimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospectos" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "email" TEXT,
    "tipo_acto" TEXT,
    "necesidad" TEXT,
    "documentos_disponibles" TEXT,
    "tiene_antecedente" BOOLEAN,
    "tiene_predial" BOOLEAN,
    "puede_compartir_docs" BOOLEAN,
    "tiempo_estimado" TEXT,
    "estado" "ProspectoEstado" NOT NULL DEFAULT 'NUEVO',
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),
    "archived_by" UUID,
    "ciudad" TEXT,
    "fuente" TEXT,
    "motivo_archivo" TEXT,
    "prioridad" "ProspectoPrioridad" NOT NULL DEFAULT 'MEDIA',

    CONSTRAINT "prospectos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relaciones_conyugales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "persona_1_id" UUID NOT NULL,
    "persona_2_id" UUID NOT NULL,
    "regimen_matrimonial" "RegimenMatrimonial" DEFAULT 'SOCIEDAD_CONYUGAL',
    "fecha_matrimonio" DATE,
    "lugar_matrimonio" VARCHAR(150),
    "documento_soporte_id" UUID,
    "vigente" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "relaciones_conyugales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requisito_documento_vinculos" (
    "id" UUID NOT NULL,
    "requisito_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "fecha_vinculo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" UUID NOT NULL,
    "estatus" "VinculoEstatus" NOT NULL DEFAULT 'ACTIVO',
    "inactivado_at" TIMESTAMP(3),
    "inactivado_por_id" UUID,
    "motivo_inactivacion" TEXT,
    "observaciones" TEXT,

    CONSTRAINT "requisito_documento_vinculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_compensation_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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

    CONSTRAINT "storage_compensation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tareas" (
    "id" UUID NOT NULL,
    "expediente_id" UUID,
    "asignado_a_id" UUID NOT NULL,
    "creador_id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "prioridad" "TareaPrioridad" NOT NULL DEFAULT 'MEDIA',
    "estatus" "TareaEstatus" NOT NULL DEFAULT 'PENDIENTE',
    "fecha_limite" TIMESTAMP(3),
    "fecha_completada" TIMESTAMP(3),
    "etapa_relacionada" TEXT,
    "event_id" UUID,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tareas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tareas_externas" (
    "id" UUID NOT NULL,
    "expediente_id" UUID NOT NULL,
    "tipo" "TipoTareaExterna" NOT NULL,
    "descripcion" TEXT NOT NULL,
    "institucion" TEXT,
    "estatus" "TareaExternaEstatus" NOT NULL DEFAULT 'PENDIENTE',
    "fecha_inicio" TIMESTAMP(3),
    "fecha_limite" TIMESTAMP(3),
    "fecha_completada" TIMESTAMP(3),
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tareas_externas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipo_acto_caracteres_compareciente" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo_acto_id" UUID NOT NULL,
    "caracter_id" UUID NOT NULL,
    "sugerido" BOOLEAN DEFAULT true,
    "orden" INTEGER DEFAULT 0,

    CONSTRAINT "tipo_acto_caracteres_compareciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_acto" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "machote_referencia" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tipos_acto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "rol" "Role" NOT NULL DEFAULT 'ABOGADO',
    "avatar_url" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "password_changed_at" TIMESTAMP(3),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "requires_password_change" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
ALTER TABLE "actividades_economicas" ADD CONSTRAINT "actividades_economicas_clave_key" UNIQUE ("clave");

-- CreateIndex
CREATE INDEX "idx_actividades_economicas_clave" ON "actividades_economicas"("clave" ASC);

-- CreateIndex
CREATE INDEX "idx_actividades_economicas_descripcion" ON "actividades_economicas"("descripcion" ASC);

-- CreateIndex
CREATE INDEX "ai_usage_logs_created_at_idx" ON "ai_usage_logs"("created_at" ASC);

-- CreateIndex
CREATE INDEX "ai_usage_logs_expediente_id_created_at_idx" ON "ai_usage_logs"("expediente_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "ai_usage_logs_modelo_created_at_idx" ON "ai_usage_logs"("modelo" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "ai_usage_logs_usuario_id_created_at_idx" ON "ai_usage_logs"("usuario_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "idx_ai_usage_alta_session_fk" ON "ai_usage_logs"("compareciente_alta_session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_user_fk" ON "audit_logs"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash" ASC);

-- CreateIndex
CREATE INDEX "auth_sessions_user_revoked_expires_idx" ON "auth_sessions"("user_id" ASC, "revoked_at" ASC, "expires_at" ASC);

-- CreateIndex
ALTER TABLE "caracteres_compareciente" ADD CONSTRAINT "caracteres_compareciente_clave_key" UNIQUE ("clave");

-- CreateIndex
ALTER TABLE "caracteres_representacion" ADD CONSTRAINT "caracteres_representacion_clave_key" UNIQUE ("clave");

-- CreateIndex
CREATE INDEX "idx_cargas_temporales_estado" ON "carga_temporal_documentos"("estado" ASC);

-- CreateIndex
CREATE INDEX "idx_cargas_temporales_session" ON "carga_temporal_documentos"("alta_session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_cargas_temporales_usuario" ON "carga_temporal_documentos"("usuario_id" ASC);

-- CreateIndex
CREATE INDEX "idx_checklist_items_tipo_acto_fk" ON "checklist_items"("tipo_acto_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comp_actividades_actividad_fk" ON "compareciente_actividades_economicas"("actividad_id" ASC);

-- CreateIndex
ALTER TABLE "compareciente_actividades_economicas" ADD CONSTRAINT "uq_compareciente_actividad" UNIQUE ("compareciente_id", "actividad_id");

-- CreateIndex
CREATE INDEX "idx_compareciente_aliases_alias" ON "compareciente_aliases"("alias" ASC);

-- CreateIndex
CREATE INDEX "idx_compareciente_aliases_comp" ON "compareciente_aliases"("compareciente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_alta_sessions_expires_at" ON "compareciente_alta_sessions"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "idx_alta_sessions_origen_expediente_fk" ON "compareciente_alta_sessions"("origen_expediente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_alta_sessions_usuario_estatus" ON "compareciente_alta_sessions"("usuario_id" ASC, "estatus" ASC);

-- CreateIndex
CREATE INDEX "idx_comp_contactos_creador_fk" ON "compareciente_contactos"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comp_datos_fuente_carga_fk" ON "compareciente_datos_fuente"("carga_temporal_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comp_datos_fuente_confirmador_fk" ON "compareciente_datos_fuente"("confirmado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comp_datos_fuente_documento_fk" ON "compareciente_datos_fuente"("documento_id" ASC);

-- CreateIndex
CREATE INDEX "idx_compareciente_datos_fuente_campo" ON "compareciente_datos_fuente"("campo" ASC);

-- CreateIndex
CREATE INDEX "idx_compareciente_datos_fuente_comp" ON "compareciente_datos_fuente"("compareciente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comp_documentos_creador_fk" ON "compareciente_documentos"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comp_documentos_documento_fk" ON "compareciente_documentos"("documento_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comp_documentos_validador_fk" ON "compareciente_documentos"("validado_por_id" ASC);

-- CreateIndex
ALTER TABLE "compareciente_documentos" ADD CONSTRAINT "uq_compareciente_doc" UNIQUE ("compareciente_id", "documento_id", "categoria");

-- CreateIndex
CREATE INDEX "compareciente_domicilios_documento_comprobante_id_idx" ON "compareciente_domicilios"("documento_comprobante_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comp_domicilios_creador_fk" ON "compareciente_domicilios"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comp_identificaciones_creador_fk" ON "compareciente_identificaciones"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comp_identificaciones_documento_fk" ON "compareciente_identificaciones"("documento_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comp_identificaciones_validador_fk" ON "compareciente_identificaciones"("validado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comparecientes_creado_por_fk" ON "comparecientes"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comparecientes_nombre_busqueda" ON "comparecientes"("nombre_busqueda" ASC);

-- CreateIndex
CREATE INDEX "idx_comparecientes_tipo_persona" ON "comparecientes"("tipo_persona" ASC);

-- CreateIndex
CREATE INDEX "compliance_evidence_documento_id_idx" ON "compliance_evidence"("documento_id" ASC);

-- CreateIndex
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_review_id_documento_id_tipo_evidencia_key" UNIQUE ("review_id", "documento_id", "tipo_evidencia");

-- CreateIndex
CREATE INDEX "idx_compliance_evidence_agregado_fk" ON "compliance_evidence"("agregado_por_id" ASC);

-- CreateIndex
CREATE INDEX "compliance_reviews_estatus_created_at_idx" ON "compliance_reviews"("estatus" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "compliance_reviews_expediente_tipo_idx" ON "compliance_reviews"("expediente_id" ASC, "tipo" ASC);

-- CreateIndex
CREATE INDEX "idx_compliance_reviews_creador_fk" ON "compliance_reviews"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_compliance_reviews_revisor_fk" ON "compliance_reviews"("revisado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_compliance_reviews_rule_fk" ON "compliance_reviews"("rule_set_id" ASC);

-- CreateIndex
ALTER TABLE "compliance_rule_sets" ADD CONSTRAINT "compliance_rule_sets_tipo_clave_version_key" UNIQUE ("tipo", "clave", "version");

-- CreateIndex
CREATE INDEX "compliance_rule_sets_tipo_estatus_vigencia_idx" ON "compliance_rule_sets"("tipo" ASC, "estatus" ASC, "vigencia_desde" ASC);

-- CreateIndex
CREATE INDEX "idx_compliance_rules_aprobador_fk" ON "compliance_rule_sets"("aprobado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_compliance_rules_creador_fk" ON "compliance_rule_sets"("creado_por_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "comunicacion_documentos_comunicacion_id_documento_id_tipo_v_key" ON "comunicacion_documentos"("comunicacion_id" ASC, "documento_id" ASC, "tipo_vinculo" ASC);

-- CreateIndex
CREATE INDEX "idx_com_documentos_creador_fk" ON "comunicacion_documentos"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_com_documentos_documento_fk" ON "comunicacion_documentos"("documento_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comunicaciones_expediente_fk" ON "comunicaciones"("expediente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_comunicaciones_user_fk" ON "comunicaciones"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cotizacion_documentos_cotizacion_id_documento_id_tipo_vincu_key" ON "cotizacion_documentos"("cotizacion_id" ASC, "documento_id" ASC, "tipo_vinculo" ASC);

-- CreateIndex
CREATE INDEX "idx_cot_documentos_creador_fk" ON "cotizacion_documentos"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_cot_documentos_documento_fk" ON "cotizacion_documentos"("documento_id" ASC);

-- CreateIndex
CREATE INDEX "idx_cot_seguimientos_cotizacion_fk" ON "cotizacion_seguimientos"("cotizacion_id" ASC);

-- CreateIndex
CREATE INDEX "idx_cot_seguimientos_usuario_fk" ON "cotizacion_seguimientos"("usuario_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cotizacion_versiones_cotizacion_id_version_key" ON "cotizacion_versiones"("cotizacion_id" ASC, "version" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cotizaciones_numero_cotizacion_key" ON "cotizaciones"("numero_cotizacion" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cotizaciones_numero_solicitud_key" ON "cotizaciones"("numero_solicitud" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cotizaciones_prospecto_id_key" ON "cotizaciones"("prospecto_id" ASC);

-- CreateIndex
CREATE INDEX "idx_cotizaciones_notaria_fk" ON "cotizaciones"("notaria_id" ASC);

-- CreateIndex
CREATE INDEX "idx_cotizaciones_user_fk" ON "cotizaciones"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "documentos_nombre_interno_key" ON "documentos"("nombre_interno" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "documentos_storage_key_key" ON "documentos"("storage_key" ASC);

-- CreateIndex
CREATE INDEX "idx_documentos_cotizacion_fk" ON "documentos"("cotizacion_id" ASC);

-- CreateIndex
CREATE INDEX "idx_documentos_expediente_fk" ON "documentos"("expediente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_documentos_prospecto_fk" ON "documentos"("prospecto_id" ASC);

-- CreateIndex
CREATE INDEX "idx_documentos_subido_por_fk" ON "documentos"("subido_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_outbox_actor_fk" ON "domain_event_outbox"("actor_user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "domain_event_processing_logs_event_id_handler_name_key" ON "domain_event_processing_logs"("event_id" ASC, "handler_name" ASC);

-- CreateIndex
CREATE INDEX "eventos_agenda_estatus_idx" ON "eventos_agenda"("estatus" ASC);

-- CreateIndex
CREATE INDEX "eventos_agenda_expediente_idx" ON "eventos_agenda"("expediente_id" ASC);

-- CreateIndex
CREATE INDEX "eventos_agenda_fecha_inicio_idx" ON "eventos_agenda"("fecha_inicio" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "eventos_agenda_idempotency_key_key" ON "eventos_agenda"("idempotency_key" ASC);

-- CreateIndex
CREATE INDEX "eventos_agenda_user_fecha_idx" ON "eventos_agenda"("user_id" ASC, "fecha_inicio" ASC);

-- CreateIndex
CREATE INDEX "idx_agenda_cancelado_por_fk" ON "eventos_agenda"("cancelado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_agenda_compareciente_fk" ON "eventos_agenda"("compareciente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_actividades_expediente_fk" ON "expediente_actividades"("expediente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_actividades_usuario_fk" ON "expediente_actividades"("usuario_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_comparecientes_caracter_fk" ON "expediente_comparecientes"("caracter_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_comparecientes_compareciente_fk" ON "expediente_comparecientes"("compareciente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_comparecientes_creador_fk" ON "expediente_comparecientes"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_comparecientes_validador_fk" ON "expediente_comparecientes"("validado_por_id" ASC);

-- CreateIndex
ALTER TABLE "expediente_comparecientes" ADD CONSTRAINT "uq_expediente_compareciente_caracter" UNIQUE ("expediente_id", "compareciente_id", "caracter_id", "forma_comparecencia");

-- CreateIndex
CREATE UNIQUE INDEX "expediente_documentos_expediente_id_documento_id_tipo_vincu_key" ON "expediente_documentos"("expediente_id" ASC, "documento_id" ASC, "tipo_vinculo" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_documentos_creador_fk" ON "expediente_documentos"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_documentos_documento_fk" ON "expediente_documentos"("documento_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_estatus_log_expediente_fk" ON "expediente_estatus_log"("expediente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_etapas_expediente_fk" ON "expediente_etapas"("expediente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_etapas_flujo_etapa_fk" ON "expediente_etapas"("flujo_etapa_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_etapas_flujo_version_fk" ON "expediente_etapas"("flujo_version_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_rep_caracter_fk" ON "expediente_representaciones"("caracter_representacion_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_rep_creador_fk" ON "expediente_representaciones"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_rep_expediente_fk" ON "expediente_representaciones"("expediente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_rep_instrumento_fk" ON "expediente_representaciones"("instrumento_representacion_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_rep_representado_fk" ON "expediente_representaciones"("representado_compareciente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_rep_representante_fk" ON "expediente_representaciones"("representante_compareciente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_rep_validador_fk" ON "expediente_representaciones"("validado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_rep_vinculo_representado_fk" ON "expediente_representaciones"("expediente_compareciente_representado_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_rep_vinculo_representante_fk" ON "expediente_representaciones"("expediente_compareciente_representante_id" ASC);

-- CreateIndex
CREATE INDEX "idx_exp_requisitos_expediente_fk" ON "expediente_requisitos_doc"("expediente_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "expedientes_cotizacion_id_key" ON "expedientes"("cotizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "expedientes_expediente_etapa_actual_id_key" ON "expedientes"("expediente_etapa_actual_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "expedientes_numero_pravia_key" ON "expedientes"("numero_pravia" ASC);

-- CreateIndex
CREATE INDEX "idx_expedientes_abogado_fk" ON "expedientes"("abogado_id" ASC);

-- CreateIndex
CREATE INDEX "idx_expedientes_archivado_por_fk" ON "expedientes"("archived_by" ASC);

-- CreateIndex
CREATE INDEX "idx_expedientes_creador_fk" ON "expedientes"("creador_id" ASC);

-- CreateIndex
CREATE INDEX "idx_expedientes_flujo_version_fk" ON "expedientes"("flujo_version_id" ASC);

-- CreateIndex
CREATE INDEX "idx_expedientes_formulario_version_fk" ON "expedientes"("formulario_version_id" ASC);

-- CreateIndex
CREATE INDEX "idx_expedientes_gestor_fk" ON "expedientes"("gestor_id" ASC);

-- CreateIndex
CREATE INDEX "idx_expedientes_notaria_fk" ON "expedientes"("notaria_id" ASC);

-- CreateIndex
CREATE INDEX "idx_expedientes_plantilla_version_fk" ON "expedientes"("plantilla_doc_version_id" ASC);

-- CreateIndex
CREATE INDEX "idx_expedientes_tipo_acto_fk" ON "expedientes"("tipo_acto_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "flujo_etapas_tipo_acto_id_clave_key" ON "flujo_etapas"("tipo_acto_id" ASC, "clave" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "flujo_versiones_tipo_acto_id_version_key" ON "flujo_versiones"("tipo_acto_id" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "idx_flujo_versiones_creador_fk" ON "flujo_versiones"("creado_por_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "formulario_campos_seccion_id_clave_tecnica_key" ON "formulario_campos"("seccion_id" ASC, "clave_tecnica" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "formulario_secciones_tipo_acto_id_clave_key" ON "formulario_secciones"("tipo_acto_id" ASC, "clave" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "formulario_versiones_tipo_acto_id_version_key" ON "formulario_versiones"("tipo_acto_id" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "idx_formulario_versiones_creador_fk" ON "formulario_versiones"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_mov_documentos_creador_fk" ON "movimiento_documentos"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_mov_documentos_documento_fk" ON "movimiento_documentos"("documento_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "movimiento_documentos_movimiento_id_documento_id_tipo_vincu_key" ON "movimiento_documentos"("movimiento_id" ASC, "documento_id" ASC, "tipo_vinculo" ASC);

-- CreateIndex
CREATE INDEX "idx_movimientos_capturado_por_fk" ON "movimientos_financieros"("capturado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_movimientos_cotizacion_fk" ON "movimientos_financieros"("cotizacion_id" ASC);

-- CreateIndex
CREATE INDEX "idx_movimientos_expediente_fk" ON "movimientos_financieros"("expediente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_movimientos_origen_fk" ON "movimientos_financieros"("movimiento_origen_id" ASC);

-- CreateIndex
CREATE INDEX "idx_movimientos_revertido_por_fk" ON "movimientos_financieros"("revertido_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_movimientos_validado_por_fk" ON "movimientos_financieros"("validado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_notaria_contactos_notaria_fk" ON "notaria_contactos"("notaria_id" ASC);

-- CreateIndex
CREATE INDEX "idx_notas_user_fk" ON "notas"("user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_pagos_cotizacion_fk" ON "pagos"("cotizacion_id" ASC);

-- CreateIndex
CREATE INDEX "idx_pagos_expediente_fk" ON "pagos"("expediente_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash" ASC);

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_used_expires_idx" ON "password_reset_tokens"("user_id" ASC, "used_at" ASC, "expires_at" ASC);

-- CreateIndex
CREATE INDEX "idx_pm_instrumentos_creador_fk" ON "persona_moral_instrumentos"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_pm_instrumentos_documento_fk" ON "persona_moral_instrumentos"("documento_soporte_id" ASC);

-- CreateIndex
CREATE INDEX "idx_pm_instrumentos_persona_fk" ON "persona_moral_instrumentos"("persona_moral_id" ASC);

-- CreateIndex
CREATE INDEX "idx_pm_instrumentos_validador_fk" ON "persona_moral_instrumentos"("validado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_pm_representantes_caracter_fk" ON "persona_moral_representantes"("caracter_representacion_id" ASC);

-- CreateIndex
CREATE INDEX "idx_pm_representantes_creador_fk" ON "persona_moral_representantes"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_pm_representantes_documento_fk" ON "persona_moral_representantes"("documento_soporte_id" ASC);

-- CreateIndex
CREATE INDEX "idx_pm_representantes_instrumento_fk" ON "persona_moral_representantes"("instrumento_id" ASC);

-- CreateIndex
CREATE INDEX "idx_pm_representantes_persona_fisica_fk" ON "persona_moral_representantes"("representante_persona_fisica_id" ASC);

-- CreateIndex
CREATE INDEX "idx_pm_representantes_persona_fk" ON "persona_moral_representantes"("persona_moral_id" ASC);

-- CreateIndex
CREATE INDEX "idx_personas_fisicas_nombre" ON "personas_fisicas"("nombre_completo_calculado" ASC);

-- CreateIndex
ALTER TABLE "personas_fisicas" ADD CONSTRAINT "personas_fisicas_compareciente_id_key" UNIQUE ("compareciente_id");

-- CreateIndex
CREATE INDEX "idx_personas_morales_folio" ON "personas_morales"("folio_mercantil" ASC);

-- CreateIndex
CREATE INDEX "idx_personas_morales_razon" ON "personas_morales"("razon_social" ASC);

-- CreateIndex
ALTER TABLE "personas_morales" ADD CONSTRAINT "personas_morales_compareciente_id_key" UNIQUE ("compareciente_id");

-- CreateIndex
CREATE INDEX "idx_plantilla_versiones_creador_fk" ON "plantilla_documental_versiones"("creado_por_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "plantilla_documental_versiones_tipo_acto_id_version_key" ON "plantilla_documental_versiones"("tipo_acto_id" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "idx_pros_documentos_creador_fk" ON "prospecto_documentos"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_pros_documentos_documento_fk" ON "prospecto_documentos"("documento_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "prospecto_documentos_prospecto_id_documento_id_tipo_vinculo_key" ON "prospecto_documentos"("prospecto_id" ASC, "documento_id" ASC, "tipo_vinculo" ASC);

-- CreateIndex
CREATE INDEX "idx_pros_seguimientos_prospecto_fk" ON "prospecto_seguimientos"("prospecto_id" ASC);

-- CreateIndex
CREATE INDEX "idx_pros_seguimientos_usuario_fk" ON "prospecto_seguimientos"("usuario_id" ASC);

-- CreateIndex
CREATE INDEX "idx_prospectos_archivado_por_fk" ON "prospectos"("archived_by" ASC);

-- CreateIndex
CREATE INDEX "idx_prospectos_user_fk" ON "prospectos"("user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_rel_conyugales_documento_fk" ON "relaciones_conyugales"("documento_soporte_id" ASC);

-- CreateIndex
CREATE INDEX "idx_rel_conyugales_persona_1_fk" ON "relaciones_conyugales"("persona_1_id" ASC);

-- CreateIndex
CREATE INDEX "idx_rel_conyugales_persona_2_fk" ON "relaciones_conyugales"("persona_2_id" ASC);

-- CreateIndex
CREATE INDEX "idx_requisito_vinculos_creador_fk" ON "requisito_documento_vinculos"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_requisito_vinculos_documento_fk" ON "requisito_documento_vinculos"("documento_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "requisito_documento_vinculos_requisito_id_documento_id_key" ON "requisito_documento_vinculos"("requisito_id" ASC, "documento_id" ASC);

-- CreateIndex
CREATE INDEX "idx_storage_compensation_jobs_estatus_exec" ON "storage_compensation_jobs"("estatus" ASC, "proxima_ejecucion_at" ASC);

-- CreateIndex
CREATE INDEX "idx_storage_jobs_carga_fk" ON "storage_compensation_jobs"("carga_temporal_id" ASC);

-- CreateIndex
CREATE INDEX "idx_tareas_asignado_fk" ON "tareas"("asignado_a_id" ASC);

-- CreateIndex
CREATE INDEX "idx_tareas_creador_fk" ON "tareas"("creador_id" ASC);

-- CreateIndex
CREATE INDEX "idx_tareas_expediente_fk" ON "tareas"("expediente_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tareas_idempotency_key_key" ON "tareas"("idempotency_key" ASC);

-- CreateIndex
CREATE INDEX "idx_tareas_externas_expediente_fk" ON "tareas_externas"("expediente_id" ASC);

-- CreateIndex
CREATE INDEX "idx_tipo_acto_caracter_caracter_fk" ON "tipo_acto_caracteres_compareciente"("caracter_id" ASC);

-- CreateIndex
ALTER TABLE "tipo_acto_caracteres_compareciente" ADD CONSTRAINT "uq_tipo_acto_caracter" UNIQUE ("tipo_acto_id", "caracter_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email" ASC);

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_compareciente_alta_session_id_fkey" FOREIGN KEY ("compareciente_alta_session_id") REFERENCES "compareciente_alta_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carga_temporal_documentos" ADD CONSTRAINT "fk_carga_temporal_session" FOREIGN KEY ("alta_session_id") REFERENCES "compareciente_alta_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carga_temporal_documentos" ADD CONSTRAINT "fk_carga_temporal_usuario" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_actividades_economicas" ADD CONSTRAINT "fk_comp_actividades_act" FOREIGN KEY ("actividad_id") REFERENCES "actividades_economicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_actividades_economicas" ADD CONSTRAINT "fk_comp_actividades_comp" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_aliases" ADD CONSTRAINT "fk_compareciente_aliases_comp" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_alta_sessions" ADD CONSTRAINT "fk_alta_session_expediente" FOREIGN KEY ("origen_expediente_id") REFERENCES "expedientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_alta_sessions" ADD CONSTRAINT "fk_alta_session_usuario" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_contactos" ADD CONSTRAINT "compareciente_contactos_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compareciente_contactos" ADD CONSTRAINT "compareciente_contactos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compareciente_datos_fuente" ADD CONSTRAINT "fk_datos_fuente_carga_temporal" FOREIGN KEY ("carga_temporal_id") REFERENCES "carga_temporal_documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_datos_fuente" ADD CONSTRAINT "fk_datos_fuente_compareciente" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_datos_fuente" ADD CONSTRAINT "fk_datos_fuente_confirmador" FOREIGN KEY ("confirmado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_datos_fuente" ADD CONSTRAINT "fk_datos_fuente_documento" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_documentos" ADD CONSTRAINT "compareciente_documentos_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compareciente_documentos" ADD CONSTRAINT "compareciente_documentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compareciente_documentos" ADD CONSTRAINT "compareciente_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compareciente_documentos" ADD CONSTRAINT "compareciente_documentos_validado_por_id_fkey" FOREIGN KEY ("validado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compareciente_domicilios" ADD CONSTRAINT "compareciente_domicilios_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compareciente_domicilios" ADD CONSTRAINT "compareciente_domicilios_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compareciente_domicilios" ADD CONSTRAINT "compareciente_domicilios_documento_comprobante_id_fkey" FOREIGN KEY ("documento_comprobante_id") REFERENCES "documentos"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compareciente_identificaciones" ADD CONSTRAINT "compareciente_identificaciones_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compareciente_identificaciones" ADD CONSTRAINT "compareciente_identificaciones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compareciente_identificaciones" ADD CONSTRAINT "compareciente_identificaciones_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compareciente_identificaciones" ADD CONSTRAINT "compareciente_identificaciones_validado_por_id_fkey" FOREIGN KEY ("validado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comparecientes" ADD CONSTRAINT "comparecientes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_agregado_por_id_fkey" FOREIGN KEY ("agregado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "compliance_reviews"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_revisado_por_id_fkey" FOREIGN KEY ("revisado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "compliance_rule_sets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_rule_sets" ADD CONSTRAINT "compliance_rule_sets_aprobado_por_id_fkey" FOREIGN KEY ("aprobado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compliance_rule_sets" ADD CONSTRAINT "compliance_rule_sets_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comunicacion_documentos" ADD CONSTRAINT "comunicacion_documentos_comunicacion_id_fkey" FOREIGN KEY ("comunicacion_id") REFERENCES "comunicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicacion_documentos" ADD CONSTRAINT "comunicacion_documentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicacion_documentos" ADD CONSTRAINT "comunicacion_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicaciones" ADD CONSTRAINT "comunicaciones_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicaciones" ADD CONSTRAINT "comunicaciones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_documentos" ADD CONSTRAINT "cotizacion_documentos_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_documentos" ADD CONSTRAINT "cotizacion_documentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_documentos" ADD CONSTRAINT "cotizacion_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_seguimientos" ADD CONSTRAINT "cotizacion_seguimientos_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_seguimientos" ADD CONSTRAINT "cotizacion_seguimientos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_versiones" ADD CONSTRAINT "cotizacion_versiones_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizaciones" ADD CONSTRAINT "cotizaciones_notaria_id_fkey" FOREIGN KEY ("notaria_id") REFERENCES "notarias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizaciones" ADD CONSTRAINT "cotizaciones_prospecto_id_fkey" FOREIGN KEY ("prospecto_id") REFERENCES "prospectos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizaciones" ADD CONSTRAINT "cotizaciones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_prospecto_id_fkey" FOREIGN KEY ("prospecto_id") REFERENCES "prospectos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_subido_por_id_fkey" FOREIGN KEY ("subido_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_event_outbox" ADD CONSTRAINT "domain_event_outbox_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_event_processing_logs" ADD CONSTRAINT "domain_event_processing_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "domain_event_outbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_agenda" ADD CONSTRAINT "eventos_agenda_cancelado_por_id_fkey" FOREIGN KEY ("cancelado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "eventos_agenda" ADD CONSTRAINT "eventos_agenda_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "eventos_agenda" ADD CONSTRAINT "eventos_agenda_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_agenda" ADD CONSTRAINT "eventos_agenda_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_actividades" ADD CONSTRAINT "expediente_actividades_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_actividades" ADD CONSTRAINT "expediente_actividades_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_comparecientes" ADD CONSTRAINT "expediente_comparecientes_caracter_id_fkey" FOREIGN KEY ("caracter_id") REFERENCES "caracteres_compareciente"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expediente_comparecientes" ADD CONSTRAINT "expediente_comparecientes_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expediente_comparecientes" ADD CONSTRAINT "expediente_comparecientes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expediente_comparecientes" ADD CONSTRAINT "expediente_comparecientes_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expediente_comparecientes" ADD CONSTRAINT "expediente_comparecientes_validado_por_id_fkey" FOREIGN KEY ("validado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_documentos" ADD CONSTRAINT "expediente_documentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_documentos" ADD CONSTRAINT "expediente_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_documentos" ADD CONSTRAINT "expediente_documentos_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_estatus_log" ADD CONSTRAINT "expediente_estatus_log_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_etapas" ADD CONSTRAINT "expediente_etapas_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_etapas" ADD CONSTRAINT "expediente_etapas_flujo_etapa_id_fkey" FOREIGN KEY ("flujo_etapa_id") REFERENCES "flujo_etapas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_etapas" ADD CONSTRAINT "expediente_etapas_flujo_version_id_fkey" FOREIGN KEY ("flujo_version_id") REFERENCES "flujo_versiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_caracter_representacion_id_fkey" FOREIGN KEY ("caracter_representacion_id") REFERENCES "caracteres_representacion"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_expediente_compareciente_repr_fkey1" FOREIGN KEY ("expediente_compareciente_representante_id") REFERENCES "expediente_comparecientes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_expediente_compareciente_repre_fkey" FOREIGN KEY ("expediente_compareciente_representado_id") REFERENCES "expediente_comparecientes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_instrumento_representacion_id_fkey" FOREIGN KEY ("instrumento_representacion_id") REFERENCES "persona_moral_instrumentos"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_representado_compareciente_id_fkey" FOREIGN KEY ("representado_compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_representante_compareciente_id_fkey" FOREIGN KEY ("representante_compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expediente_representaciones" ADD CONSTRAINT "expediente_representaciones_validado_por_id_fkey" FOREIGN KEY ("validado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expediente_requisitos_doc" ADD CONSTRAINT "expediente_requisitos_doc_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_abogado_id_fkey" FOREIGN KEY ("abogado_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_creador_id_fkey" FOREIGN KEY ("creador_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_expediente_etapa_actual_id_fkey" FOREIGN KEY ("expediente_etapa_actual_id") REFERENCES "expediente_etapas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_flujo_version_id_fkey" FOREIGN KEY ("flujo_version_id") REFERENCES "flujo_versiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_formulario_version_id_fkey" FOREIGN KEY ("formulario_version_id") REFERENCES "formulario_versiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_gestor_id_fkey" FOREIGN KEY ("gestor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_notaria_id_fkey" FOREIGN KEY ("notaria_id") REFERENCES "notarias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_plantilla_doc_version_id_fkey" FOREIGN KEY ("plantilla_doc_version_id") REFERENCES "plantilla_documental_versiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flujo_etapas" ADD CONSTRAINT "flujo_etapas_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flujo_versiones" ADD CONSTRAINT "flujo_versiones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flujo_versiones" ADD CONSTRAINT "flujo_versiones_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulario_campos" ADD CONSTRAINT "formulario_campos_seccion_id_fkey" FOREIGN KEY ("seccion_id") REFERENCES "formulario_secciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulario_secciones" ADD CONSTRAINT "formulario_secciones_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulario_versiones" ADD CONSTRAINT "formulario_versiones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulario_versiones" ADD CONSTRAINT "formulario_versiones_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_documentos" ADD CONSTRAINT "movimiento_documentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_documentos" ADD CONSTRAINT "movimiento_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_documentos" ADD CONSTRAINT "movimiento_documentos_movimiento_id_fkey" FOREIGN KEY ("movimiento_id") REFERENCES "movimientos_financieros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_capturado_por_id_fkey" FOREIGN KEY ("capturado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_movimiento_origen_id_fkey" FOREIGN KEY ("movimiento_origen_id") REFERENCES "movimientos_financieros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_revertido_por_id_fkey" FOREIGN KEY ("revertido_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_validado_por_id_fkey" FOREIGN KEY ("validado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notaria_contactos" ADD CONSTRAINT "notaria_contactos_notaria_id_fkey" FOREIGN KEY ("notaria_id") REFERENCES "notarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas" ADD CONSTRAINT "notas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_moral_instrumentos" ADD CONSTRAINT "persona_moral_instrumentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "persona_moral_instrumentos" ADD CONSTRAINT "persona_moral_instrumentos_documento_soporte_id_fkey" FOREIGN KEY ("documento_soporte_id") REFERENCES "documentos"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "persona_moral_instrumentos" ADD CONSTRAINT "persona_moral_instrumentos_persona_moral_id_fkey" FOREIGN KEY ("persona_moral_id") REFERENCES "personas_morales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "persona_moral_instrumentos" ADD CONSTRAINT "persona_moral_instrumentos_validado_por_id_fkey" FOREIGN KEY ("validado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "persona_moral_representantes" ADD CONSTRAINT "persona_moral_representantes_caracter_representacion_id_fkey" FOREIGN KEY ("caracter_representacion_id") REFERENCES "caracteres_representacion"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "persona_moral_representantes" ADD CONSTRAINT "persona_moral_representantes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "persona_moral_representantes" ADD CONSTRAINT "persona_moral_representantes_documento_soporte_id_fkey" FOREIGN KEY ("documento_soporte_id") REFERENCES "documentos"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "persona_moral_representantes" ADD CONSTRAINT "persona_moral_representantes_instrumento_id_fkey" FOREIGN KEY ("instrumento_id") REFERENCES "persona_moral_instrumentos"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "persona_moral_representantes" ADD CONSTRAINT "persona_moral_representantes_persona_moral_id_fkey" FOREIGN KEY ("persona_moral_id") REFERENCES "personas_morales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "persona_moral_representantes" ADD CONSTRAINT "persona_moral_representantes_representante_persona_fisica__fkey" FOREIGN KEY ("representante_persona_fisica_id") REFERENCES "personas_fisicas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "personas_fisicas" ADD CONSTRAINT "personas_fisicas_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "personas_morales" ADD CONSTRAINT "personas_morales_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "plantilla_documental_versiones" ADD CONSTRAINT "plantilla_documental_versiones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantilla_documental_versiones" ADD CONSTRAINT "plantilla_documental_versiones_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_documentos" ADD CONSTRAINT "prospecto_documentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_documentos" ADD CONSTRAINT "prospecto_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_documentos" ADD CONSTRAINT "prospecto_documentos_prospecto_id_fkey" FOREIGN KEY ("prospecto_id") REFERENCES "prospectos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_seguimientos" ADD CONSTRAINT "prospecto_seguimientos_prospecto_id_fkey" FOREIGN KEY ("prospecto_id") REFERENCES "prospectos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_seguimientos" ADD CONSTRAINT "prospecto_seguimientos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospectos" ADD CONSTRAINT "prospectos_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospectos" ADD CONSTRAINT "prospectos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relaciones_conyugales" ADD CONSTRAINT "relaciones_conyugales_documento_soporte_id_fkey" FOREIGN KEY ("documento_soporte_id") REFERENCES "documentos"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "relaciones_conyugales" ADD CONSTRAINT "relaciones_conyugales_persona_1_id_fkey" FOREIGN KEY ("persona_1_id") REFERENCES "personas_fisicas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "relaciones_conyugales" ADD CONSTRAINT "relaciones_conyugales_persona_2_id_fkey" FOREIGN KEY ("persona_2_id") REFERENCES "personas_fisicas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "requisito_documento_vinculos" ADD CONSTRAINT "requisito_documento_vinculos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisito_documento_vinculos" ADD CONSTRAINT "requisito_documento_vinculos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisito_documento_vinculos" ADD CONSTRAINT "requisito_documento_vinculos_requisito_id_fkey" FOREIGN KEY ("requisito_id") REFERENCES "expediente_requisitos_doc"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_compensation_jobs" ADD CONSTRAINT "fk_storage_job_carga_temporal" FOREIGN KEY ("carga_temporal_id") REFERENCES "carga_temporal_documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas" ADD CONSTRAINT "tareas_asignado_a_id_fkey" FOREIGN KEY ("asignado_a_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas" ADD CONSTRAINT "tareas_creador_id_fkey" FOREIGN KEY ("creador_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas" ADD CONSTRAINT "tareas_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas_externas" ADD CONSTRAINT "tareas_externas_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipo_acto_caracteres_compareciente" ADD CONSTRAINT "tipo_acto_caracteres_compareciente_caracter_id_fkey" FOREIGN KEY ("caracter_id") REFERENCES "caracteres_compareciente"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tipo_acto_caracteres_compareciente" ADD CONSTRAINT "tipo_acto_caracteres_compareciente_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Database-native checks and partial/expression indexes retained from production.
ALTER TABLE "expediente_representaciones"
ADD CONSTRAINT "chk_distintos_comparecientes_rep"
CHECK ("representado_compareciente_id" <> "representante_compareciente_id");

ALTER TABLE "relaciones_conyugales"
ADD CONSTRAINT "chk_distintas_personas_conyuges"
CHECK ("persona_1_id" <> "persona_2_id");

CREATE UNIQUE INDEX "compareciente_alta_sessions_usuario_idempotency_key"
ON "compareciente_alta_sessions" USING btree ("usuario_id", "idempotency_key")
WHERE ("idempotency_key" IS NOT NULL);

CREATE UNIQUE INDEX "uq_contacto_principal_tipo"
ON "compareciente_contactos" USING btree ("compareciente_id", "tipo")
WHERE (("principal" = true) AND ("activo" = true) AND ("archived_at" IS NULL));

CREATE UNIQUE INDEX "uq_domicilio_principal_tipo"
ON "compareciente_domicilios" USING btree ("compareciente_id", "tipo")
WHERE (("principal" = true) AND ("vigente" = true) AND ("archived_at" IS NULL));

CREATE UNIQUE INDEX "uq_identificacion_principal"
ON "compareciente_identificaciones" USING btree ("compareciente_id", "tipo_identificacion")
WHERE (("principal" = true) AND ("estatus" = 'VIGENTE'::"EstatusIdentificacion") AND ("archived_at" IS NULL));

CREATE UNIQUE INDEX "uq_persona_fisica_curp_activa"
ON "personas_fisicas" USING btree (upper(TRIM(BOTH FROM "curp")))
WHERE (("curp" IS NOT NULL) AND (TRIM(BOTH FROM "curp") <> ''::text) AND ("archived_at" IS NULL));

CREATE UNIQUE INDEX "uq_persona_fisica_rfc_activo"
ON "personas_fisicas" USING btree (upper(TRIM(BOTH FROM "rfc")))
WHERE (("rfc" IS NOT NULL) AND (TRIM(BOTH FROM "rfc") <> ''::text) AND ("archived_at" IS NULL));

CREATE UNIQUE INDEX "uq_persona_moral_rfc_activo"
ON "personas_morales" USING btree (upper(TRIM(BOTH FROM "rfc")))
WHERE (("rfc" IS NOT NULL) AND (TRIM(BOTH FROM "rfc") <> ''::text) AND ("archived_at" IS NULL));

CREATE UNIQUE INDEX "uq_pareja_matrimonial_simetrica"
ON "relaciones_conyugales" USING btree (LEAST("persona_1_id", "persona_2_id"), GREATEST("persona_1_id", "persona_2_id"))
WHERE (("archived_at" IS NULL) AND ("vigente" = true));

-- Database-native trigger function and constraint triggers retained from production.
CREATE OR REPLACE FUNCTION "pravia_os"."fn_check_compareciente_perfil"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pravia_os', 'pg_temp'
AS $function$
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
$function$;

CREATE CONSTRAINT TRIGGER "trg_check_persona_fisica_perfil"
AFTER INSERT OR UPDATE ON "pravia_os"."personas_fisicas"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "pravia_os"."fn_check_compareciente_perfil"();

CREATE CONSTRAINT TRIGGER "trg_check_persona_moral_perfil"
AFTER INSERT OR UPDATE ON "pravia_os"."personas_morales"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "pravia_os"."fn_check_compareciente_perfil"();
