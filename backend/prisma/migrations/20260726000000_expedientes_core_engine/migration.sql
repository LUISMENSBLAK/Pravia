-- CreateEnum
CREATE TYPE "VinculoEstatus" AS ENUM ('ACTIVO', 'INACTIVO', 'SUSTITUIDO');

-- CreateEnum
CREATE TYPE "TipoPersona" AS ENUM ('FISICA', 'MORAL');

-- CreateEnum
CREATE TYPE "ComparecePor" AS ENUM ('PROPIO_DERECHO', 'REPRESENTACION');

-- CreateEnum
CREATE TYPE "RequisitoDocEstatus" AS ENUM ('PENDIENTE', 'RECIBIDO', 'EN_REVISION', 'VALIDADO', 'RECHAZADO', 'VENCIDO', 'OMITIDO_JUSTIFICADO');

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('PAGO_UNICO', 'ANTICIPO', 'ABONO', 'PAGO_CONTRA_FIRMA', 'PAGO_CONTRA_ENTREGA', 'AJUSTE', 'DEVOLUCION', 'EGRESO_NOTARIA', 'EGRESO_TERCEROS');

-- CreateEnum
CREATE TYPE "NaturalezaMovimiento" AS ENUM ('INGRESO', 'EGRESO');

-- CreateEnum
CREATE TYPE "EstatusMovimiento" AS ENUM ('PENDIENTE', 'RECIBIDO', 'VALIDADO', 'RECHAZADO', 'REVERTIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "TipoActividad" AS ENUM ('CAMBIO_ESTATUS', 'CAMBIO_ETAPA', 'SEGUIMIENTO', 'DOCUMENTO', 'PAGO', 'TAREA', 'COMUNICACION', 'COMPARECIENTE', 'AUDITORIA');

-- CreateEnum
CREATE TYPE "OutboxEstatus" AS ENUM ('PENDIENTE', 'PROCESANDO', 'PROCESADO', 'FALLIDO');

-- CreateEnum
CREATE TYPE "ProcessingLogEstatus" AS ENUM ('PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'FALLIDO');

-- CreateEnum
CREATE TYPE "TareaPrioridad" AS ENUM ('BAJA', 'MEDIA', 'ALTA', 'URGENTE');

-- CreateEnum
CREATE TYPE "TareaEstatus" AS ENUM ('PENDIENTE', 'EN_PROCESO', 'COMPLETADA', 'CANCELADA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocCategoria" ADD VALUE 'REGISTRO';
ALTER TYPE "DocCategoria" ADD VALUE 'CATASTRO';
ALTER TYPE "DocCategoria" ADD VALUE 'UIF';
ALTER TYPE "DocCategoria" ADD VALUE 'BANCO';
ALTER TYPE "DocCategoria" ADD VALUE 'SAT';
ALTER TYPE "DocCategoria" ADD VALUE 'FIDEICOMISO';
ALTER TYPE "DocCategoria" ADD VALUE 'OTROS';

-- AlterEnum
BEGIN;
CREATE TYPE "ExpedienteEstatus_new" AS ENUM ('ABIERTO', 'EN_INTEGRACION', 'EN_PROCESO', 'PENDIENTE_CLIENTE', 'PENDIENTE_NOTARIA', 'FIRMA_PROGRAMADA', 'FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'ENTREGADO', 'SUSPENDIDO', 'CANCELADO');
ALTER TABLE "expedientes" ALTER COLUMN "estatus" DROP DEFAULT;
ALTER TABLE "expedientes" ALTER COLUMN "estatus" TYPE "ExpedienteEstatus_new" USING ("estatus"::text::"ExpedienteEstatus_new");
ALTER TABLE "expediente_estatus_log" ALTER COLUMN "estatus_anterior" TYPE "ExpedienteEstatus_new" USING ("estatus_anterior"::text::"ExpedienteEstatus_new");
ALTER TABLE "expediente_estatus_log" ALTER COLUMN "estatus_nuevo" TYPE "ExpedienteEstatus_new" USING ("estatus_nuevo"::text::"ExpedienteEstatus_new");
ALTER TYPE "ExpedienteEstatus" RENAME TO "ExpedienteEstatus_old";
ALTER TYPE "ExpedienteEstatus_new" RENAME TO "ExpedienteEstatus";
DROP TYPE "ExpedienteEstatus_old";
ALTER TABLE "expedientes" ALTER COLUMN "estatus" SET DEFAULT 'ABIERTO';
COMMIT;

-- DropForeignKey
ALTER TABLE "checklist_items" DROP CONSTRAINT "checklist_items_tipo_acto_id_fkey";

-- DropForeignKey
ALTER TABLE "expediente_comparecientes" DROP CONSTRAINT "expediente_comparecientes_expediente_id_fkey";

-- DropForeignKey
ALTER TABLE "expediente_estatus_log" DROP CONSTRAINT "expediente_estatus_log_expediente_id_fkey";

-- DropForeignKey
ALTER TABLE "expedientes" DROP CONSTRAINT "expedientes_cotizacion_id_fkey";

-- DropForeignKey
ALTER TABLE "pagos" DROP CONSTRAINT "pagos_cotizacion_id_fkey";

-- DropForeignKey
ALTER TABLE "pagos" DROP CONSTRAINT "pagos_expediente_id_fkey";

-- DropForeignKey
ALTER TABLE "tareas_externas" DROP CONSTRAINT "tareas_externas_expediente_id_fkey";

-- DropIndex
DROP INDEX "expediente_comparecientes_expediente_id_compareciente_id_ro_key";

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "correlation_id" UUID,
ADD COLUMN     "event_id" UUID,
ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "session_id" TEXT,
ADD COLUMN     "user_agent" TEXT,
ADD COLUMN     "valores_anteriores" JSONB,
ADD COLUMN     "valores_nuevos" JSONB;

-- AlterTable
ALTER TABLE "comparecientes" ADD COLUMN     "razon_social" TEXT,
ADD COLUMN     "tipo_persona" "TipoPersona" NOT NULL DEFAULT 'FISICA',
ALTER COLUMN "apellido_paterno" DROP NOT NULL;

-- AlterTable
ALTER TABLE "cotizacion_versiones" DROP COLUMN "notaria_neto",
DROP COLUMN "pravia_modalidad",
DROP COLUMN "pravia_porcentaje";

-- AlterTable
ALTER TABLE "cotizaciones" DROP COLUMN "notaria_neto",
DROP COLUMN "pravia_modalidad",
DROP COLUMN "pravia_porcentaje",
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "documentos" ALTER COLUMN "categoria" SET DEFAULT 'PROYECTO';

-- AlterTable
ALTER TABLE "eventos_agenda" ADD COLUMN     "event_id" UUID,
ADD COLUMN     "idempotency_key" TEXT;

-- AlterTable
ALTER TABLE "expediente_comparecientes" DROP COLUMN "datos_validados_cliente",
DROP COLUMN "rol",
ADD COLUMN     "caracter_representacion" TEXT,
ADD COLUMN     "comparece_por" "ComparecePor" NOT NULL DEFAULT 'PROPIO_DERECHO',
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "datos_validados" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "es_beneficiario_controlador" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "es_proveedor_recursos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "instrumento_representacion" TEXT,
ADD COLUMN     "observaciones_uif" TEXT,
ADD COLUMN     "porcentaje_participacion" DECIMAL(5,2),
ADD COLUMN     "representado_id" UUID,
ADD COLUMN     "rol_juridico" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "expedientes" DROP COLUMN "fecha_firma",
ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "archived_by" UUID,
ADD COLUMN     "avance_documental" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "avance_financiero" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "avance_general" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "avance_operativo" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "datos_operacion" JSONB,
ADD COLUMN     "descripcion" TEXT,
ADD COLUMN     "etapa_actual_nombre" TEXT DEFAULT 'Apertura de Expediente',
ADD COLUMN     "expediente_etapa_actual_id" UUID,
ADD COLUMN     "fecha_entrega_cliente" TIMESTAMP(3),
ADD COLUMN     "fecha_estimada_firma" TIMESTAMP(3),
ADD COLUMN     "fecha_limite_accion" TIMESTAMP(3),
ADD COLUMN     "fecha_real_firma" TIMESTAMP(3),
ADD COLUMN     "flujo_version_id" UUID,
ADD COLUMN     "formulario_version_id" UUID,
ADD COLUMN     "gestor_id" UUID,
ADD COLUMN     "motivo_archivo" TEXT,
ADD COLUMN     "notaria_id" UUID,
ADD COLUMN     "plantilla_doc_version_id" UUID,
ADD COLUMN     "proxima_accion" TEXT,
ADD COLUMN     "subtipo_acto" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "valor_operacion" DECIMAL(14,2),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "estatus" SET DEFAULT 'ABIERTO';

-- AlterTable
ALTER TABLE "tipos_acto" ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

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
CREATE TABLE "compareciente_documentos" (
    "id" UUID NOT NULL,
    "compareciente_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "tipo_vinculo" TEXT NOT NULL,
    "fecha_vinculo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" UUID NOT NULL,
    "estatus" "VinculoEstatus" NOT NULL DEFAULT 'ACTIVO',
    "inactivado_at" TIMESTAMP(3),
    "inactivado_por_id" UUID,
    "motivo_inactivacion" TEXT,
    "observaciones" TEXT,

    CONSTRAINT "compareciente_documentos_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE UNIQUE INDEX "formulario_secciones_tipo_acto_id_clave_key" ON "formulario_secciones"("tipo_acto_id", "clave");

-- CreateIndex
CREATE UNIQUE INDEX "formulario_campos_seccion_id_clave_tecnica_key" ON "formulario_campos"("seccion_id", "clave_tecnica");

-- CreateIndex
CREATE UNIQUE INDEX "flujo_etapas_tipo_acto_id_clave_key" ON "flujo_etapas"("tipo_acto_id", "clave");

-- CreateIndex
CREATE UNIQUE INDEX "formulario_versiones_tipo_acto_id_version_key" ON "formulario_versiones"("tipo_acto_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "flujo_versiones_tipo_acto_id_version_key" ON "flujo_versiones"("tipo_acto_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "plantilla_documental_versiones_tipo_acto_id_version_key" ON "plantilla_documental_versiones"("tipo_acto_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "expediente_documentos_expediente_id_documento_id_tipo_vincu_key" ON "expediente_documentos"("expediente_id", "documento_id", "tipo_vinculo");

-- CreateIndex
CREATE UNIQUE INDEX "cotizacion_documentos_cotizacion_id_documento_id_tipo_vincu_key" ON "cotizacion_documentos"("cotizacion_id", "documento_id", "tipo_vinculo");

-- CreateIndex
CREATE UNIQUE INDEX "compareciente_documentos_compareciente_id_documento_id_tipo_key" ON "compareciente_documentos"("compareciente_id", "documento_id", "tipo_vinculo");

-- CreateIndex
CREATE UNIQUE INDEX "prospecto_documentos_prospecto_id_documento_id_tipo_vinculo_key" ON "prospecto_documentos"("prospecto_id", "documento_id", "tipo_vinculo");

-- CreateIndex
CREATE UNIQUE INDEX "requisito_documento_vinculos_requisito_id_documento_id_key" ON "requisito_documento_vinculos"("requisito_id", "documento_id");

-- CreateIndex
CREATE UNIQUE INDEX "movimiento_documentos_movimiento_id_documento_id_tipo_vincu_key" ON "movimiento_documentos"("movimiento_id", "documento_id", "tipo_vinculo");

-- CreateIndex
CREATE UNIQUE INDEX "comunicacion_documentos_comunicacion_id_documento_id_tipo_v_key" ON "comunicacion_documentos"("comunicacion_id", "documento_id", "tipo_vinculo");

-- CreateIndex
CREATE UNIQUE INDEX "domain_event_processing_logs_event_id_handler_name_key" ON "domain_event_processing_logs"("event_id", "handler_name");

-- CreateIndex
CREATE UNIQUE INDEX "tareas_idempotency_key_key" ON "tareas"("idempotency_key");

-- CreateIndex
CREATE INDEX "comparecientes_curp_idx" ON "comparecientes"("curp");

-- CreateIndex
CREATE INDEX "comparecientes_rfc_idx" ON "comparecientes"("rfc");

-- CreateIndex
CREATE INDEX "comparecientes_nombre_apellido_paterno_idx" ON "comparecientes"("nombre", "apellido_paterno");

-- CreateIndex
CREATE INDEX "comparecientes_razon_social_idx" ON "comparecientes"("razon_social");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_agenda_idempotency_key_key" ON "eventos_agenda"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "expediente_comparecientes_expediente_id_compareciente_id_ro_key" ON "expediente_comparecientes"("expediente_id", "compareciente_id", "rol_juridico");

-- CreateIndex
CREATE UNIQUE INDEX "expedientes_expediente_etapa_actual_id_key" ON "expedientes"("expediente_etapa_actual_id");

-- AddForeignKey
ALTER TABLE "formulario_secciones" ADD CONSTRAINT "formulario_secciones_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulario_campos" ADD CONSTRAINT "formulario_campos_seccion_id_fkey" FOREIGN KEY ("seccion_id") REFERENCES "formulario_secciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flujo_etapas" ADD CONSTRAINT "flujo_etapas_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulario_versiones" ADD CONSTRAINT "formulario_versiones_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulario_versiones" ADD CONSTRAINT "formulario_versiones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flujo_versiones" ADD CONSTRAINT "flujo_versiones_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flujo_versiones" ADD CONSTRAINT "flujo_versiones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantilla_documental_versiones" ADD CONSTRAINT "plantilla_documental_versiones_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantilla_documental_versiones" ADD CONSTRAINT "plantilla_documental_versiones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_gestor_id_fkey" FOREIGN KEY ("gestor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_notaria_id_fkey" FOREIGN KEY ("notaria_id") REFERENCES "notarias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_formulario_version_id_fkey" FOREIGN KEY ("formulario_version_id") REFERENCES "formulario_versiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_flujo_version_id_fkey" FOREIGN KEY ("flujo_version_id") REFERENCES "flujo_versiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_plantilla_doc_version_id_fkey" FOREIGN KEY ("plantilla_doc_version_id") REFERENCES "plantilla_documental_versiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_expediente_etapa_actual_id_fkey" FOREIGN KEY ("expediente_etapa_actual_id") REFERENCES "expediente_etapas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_estatus_log" ADD CONSTRAINT "expediente_estatus_log_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_etapas" ADD CONSTRAINT "expediente_etapas_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_etapas" ADD CONSTRAINT "expediente_etapas_flujo_etapa_id_fkey" FOREIGN KEY ("flujo_etapa_id") REFERENCES "flujo_etapas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_etapas" ADD CONSTRAINT "expediente_etapas_flujo_version_id_fkey" FOREIGN KEY ("flujo_version_id") REFERENCES "flujo_versiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_documentos" ADD CONSTRAINT "expediente_documentos_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_documentos" ADD CONSTRAINT "expediente_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_documentos" ADD CONSTRAINT "expediente_documentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_documentos" ADD CONSTRAINT "cotizacion_documentos_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_documentos" ADD CONSTRAINT "cotizacion_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion_documentos" ADD CONSTRAINT "cotizacion_documentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_documentos" ADD CONSTRAINT "compareciente_documentos_compareciente_id_fkey" FOREIGN KEY ("compareciente_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_documentos" ADD CONSTRAINT "compareciente_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compareciente_documentos" ADD CONSTRAINT "compareciente_documentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_documentos" ADD CONSTRAINT "prospecto_documentos_prospecto_id_fkey" FOREIGN KEY ("prospecto_id") REFERENCES "prospectos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_documentos" ADD CONSTRAINT "prospecto_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_documentos" ADD CONSTRAINT "prospecto_documentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisito_documento_vinculos" ADD CONSTRAINT "requisito_documento_vinculos_requisito_id_fkey" FOREIGN KEY ("requisito_id") REFERENCES "expediente_requisitos_doc"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisito_documento_vinculos" ADD CONSTRAINT "requisito_documento_vinculos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisito_documento_vinculos" ADD CONSTRAINT "requisito_documento_vinculos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_documentos" ADD CONSTRAINT "movimiento_documentos_movimiento_id_fkey" FOREIGN KEY ("movimiento_id") REFERENCES "movimientos_financieros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_documentos" ADD CONSTRAINT "movimiento_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_documentos" ADD CONSTRAINT "movimiento_documentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicacion_documentos" ADD CONSTRAINT "comunicacion_documentos_comunicacion_id_fkey" FOREIGN KEY ("comunicacion_id") REFERENCES "comunicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicacion_documentos" ADD CONSTRAINT "comunicacion_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicacion_documentos" ADD CONSTRAINT "comunicacion_documentos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_comparecientes" ADD CONSTRAINT "expediente_comparecientes_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_comparecientes" ADD CONSTRAINT "expediente_comparecientes_representado_id_fkey" FOREIGN KEY ("representado_id") REFERENCES "comparecientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_requisitos_doc" ADD CONSTRAINT "expediente_requisitos_doc_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_capturado_por_id_fkey" FOREIGN KEY ("capturado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_validado_por_id_fkey" FOREIGN KEY ("validado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_revertido_por_id_fkey" FOREIGN KEY ("revertido_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_financieros" ADD CONSTRAINT "movimientos_financieros_movimiento_origen_id_fkey" FOREIGN KEY ("movimiento_origen_id") REFERENCES "movimientos_financieros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_actividades" ADD CONSTRAINT "expediente_actividades_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expediente_actividades" ADD CONSTRAINT "expediente_actividades_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_event_outbox" ADD CONSTRAINT "domain_event_outbox_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_event_processing_logs" ADD CONSTRAINT "domain_event_processing_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "domain_event_outbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas" ADD CONSTRAINT "tareas_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas" ADD CONSTRAINT "tareas_asignado_a_id_fkey" FOREIGN KEY ("asignado_a_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas" ADD CONSTRAINT "tareas_creador_id_fkey" FOREIGN KEY ("creador_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas_externas" ADD CONSTRAINT "tareas_externas_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Rule 8: Unique Partial Index for Single Active Stage per Expediente
CREATE UNIQUE INDEX "expediente_etapa_activa_unica" 
ON "expediente_etapas" ("expediente_id") 
WHERE "fecha_fin" IS NULL AND "completada" = false;
