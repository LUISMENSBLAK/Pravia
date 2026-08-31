-- EXP-008 · Finanzas del expediente. Additive-first: no rows are backfilled or reclassified.
BEGIN;
SET LOCAL search_path TO pravia_os;

CREATE TYPE "ExpedienteIngresoReportadoEstado" AS ENUM ('PENDIENTE_APLICACION', 'APLICADO', 'ANULADO');
CREATE TYPE "ExpedienteSolicitudPagoVia" AS ENUM ('INTERNA', 'DOCUMENTO_EXTERNO');
CREATE TYPE "ExpedienteSolicitudPagoEstado" AS ENUM ('PENDIENTE', 'PAGADA', 'ANULADA');
CREATE TYPE "ExpedienteFinanzaDocumentoTipo" AS ENUM ('COMPROBANTE_INGRESO', 'SOLICITUD_ORIGEN', 'SOLICITUD_GENERADA', 'COMPROBANTE_PAGO', 'COMPROBANTE_FISCAL', 'COMPROBANTE_PRAVIA');
CREATE TYPE "ExpedienteFinanzaPropuestaEstado" AS ENUM ('PENDIENTE', 'VALIDADA', 'RECHAZADA', 'CONFLICTO');

ALTER TABLE "comprobantes_financieros"
  ADD COLUMN "verification_token_hash" TEXT,
  ADD COLUMN "verification_code_hint" TEXT,
  ADD COLUMN "verification_created_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "comprobantes_financieros_verification_token_hash_key" ON "comprobantes_financieros"("verification_token_hash");

-- Composite tenant keys support physical same-organization foreign keys.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_documentos_id_org_exp008" ON "documentos"("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_movimientos_id_org_exp008" ON "movimientos_financieros"("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_comprobantes_id_org_exp008" ON "comprobantes_financieros"("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_categorias_id_org_exp008" ON "categorias_financieras"("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cuentas_id_org_exp008" ON "cuentas_financieras"("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_formatos_id_org_exp008" ON "catalogo_artefacto_versiones"("id", "organization_id");

CREATE TABLE "expediente_ingresos_reportados" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "estado" "ExpedienteIngresoReportadoEstado" NOT NULL DEFAULT 'PENDIENTE_APLICACION',
  "concepto_contexto" TEXT,
  "referencia_solicitud" TEXT,
  "monto_reportado" DECIMAL(14,2),
  "monto_validado" DECIMAL(14,2),
  "honorarios_aplicados" DECIMAL(14,2),
  "impuestos_derechos_aplicados" DECIMAL(14,2),
  "fecha_ingreso" TIMESTAMP(3),
  "forma_pago" TEXT,
  "referencia" TEXT,
  "cuenta_id" UUID,
  "movimiento_id" UUID,
  "reportado_por_id" UUID NOT NULL,
  "aplicado_por_id" UUID,
  "aplicado_at" TIMESTAMP(3),
  "anulado_por_id" UUID,
  "anulado_at" TIMESTAMP(3),
  "motivo_anulacion" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expediente_ingresos_reportados_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_exp008_ingreso_amounts" CHECK (
    COALESCE("monto_reportado", 0) >= 0 AND COALESCE("monto_validado", 0) >= 0 AND
    COALESCE("honorarios_aplicados", 0) >= 0 AND COALESCE("impuestos_derechos_aplicados", 0) >= 0
  ),
  CONSTRAINT "ck_exp008_ingreso_applied_consistency" CHECK (
    ("estado" = 'APLICADO' AND "movimiento_id" IS NOT NULL AND "monto_validado" IS NOT NULL AND
      "monto_validado" = COALESCE("honorarios_aplicados", 0) + COALESCE("impuestos_derechos_aplicados", 0) AND "aplicado_por_id" IS NOT NULL AND "aplicado_at" IS NOT NULL)
    OR ("estado" <> 'APLICADO' AND "movimiento_id" IS NULL)
  )
);
CREATE UNIQUE INDEX "expediente_ingresos_reportados_movimiento_id_key" ON "expediente_ingresos_reportados"("movimiento_id");
CREATE UNIQUE INDEX "uq_exp008_ingreso_id_org" ON "expediente_ingresos_reportados"("id", "organization_id");
CREATE UNIQUE INDEX "uq_exp008_ingreso_idempotency" ON "expediente_ingresos_reportados"("organization_id", "expediente_id", "idempotency_key");
CREATE INDEX "idx_exp008_ingreso_pending" ON "expediente_ingresos_reportados"("organization_id", "expediente_id", "estado", "created_at");
CREATE INDEX "idx_exp008_ingreso_cuenta_fk" ON "expediente_ingresos_reportados"("cuenta_id");
CREATE INDEX "idx_exp008_ingreso_reportador_fk" ON "expediente_ingresos_reportados"("reportado_por_id");
CREATE INDEX "idx_exp008_ingreso_aplicador_fk" ON "expediente_ingresos_reportados"("aplicado_por_id");
CREATE INDEX "idx_exp008_ingreso_anulador_fk" ON "expediente_ingresos_reportados"("anulado_por_id");

