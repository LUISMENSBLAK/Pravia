-- B3 local fiscal domain. This migration never configures a PAC and never
-- creates a stamped document. Secrets are represented only by server-side
-- references.

CREATE TABLE "pravia_os"."entidades_fiscales_cfdi" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "razon_social" VARCHAR(300) NOT NULL,
  "rfc" VARCHAR(13) NOT NULL,
  "tipo_contribuyente" VARCHAR(20),
  "regimen_fiscal" VARCHAR(8) NOT NULL,
  "codigo_postal" VARCHAR(5) NOT NULL,
  "pac_provider" VARCHAR(80),
  "pac_secret_ref" VARCHAR(500),
  "csd_cer_storage_ref" VARCHAR(500),
  "csd_key_secret_ref" VARCHAR(500),
  "csd_password_secret_ref" VARCHAR(500),
  "csd_serial" VARCHAR(80),
  "csd_vigente_desde" TIMESTAMPTZ(6),
  "csd_vigente_hasta" TIMESTAMPTZ(6),
  "serie" VARCHAR(25),
  "siguiente_folio" BIGINT NOT NULL DEFAULT 1,
  "plantilla_id" UUID,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entidades_fiscales_cfdi_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_entidades_fiscales_cfdi_rfc" CHECK ("rfc" ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  CONSTRAINT "ck_entidades_fiscales_cfdi_cp" CHECK ("codigo_postal" ~ '^[0-9]{5}$'),
  CONSTRAINT "ck_entidades_fiscales_cfdi_folio" CHECK ("siguiente_folio" > 0),
  CONSTRAINT "ck_entidades_fiscales_cfdi_secret_refs" CHECK (
    "pac_secret_ref" IS NULL OR "pac_secret_ref" LIKE 'secret://%'
  ),
  CONSTRAINT "ck_entidades_fiscales_cfdi_csd_refs" CHECK (
    ("csd_key_secret_ref" IS NULL OR "csd_key_secret_ref" LIKE 'secret://%') AND
    ("csd_password_secret_ref" IS NULL OR "csd_password_secret_ref" LIKE 'secret://%')
  )
);

CREATE UNIQUE INDEX "uq_entidades_fiscales_cfdi_org_rfc" ON "pravia_os"."entidades_fiscales_cfdi"("organization_id", "rfc");
CREATE UNIQUE INDEX "uq_entidades_fiscales_cfdi_id_org" ON "pravia_os"."entidades_fiscales_cfdi"("id", "organization_id");
CREATE INDEX "idx_entidades_fiscales_cfdi_org_active" ON "pravia_os"."entidades_fiscales_cfdi"("organization_id", "activa");
CREATE INDEX "idx_entidades_fiscales_cfdi_creator" ON "pravia_os"."entidades_fiscales_cfdi"("organization_id", "created_by_id");

ALTER TABLE "pravia_os"."entidades_fiscales_cfdi"
  ADD CONSTRAINT "cfdi_entidad_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "cfdi_entidad_creator_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "pravia_os"."organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "pravia_os"."entidades_fiscales_cuentas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "entidad_fiscal_id" UUID NOT NULL,
  "cuenta_id" UUID NOT NULL,
  "predeterminada" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entidades_fiscales_cuentas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_entidad_fiscal_cuenta" ON "pravia_os"."entidades_fiscales_cuentas"("organization_id", "entidad_fiscal_id", "cuenta_id");
CREATE INDEX "idx_entidad_fiscal_cuenta_cuenta" ON "pravia_os"."entidades_fiscales_cuentas"("cuenta_id", "organization_id");
CREATE UNIQUE INDEX "uq_entidad_fiscal_cuenta_default" ON "pravia_os"."entidades_fiscales_cuentas"("organization_id", "entidad_fiscal_id") WHERE "predeterminada";

ALTER TABLE "pravia_os"."entidades_fiscales_cuentas"
  ADD CONSTRAINT "cfdi_entidad_cuenta_entidad_fkey" FOREIGN KEY ("entidad_fiscal_id", "organization_id") REFERENCES "pravia_os"."entidades_fiscales_cfdi"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "cfdi_entidad_cuenta_cuenta_fkey" FOREIGN KEY ("cuenta_id", "organization_id") REFERENCES "pravia_os"."cuentas_financieras"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "pravia_os"."proveedores_fiscales" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "razon_social" VARCHAR(300) NOT NULL,
  "rfc" VARCHAR(13) NOT NULL,
  "tipo_persona" VARCHAR(20),
  "codigo_postal" VARCHAR(5),
  "regimenes_fiscales" JSONB,
  "correo" VARCHAR(254),
  "telefono" VARCHAR(40),
  "datos_bancarios" JSONB,
  "csf_documento_id" UUID,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proveedores_fiscales_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_proveedores_fiscales_rfc" CHECK ("rfc" ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  CONSTRAINT "ck_proveedores_fiscales_cp" CHECK ("codigo_postal" IS NULL OR "codigo_postal" ~ '^[0-9]{5}$')
);

