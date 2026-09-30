BEGIN;

SET LOCAL search_path TO pravia_os, public;

CREATE TYPE "ExpedienteFacturaEstado" AS ENUM ('PENDIENTE', 'CARGADA');

ALTER TABLE "expediente_ingresos_reportados"
  ADD COLUMN "forma_pago_detalle" TEXT,
  ADD COLUMN "factura_estado" "ExpedienteFacturaEstado",
  ADD COLUMN "facturar_a_vinculo_id" UUID,
  ADD COLUMN "facturar_a_compareciente_id" UUID,
  ADD COLUMN "factura_completada_por_id" UUID,
  ADD COLUMN "factura_completada_at" TIMESTAMP(3);

CREATE INDEX "idx_exp008_ingreso_factura_estado"
  ON "expediente_ingresos_reportados"("organization_id", "factura_estado", "created_at");
CREATE INDEX "idx_exp008_ingreso_facturar_a_fk"
  ON "expediente_ingresos_reportados"("facturar_a_vinculo_id", "organization_id", "expediente_id", "facturar_a_compareciente_id");
CREATE INDEX "idx_exp008_ingreso_factura_completador_fk"
  ON "expediente_ingresos_reportados"("factura_completada_por_id");

ALTER TABLE "expediente_ingresos_reportados"
  ADD CONSTRAINT "fk_exp008_ingreso_invoice_party_case"
  FOREIGN KEY ("facturar_a_vinculo_id", "organization_id", "expediente_id", "facturar_a_compareciente_id")
  REFERENCES "expediente_comparecientes"("id", "organization_id", "expediente_id", "compareciente_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "fk_exp008_ingreso_invoice_completer"
  FOREIGN KEY ("factura_completada_por_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ck_exp008_controlled_payment_method" CHECK (
    "factura_estado" IS NULL OR "forma_pago" IN ('CHEQUE', 'EFECTIVO', 'TRANSFERENCIA', 'OTRO')
  ),
  ADD CONSTRAINT "ck_exp008_other_payment_detail" CHECK (
    "factura_estado" IS NULL
    OR ("forma_pago" = 'OTRO' AND NULLIF(BTRIM("forma_pago_detalle"), '') IS NOT NULL)
    OR ("forma_pago" <> 'OTRO' AND "forma_pago_detalle" IS NULL)
  ),
  ADD CONSTRAINT "ck_exp008_invoice_workflow_fields" CHECK (
    "factura_estado" IS NULL
    OR (
      "facturar_a_vinculo_id" IS NOT NULL
      AND "facturar_a_compareciente_id" IS NOT NULL
      AND (
        ("factura_estado" = 'PENDIENTE' AND "factura_completada_por_id" IS NULL AND "factura_completada_at" IS NULL)
        OR
        ("factura_estado" = 'CARGADA' AND "factura_completada_por_id" IS NOT NULL AND "factura_completada_at" IS NOT NULL)
      )
    )
  );

DROP TRIGGER IF EXISTS "trg_exp008_invoice_completer_membership"
  ON pravia_os.expediente_ingresos_reportados;
CREATE TRIGGER "trg_exp008_invoice_completer_membership"
BEFORE INSERT OR UPDATE ON pravia_os.expediente_ingresos_reportados
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership('factura_completada_por_id');

ALTER TABLE "expediente_finanza_documentos"
  DROP CONSTRAINT "ck_exp008_document_role_consistency";

ALTER TABLE "expediente_finanza_documentos"
  ADD CONSTRAINT "ck_exp008_document_role_consistency" CHECK (
    ("tipo" = 'COMPROBANTE_INGRESO' AND "ingreso_reportado_id" IS NOT NULL AND "solicitud_pago_id" IS NULL AND "movimiento_id" IS NULL AND "comprobante_id" IS NULL)
    OR ("tipo" IN ('SOLICITUD_ORIGEN', 'SOLICITUD_GENERADA') AND "ingreso_reportado_id" IS NULL AND "solicitud_pago_id" IS NOT NULL AND "movimiento_id" IS NULL AND "comprobante_id" IS NULL)
    OR ("tipo" = 'COMPROBANTE_PAGO' AND "ingreso_reportado_id" IS NULL AND "solicitud_pago_id" IS NOT NULL AND "movimiento_id" IS NOT NULL AND "comprobante_id" IS NULL)
    OR ("tipo" = 'COMPROBANTE_FISCAL' AND (
      ("ingreso_reportado_id" IS NOT NULL AND "solicitud_pago_id" IS NULL AND "movimiento_id" IS NULL AND "comprobante_id" IS NULL)
      OR
      ("ingreso_reportado_id" IS NULL AND "solicitud_pago_id" IS NOT NULL AND "movimiento_id" IS NOT NULL AND "comprobante_id" IS NULL)
    ))
    OR ("tipo" = 'COMPROBANTE_PRAVIA' AND "ingreso_reportado_id" IS NULL AND "solicitud_pago_id" IS NULL AND "movimiento_id" IS NOT NULL AND "comprobante_id" IS NOT NULL)
  );

COMMIT;