CREATE TABLE "expediente_solicitudes_pago" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "via" "ExpedienteSolicitudPagoVia" NOT NULL,
  "estado" "ExpedienteSolicitudPagoEstado" NOT NULL DEFAULT 'PENDIENTE',
  "concepto" TEXT NOT NULL,
  "importe" DECIMAL(14,2) NOT NULL,
  "dependencia" TEXT,
  "beneficiario" TEXT,
  "referencia" TEXT,
  "fecha_limite" TIMESTAMP(3),
  "notas" TEXT,
  "categoria_id" UUID,
  "cuenta_id" UUID,
  "movimiento_id" UUID,
  "formato_version_id" UUID,
  "formato_fuente" TEXT,
  "creado_por_id" UUID NOT NULL,
  "pagado_por_id" UUID,
  "pagado_at" TIMESTAMP(3),
  "anulado_por_id" UUID,
  "anulado_at" TIMESTAMP(3),
  "motivo_anulacion" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expediente_solicitudes_pago_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_exp008_solicitud_importe" CHECK ("importe" > 0),
  CONSTRAINT "ck_exp008_solicitud_paid_consistency" CHECK (
    ("estado" = 'PAGADA' AND "movimiento_id" IS NOT NULL AND "categoria_id" IS NOT NULL AND "cuenta_id" IS NOT NULL AND "pagado_por_id" IS NOT NULL AND "pagado_at" IS NOT NULL)
    OR ("estado" <> 'PAGADA' AND "movimiento_id" IS NULL)
  )
);
CREATE UNIQUE INDEX "expediente_solicitudes_pago_movimiento_id_key" ON "expediente_solicitudes_pago"("movimiento_id");
CREATE UNIQUE INDEX "uq_exp008_solicitud_id_org" ON "expediente_solicitudes_pago"("id", "organization_id");
CREATE UNIQUE INDEX "uq_exp008_solicitud_idempotency" ON "expediente_solicitudes_pago"("organization_id", "expediente_id", "idempotency_key");
CREATE INDEX "idx_exp008_solicitud_pending" ON "expediente_solicitudes_pago"("organization_id", "expediente_id", "estado", "created_at");
CREATE INDEX "idx_exp008_solicitud_categoria_fk" ON "expediente_solicitudes_pago"("categoria_id");
CREATE INDEX "idx_exp008_solicitud_cuenta_fk" ON "expediente_solicitudes_pago"("cuenta_id");
CREATE INDEX "idx_exp008_solicitud_formato_fk" ON "expediente_solicitudes_pago"("formato_version_id");
CREATE INDEX "idx_exp008_solicitud_creador_fk" ON "expediente_solicitudes_pago"("creado_por_id");
CREATE INDEX "idx_exp008_solicitud_pagador_fk" ON "expediente_solicitudes_pago"("pagado_por_id");
CREATE INDEX "idx_exp008_solicitud_anulador_fk" ON "expediente_solicitudes_pago"("anulado_por_id");