CREATE UNIQUE INDEX "uq_proveedores_fiscales_org_rfc" ON "pravia_os"."proveedores_fiscales"("organization_id", "rfc");
CREATE UNIQUE INDEX "uq_proveedores_fiscales_id_org" ON "pravia_os"."proveedores_fiscales"("id", "organization_id");
CREATE INDEX "idx_proveedores_fiscales_org_active" ON "pravia_os"."proveedores_fiscales"("organization_id", "activo");
CREATE INDEX "idx_proveedores_fiscales_creator" ON "pravia_os"."proveedores_fiscales"("organization_id", "created_by_id");

ALTER TABLE "pravia_os"."proveedores_fiscales"
  ADD CONSTRAINT "cfdi_proveedor_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "cfdi_proveedor_creator_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "pravia_os"."organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "pravia_os"."documentos_cfdi" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "direccion" VARCHAR(16) NOT NULL,
  "tipo" VARCHAR(8) NOT NULL,
  "estado" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  "version" VARCHAR(8) NOT NULL DEFAULT '4.0',
  "source" VARCHAR(32) NOT NULL DEFAULT 'LOCAL_DRAFT',
  "uuid_fiscal" VARCHAR(36),
  "serie" VARCHAR(25),
  "folio" VARCHAR(60),
  "entidad_fiscal_id" UUID,
  "proveedor_id" UUID,
  "expediente_id" UUID,
  "receptor_compareciente_id" UUID,
  "movimiento_id" UUID,
  "emisor_rfc" VARCHAR(13) NOT NULL,
  "emisor_nombre" VARCHAR(300) NOT NULL,
  "receptor_rfc" VARCHAR(13) NOT NULL,
  "receptor_nombre" VARCHAR(300) NOT NULL,
  "receptor_regimen" VARCHAR(8),
  "receptor_codigo_postal" VARCHAR(5),
  "uso_cfdi" VARCHAR(8),
  "metodo_pago" VARCHAR(3),
  "forma_pago" VARCHAR(3),
  "moneda" VARCHAR(8) NOT NULL DEFAULT 'MXN',
  "subtotal" DECIMAL(14,2) NOT NULL,
  "impuestos_trasladados" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "impuestos_retenidos" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL,
  "saldo" DECIMAL(14,2) NOT NULL,
  "fecha_emision" TIMESTAMPTZ(6),
  "fecha_timbrado" TIMESTAMPTZ(6),
  "draft_payload" JSONB NOT NULL,
  "provider" VARCHAR(80),
  "provider_reference" VARCHAR(180),
  "xml_documento_id" UUID,
  "pdf_documento_id" UUID,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "documentos_cfdi_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_documentos_cfdi_direccion" CHECK ("direccion" IN ('EMITIDO','RECIBIDO')),
  CONSTRAINT "ck_documentos_cfdi_tipo" CHECK ("tipo" IN ('I','E','P','T','N','RET')),
  CONSTRAINT "ck_documentos_cfdi_estado" CHECK ("estado" IN ('DRAFT','PREFACTURA','VIGENTE','TIMBRADO','CANCELACION_SOLICITADA','CANCELADO','SUSTITUIDO','RECIBIDO_VALIDADO')),
  CONSTRAINT "ck_documentos_cfdi_source" CHECK ("source" IN ('LOCAL_DRAFT','PAC','MANUAL_XML')),
  CONSTRAINT "ck_documentos_cfdi_metodo" CHECK ("metodo_pago" IS NULL OR "metodo_pago" IN ('PUE','PPD')),
  CONSTRAINT "ck_documentos_cfdi_totales" CHECK (
    "subtotal" >= 0 AND "impuestos_trasladados" >= 0 AND "impuestos_retenidos" >= 0 AND
    "total" > 0 AND "saldo" >= 0 AND "saldo" <= "total"
  ),
  CONSTRAINT "ck_documentos_cfdi_no_fake_stamp" CHECK (
    ("estado" NOT IN ('VIGENTE','TIMBRADO','CANCELACION_SOLICITADA','CANCELADO','SUSTITUIDO')) OR
    ("source" IN ('PAC','MANUAL_XML') AND "uuid_fiscal" IS NOT NULL AND "xml_documento_id" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "uq_documentos_cfdi_idempotency" ON "pravia_os"."documentos_cfdi"("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "uq_documentos_cfdi_id_org" ON "pravia_os"."documentos_cfdi"("id", "organization_id");
CREATE UNIQUE INDEX "uq_documentos_cfdi_org_uuid" ON "pravia_os"."documentos_cfdi"("organization_id", "uuid_fiscal") WHERE "uuid_fiscal" IS NOT NULL;
CREATE INDEX "idx_documentos_cfdi_org_state" ON "pravia_os"."documentos_cfdi"("organization_id", "direccion", "estado");
CREATE INDEX "idx_documentos_cfdi_expediente" ON "pravia_os"."documentos_cfdi"("expediente_id", "organization_id");
CREATE INDEX "idx_documentos_cfdi_movimiento" ON "pravia_os"."documentos_cfdi"("movimiento_id", "organization_id");

ALTER TABLE "pravia_os"."documentos_cfdi"
  ADD CONSTRAINT "cfdi_documento_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "cfdi_documento_creator_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "pravia_os"."organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "cfdi_documento_entidad_fkey" FOREIGN KEY ("entidad_fiscal_id", "organization_id") REFERENCES "pravia_os"."entidades_fiscales_cfdi"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "cfdi_documento_proveedor_fkey" FOREIGN KEY ("proveedor_id", "organization_id") REFERENCES "pravia_os"."proveedores_fiscales"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "cfdi_documento_expediente_fkey" FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "pravia_os"."expedientes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "cfdi_documento_receptor_fkey" FOREIGN KEY ("receptor_compareciente_id", "organization_id") REFERENCES "pravia_os"."comparecientes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "cfdi_documento_xml_fkey" FOREIGN KEY ("xml_documento_id", "organization_id") REFERENCES "pravia_os"."documentos"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "cfdi_documento_pdf_fkey" FOREIGN KEY ("pdf_documento_id", "organization_id") REFERENCES "pravia_os"."documentos"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "pravia_os"."cuentas_por_cobrar_cfdi" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL,
  "cfdi_id" UUID, "expediente_id" UUID, "concepto" VARCHAR(500) NOT NULL,
  "monto_total" DECIMAL(14,2) NOT NULL, "monto_cobrado" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "saldo" DECIMAL(14,2) NOT NULL, "fecha_vencimiento" DATE, "estado" VARCHAR(24) NOT NULL DEFAULT 'PENDIENTE',
  "created_by_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cuentas_por_cobrar_cfdi_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_cuentas_cobrar_cfdi_balance" CHECK ("monto_total" > 0 AND "monto_cobrado" >= 0 AND "saldo" = "monto_total" - "monto_cobrado" AND "saldo" >= 0)
);
CREATE UNIQUE INDEX "uq_cuentas_cobrar_cfdi_id_org" ON "pravia_os"."cuentas_por_cobrar_cfdi"("id","organization_id");
CREATE UNIQUE INDEX "uq_cuentas_cobrar_cfdi_documento" ON "pravia_os"."cuentas_por_cobrar_cfdi"("cfdi_id","organization_id");
CREATE INDEX "idx_cuentas_cobrar_cfdi_org_state" ON "pravia_os"."cuentas_por_cobrar_cfdi"("organization_id","estado");
CREATE INDEX "idx_cuentas_cobrar_cfdi_expediente" ON "pravia_os"."cuentas_por_cobrar_cfdi"("expediente_id","organization_id");
ALTER TABLE "pravia_os"."cuentas_por_cobrar_cfdi"
  ADD CONSTRAINT "cfdi_cxc_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_cxc_creator_fkey" FOREIGN KEY ("organization_id","created_by_id") REFERENCES "pravia_os"."organization_memberships"("organization_id","user_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_cxc_cfdi_fkey" FOREIGN KEY ("cfdi_id","organization_id") REFERENCES "pravia_os"."documentos_cfdi"("id","organization_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_cxc_expediente_fkey" FOREIGN KEY ("expediente_id","organization_id") REFERENCES "pravia_os"."expedientes"("id","organization_id") ON DELETE RESTRICT;

CREATE TABLE "pravia_os"."cuentas_por_pagar_cfdi" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL,
  "cfdi_id" UUID, "proveedor_id" UUID, "expediente_id" UUID, "concepto" VARCHAR(500) NOT NULL,
  "monto_total" DECIMAL(14,2) NOT NULL, "monto_pagado" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "saldo" DECIMAL(14,2) NOT NULL, "fecha_vencimiento" DATE, "estado" VARCHAR(24) NOT NULL DEFAULT 'PENDIENTE',
  "created_by_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cuentas_por_pagar_cfdi_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_cuentas_pagar_cfdi_balance" CHECK ("monto_total" > 0 AND "monto_pagado" >= 0 AND "saldo" = "monto_total" - "monto_pagado" AND "saldo" >= 0)
);
CREATE UNIQUE INDEX "uq_cuentas_pagar_cfdi_id_org" ON "pravia_os"."cuentas_por_pagar_cfdi"("id","organization_id");
CREATE UNIQUE INDEX "uq_cuentas_pagar_cfdi_documento" ON "pravia_os"."cuentas_por_pagar_cfdi"("cfdi_id","organization_id");
CREATE INDEX "idx_cuentas_pagar_cfdi_org_state" ON "pravia_os"."cuentas_por_pagar_cfdi"("organization_id","estado");
CREATE INDEX "idx_cuentas_pagar_cfdi_proveedor" ON "pravia_os"."cuentas_por_pagar_cfdi"("proveedor_id","organization_id");
CREATE INDEX "idx_cuentas_pagar_cfdi_expediente" ON "pravia_os"."cuentas_por_pagar_cfdi"("expediente_id","organization_id");
ALTER TABLE "pravia_os"."cuentas_por_pagar_cfdi"
  ADD CONSTRAINT "cfdi_cxp_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_cxp_creator_fkey" FOREIGN KEY ("organization_id","created_by_id") REFERENCES "pravia_os"."organization_memberships"("organization_id","user_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_cxp_cfdi_fkey" FOREIGN KEY ("cfdi_id","organization_id") REFERENCES "pravia_os"."documentos_cfdi"("id","organization_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_cxp_proveedor_fkey" FOREIGN KEY ("proveedor_id","organization_id") REFERENCES "pravia_os"."proveedores_fiscales"("id","organization_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_cxp_expediente_fkey" FOREIGN KEY ("expediente_id","organization_id") REFERENCES "pravia_os"."expedientes"("id","organization_id") ON DELETE RESTRICT;

CREATE TABLE "pravia_os"."aplicaciones_pago_cfdi" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL,
  "cfdi_id" UUID NOT NULL, "movimiento_id" UUID NOT NULL, "cuenta_por_cobrar_id" UUID, "cuenta_por_pagar_id" UUID,
  "monto_aplicado" DECIMAL(14,2) NOT NULL, "numero_parcialidad" INTEGER,
  "saldo_anterior" DECIMAL(14,2), "saldo_insoluto" DECIMAL(14,2),
  "rep_cfdi_id" UUID, "estado_rep" VARCHAR(32), "idempotency_key" VARCHAR(180) NOT NULL,
  "created_by_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aplicaciones_pago_cfdi_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_aplicaciones_pago_cfdi_amount" CHECK ("monto_aplicado" > 0),
  CONSTRAINT "ck_aplicaciones_pago_cfdi_account" CHECK (num_nonnulls("cuenta_por_cobrar_id","cuenta_por_pagar_id") <= 1),
  CONSTRAINT "ck_aplicaciones_pago_cfdi_balances" CHECK (("saldo_anterior" IS NULL AND "saldo_insoluto" IS NULL) OR ("saldo_anterior" >= "monto_aplicado" AND "saldo_insoluto" = "saldo_anterior" - "monto_aplicado"))
);
CREATE UNIQUE INDEX "uq_aplicaciones_pago_cfdi_idempotency" ON "pravia_os"."aplicaciones_pago_cfdi"("organization_id","idempotency_key");
CREATE UNIQUE INDEX "uq_aplicaciones_pago_cfdi_id_org" ON "pravia_os"."aplicaciones_pago_cfdi"("id","organization_id");
CREATE INDEX "idx_aplicaciones_pago_cfdi_cfdi" ON "pravia_os"."aplicaciones_pago_cfdi"("cfdi_id","organization_id");
CREATE INDEX "idx_aplicaciones_pago_cfdi_movimiento" ON "pravia_os"."aplicaciones_pago_cfdi"("movimiento_id","organization_id");
ALTER TABLE "pravia_os"."aplicaciones_pago_cfdi"
  ADD CONSTRAINT "cfdi_aplicacion_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_aplicacion_creator_fkey" FOREIGN KEY ("organization_id","created_by_id") REFERENCES "pravia_os"."organization_memberships"("organization_id","user_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_aplicacion_cfdi_fkey" FOREIGN KEY ("cfdi_id","organization_id") REFERENCES "pravia_os"."documentos_cfdi"("id","organization_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_aplicacion_movimiento_fkey" FOREIGN KEY ("movimiento_id","organization_id") REFERENCES "pravia_os"."movimientos_financieros"("id","organization_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_aplicacion_cxc_fkey" FOREIGN KEY ("cuenta_por_cobrar_id","organization_id") REFERENCES "pravia_os"."cuentas_por_cobrar_cfdi"("id","organization_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_aplicacion_cxp_fkey" FOREIGN KEY ("cuenta_por_pagar_id","organization_id") REFERENCES "pravia_os"."cuentas_por_pagar_cfdi"("id","organization_id") ON DELETE RESTRICT;

CREATE TABLE "pravia_os"."transferencias_internas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL,
  "cuenta_origen_id" UUID NOT NULL, "cuenta_destino_id" UUID NOT NULL,
  "movimiento_origen_id" UUID NOT NULL, "movimiento_destino_id" UUID NOT NULL,
  "monto" DECIMAL(14,2) NOT NULL, "referencia" VARCHAR(180), "idempotency_key" VARCHAR(180) NOT NULL,
  "created_by_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transferencias_internas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_transferencias_internas_amount" CHECK ("monto" > 0),
  CONSTRAINT "ck_transferencias_internas_accounts" CHECK ("cuenta_origen_id" <> "cuenta_destino_id")
);
CREATE UNIQUE INDEX "transferencias_internas_movimiento_origen_id_key" ON "pravia_os"."transferencias_internas"("movimiento_origen_id");
CREATE UNIQUE INDEX "transferencias_internas_movimiento_destino_id_key" ON "pravia_os"."transferencias_internas"("movimiento_destino_id");
CREATE UNIQUE INDEX "uq_transferencias_internas_idempotency" ON "pravia_os"."transferencias_internas"("organization_id","idempotency_key");
CREATE UNIQUE INDEX "uq_transferencias_internas_id_org" ON "pravia_os"."transferencias_internas"("id","organization_id");
CREATE INDEX "idx_transferencias_internas_origen" ON "pravia_os"."transferencias_internas"("cuenta_origen_id","organization_id");
CREATE INDEX "idx_transferencias_internas_destino" ON "pravia_os"."transferencias_internas"("cuenta_destino_id","organization_id");
ALTER TABLE "pravia_os"."transferencias_internas"
  ADD CONSTRAINT "cfdi_transferencia_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_transferencia_creator_fkey" FOREIGN KEY ("organization_id","created_by_id") REFERENCES "pravia_os"."organization_memberships"("organization_id","user_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_transferencia_cuenta_origen_fkey" FOREIGN KEY ("cuenta_origen_id","organization_id") REFERENCES "pravia_os"."cuentas_financieras"("id","organization_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_transferencia_cuenta_destino_fkey" FOREIGN KEY ("cuenta_destino_id","organization_id") REFERENCES "pravia_os"."cuentas_financieras"("id","organization_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_transferencia_movimiento_origen_fkey" FOREIGN KEY ("movimiento_origen_id","organization_id") REFERENCES "pravia_os"."movimientos_financieros"("id","organization_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "cfdi_transferencia_movimiento_destino_fkey" FOREIGN KEY ("movimiento_destino_id","organization_id") REFERENCES "pravia_os"."movimientos_financieros"("id","organization_id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION "pravia_os"."guard_cfdi_fiscal_immutability"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."estado" IN ('VIGENTE','TIMBRADO','CANCELACION_SOLICITADA','CANCELADO','SUSTITUIDO') AND (
    NEW."uuid_fiscal" IS DISTINCT FROM OLD."uuid_fiscal" OR
    NEW."emisor_rfc" IS DISTINCT FROM OLD."emisor_rfc" OR NEW."receptor_rfc" IS DISTINCT FROM OLD."receptor_rfc" OR
    NEW."subtotal" IS DISTINCT FROM OLD."subtotal" OR NEW."impuestos_trasladados" IS DISTINCT FROM OLD."impuestos_trasladados" OR
    NEW."impuestos_retenidos" IS DISTINCT FROM OLD."impuestos_retenidos" OR NEW."total" IS DISTINCT FROM OLD."total" OR
    NEW."xml_documento_id" IS DISTINCT FROM OLD."xml_documento_id" OR NEW."draft_payload" IS DISTINCT FROM OLD."draft_payload"
  ) THEN
    RAISE EXCEPTION 'CFDI_IMMUTABLE_AFTER_STAMP';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_guard_cfdi_fiscal_immutability"
BEFORE UPDATE ON "pravia_os"."documentos_cfdi"
FOR EACH ROW EXECUTE FUNCTION "pravia_os"."guard_cfdi_fiscal_immutability"();