CREATE TABLE "expediente_finanza_documentos" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "documento_id" UUID NOT NULL,
  "tipo" "ExpedienteFinanzaDocumentoTipo" NOT NULL,
  "ingreso_reportado_id" UUID,
  "solicitud_pago_id" UUID,
  "movimiento_id" UUID,
  "comprobante_id" UUID,
  "vinculado_por_id" UUID NOT NULL,
  "estatus" "VinculoEstatus" NOT NULL DEFAULT 'ACTIVO',
  "retirado_at" TIMESTAMP(3),
  "retirado_por_id" UUID,
  "motivo_retiro" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_finanza_documentos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_exp008_document_role_consistency" CHECK (
    ("tipo" = 'COMPROBANTE_INGRESO' AND "ingreso_reportado_id" IS NOT NULL AND "solicitud_pago_id" IS NULL AND "movimiento_id" IS NULL AND "comprobante_id" IS NULL)
    OR ("tipo" IN ('SOLICITUD_ORIGEN', 'SOLICITUD_GENERADA') AND "ingreso_reportado_id" IS NULL AND "solicitud_pago_id" IS NOT NULL AND "movimiento_id" IS NULL AND "comprobante_id" IS NULL)
    OR ("tipo" IN ('COMPROBANTE_PAGO', 'COMPROBANTE_FISCAL') AND "ingreso_reportado_id" IS NULL AND "solicitud_pago_id" IS NOT NULL AND "movimiento_id" IS NOT NULL AND "comprobante_id" IS NULL)
    OR ("tipo" = 'COMPROBANTE_PRAVIA' AND "ingreso_reportado_id" IS NULL AND "solicitud_pago_id" IS NULL AND "movimiento_id" IS NOT NULL AND "comprobante_id" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "uq_exp008_documento_idempotency" ON "expediente_finanza_documentos"("organization_id", "expediente_id", "idempotency_key");
CREATE INDEX "idx_exp008_documento_tenant_type" ON "expediente_finanza_documentos"("organization_id", "expediente_id", "tipo", "estatus");
CREATE INDEX "idx_exp008_documento_documento_fk" ON "expediente_finanza_documentos"("documento_id");
CREATE INDEX "idx_exp008_documento_ingreso_fk" ON "expediente_finanza_documentos"("ingreso_reportado_id");
CREATE INDEX "idx_exp008_documento_solicitud_fk" ON "expediente_finanza_documentos"("solicitud_pago_id");
CREATE INDEX "idx_exp008_documento_movimiento_fk" ON "expediente_finanza_documentos"("movimiento_id");
CREATE INDEX "idx_exp008_documento_comprobante_fk" ON "expediente_finanza_documentos"("comprobante_id");
CREATE INDEX "idx_exp008_documento_vinculador_fk" ON "expediente_finanza_documentos"("vinculado_por_id");
CREATE INDEX "idx_exp008_documento_retirador_fk" ON "expediente_finanza_documentos"("retirado_por_id");

CREATE TABLE "expediente_finanza_propuestas_ia" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "documento_id" UUID NOT NULL,
  "ingreso_reportado_id" UUID,
  "solicitud_pago_id" UUID,
  "estado" "ExpedienteFinanzaPropuestaEstado" NOT NULL DEFAULT 'PENDIENTE',
  "propuesta" JSONB NOT NULL,
  "provenance" JSONB NOT NULL,
  "conflictos" JSONB,
  "faltantes" JSONB,
  "modelo" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "revisado_por_id" UUID,
  "revisado_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expediente_finanza_propuestas_ia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_exp008_proposal_parent" CHECK (num_nonnulls("ingreso_reportado_id", "solicitud_pago_id") = 1)
);
CREATE UNIQUE INDEX "uq_exp008_ai_operation_tenant" ON "expediente_finanza_propuestas_ia"("organization_id", "operation_id");
CREATE INDEX "idx_exp008_propuesta_tenant_state" ON "expediente_finanza_propuestas_ia"("organization_id", "expediente_id", "estado");
CREATE INDEX "idx_exp008_propuesta_documento_fk" ON "expediente_finanza_propuestas_ia"("documento_id");
CREATE INDEX "idx_exp008_propuesta_ingreso_fk" ON "expediente_finanza_propuestas_ia"("ingreso_reportado_id");
CREATE INDEX "idx_exp008_propuesta_solicitud_fk" ON "expediente_finanza_propuestas_ia"("solicitud_pago_id");
CREATE INDEX "idx_exp008_propuesta_revisor_fk" ON "expediente_finanza_propuestas_ia"("revisado_por_id");

ALTER TABLE "expediente_ingresos_reportados" ADD CONSTRAINT "fk_exp008_ingreso_exp_org" FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "pravia_os"."expedientes"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_ingresos_reportados" ADD CONSTRAINT "fk_exp008_ingreso_cuenta_org" FOREIGN KEY ("cuenta_id", "organization_id") REFERENCES "pravia_os"."cuentas_financieras"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_ingresos_reportados" ADD CONSTRAINT "fk_exp008_ingreso_mov_org" FOREIGN KEY ("movimiento_id", "organization_id") REFERENCES "pravia_os"."movimientos_financieros"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_ingresos_reportados" ADD CONSTRAINT "fk_exp008_ingreso_reportador" FOREIGN KEY ("reportado_por_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT;
ALTER TABLE "expediente_ingresos_reportados" ADD CONSTRAINT "fk_exp008_ingreso_aplicador" FOREIGN KEY ("aplicado_por_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT;
ALTER TABLE "expediente_ingresos_reportados" ADD CONSTRAINT "fk_exp008_ingreso_anulador" FOREIGN KEY ("anulado_por_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT;

ALTER TABLE "expediente_solicitudes_pago" ADD CONSTRAINT "fk_exp008_solicitud_exp_org" FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "pravia_os"."expedientes"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_solicitudes_pago" ADD CONSTRAINT "fk_exp008_solicitud_categoria_org" FOREIGN KEY ("categoria_id", "organization_id") REFERENCES "pravia_os"."categorias_financieras"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_solicitudes_pago" ADD CONSTRAINT "fk_exp008_solicitud_cuenta_org" FOREIGN KEY ("cuenta_id", "organization_id") REFERENCES "pravia_os"."cuentas_financieras"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_solicitudes_pago" ADD CONSTRAINT "fk_exp008_solicitud_mov_org" FOREIGN KEY ("movimiento_id", "organization_id") REFERENCES "pravia_os"."movimientos_financieros"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_solicitudes_pago" ADD CONSTRAINT "fk_exp008_solicitud_formato_org" FOREIGN KEY ("formato_version_id", "organization_id") REFERENCES "pravia_os"."catalogo_artefacto_versiones"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_solicitudes_pago" ADD CONSTRAINT "fk_exp008_solicitud_creador" FOREIGN KEY ("creado_por_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT;
ALTER TABLE "expediente_solicitudes_pago" ADD CONSTRAINT "fk_exp008_solicitud_pagador" FOREIGN KEY ("pagado_por_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT;
ALTER TABLE "expediente_solicitudes_pago" ADD CONSTRAINT "fk_exp008_solicitud_anulador" FOREIGN KEY ("anulado_por_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT;

ALTER TABLE "expediente_finanza_documentos" ADD CONSTRAINT "fk_exp008_doc_exp_org" FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "pravia_os"."expedientes"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_finanza_documentos" ADD CONSTRAINT "fk_exp008_doc_document_org" FOREIGN KEY ("documento_id", "organization_id") REFERENCES "pravia_os"."documentos"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_finanza_documentos" ADD CONSTRAINT "fk_exp008_doc_ingreso_org" FOREIGN KEY ("ingreso_reportado_id", "organization_id") REFERENCES "pravia_os"."expediente_ingresos_reportados"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_finanza_documentos" ADD CONSTRAINT "fk_exp008_doc_solicitud_org" FOREIGN KEY ("solicitud_pago_id", "organization_id") REFERENCES "pravia_os"."expediente_solicitudes_pago"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_finanza_documentos" ADD CONSTRAINT "fk_exp008_doc_mov_org" FOREIGN KEY ("movimiento_id", "organization_id") REFERENCES "pravia_os"."movimientos_financieros"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_finanza_documentos" ADD CONSTRAINT "fk_exp008_doc_receipt_org" FOREIGN KEY ("comprobante_id", "organization_id") REFERENCES "pravia_os"."comprobantes_financieros"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_finanza_documentos" ADD CONSTRAINT "fk_exp008_doc_vinculador" FOREIGN KEY ("vinculado_por_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT;
ALTER TABLE "expediente_finanza_documentos" ADD CONSTRAINT "fk_exp008_doc_retirador" FOREIGN KEY ("retirado_por_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT;

ALTER TABLE "expediente_finanza_propuestas_ia" ADD CONSTRAINT "fk_exp008_ai_exp_org" FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "pravia_os"."expedientes"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_finanza_propuestas_ia" ADD CONSTRAINT "fk_exp008_ai_document_org" FOREIGN KEY ("documento_id", "organization_id") REFERENCES "pravia_os"."documentos"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_finanza_propuestas_ia" ADD CONSTRAINT "fk_exp008_ai_ingreso_org" FOREIGN KEY ("ingreso_reportado_id", "organization_id") REFERENCES "pravia_os"."expediente_ingresos_reportados"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_finanza_propuestas_ia" ADD CONSTRAINT "fk_exp008_ai_solicitud_org" FOREIGN KEY ("solicitud_pago_id", "organization_id") REFERENCES "pravia_os"."expediente_solicitudes_pago"("id", "organization_id") ON DELETE RESTRICT;
ALTER TABLE "expediente_finanza_propuestas_ia" ADD CONSTRAINT "fk_exp008_ai_revisor" FOREIGN KEY ("revisado_por_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT;

-- Actor references are also constrained by canonical organization membership.
DO $$
DECLARE relation RECORD; trigger_name TEXT;
BEGIN
  FOR relation IN SELECT * FROM (VALUES
    ('expediente_ingresos_reportados','reportado_por_id'),
    ('expediente_ingresos_reportados','aplicado_por_id'),
    ('expediente_ingresos_reportados','anulado_por_id'),
    ('expediente_solicitudes_pago','creado_por_id'),
    ('expediente_solicitudes_pago','pagado_por_id'),
    ('expediente_solicitudes_pago','anulado_por_id'),
    ('expediente_finanza_documentos','vinculado_por_id'),
    ('expediente_finanza_documentos','retirado_por_id'),
    ('expediente_finanza_propuestas_ia','revisado_por_id')
  ) AS relations(child_table, user_column)
  LOOP
    trigger_name := 'trg_exp008_membership_' || relation.child_table || '_' || relation.user_column;
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON pravia_os.%I FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership(%L)', trigger_name, relation.child_table, relation.user_column);
  END LOOP;
END $$;

COMMIT;
