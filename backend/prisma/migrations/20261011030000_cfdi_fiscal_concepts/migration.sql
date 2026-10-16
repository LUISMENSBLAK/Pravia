-- Tax configuration is explicit per tenant/issuer/act. No universal tax
-- defaults are introduced by this migration.
CREATE TABLE "pravia_os"."conceptos_fiscales_cfdi" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "entidad_fiscal_id" UUID NOT NULL,
  "tipo_acto_id" UUID,
  "descripcion" VARCHAR(500) NOT NULL,
  "clave_prod_serv" VARCHAR(8) NOT NULL,
  "clave_unidad" VARCHAR(8) NOT NULL,
  "objeto_impuesto" VARCHAR(2) NOT NULL,
  "iva_tasa" DECIMAL(9,6) NOT NULL,
  "iva_retencion_tasa" DECIMAL(9,6) NOT NULL,
  "isr_retencion_tasa" DECIMAL(9,6) NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conceptos_fiscales_cfdi_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cfdi_concepto_tax_nonnegative" CHECK (
    iva_tasa BETWEEN 0 AND 1 AND iva_retencion_tasa BETWEEN 0 AND 1 AND isr_retencion_tasa BETWEEN 0 AND 1
  )
);

CREATE INDEX "idx_cfdi_concepto_contexto"
  ON "pravia_os"."conceptos_fiscales_cfdi" ("organization_id", "entidad_fiscal_id", "tipo_acto_id", "activo");

ALTER TABLE "pravia_os"."conceptos_fiscales_cfdi"
  ADD CONSTRAINT "cfdi_concepto_entidad_fkey"
  FOREIGN KEY ("entidad_fiscal_id", "organization_id")
  REFERENCES "pravia_os"."entidades_fiscales_cfdi" ("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "pravia_os"."conceptos_fiscales_cfdi"
  ADD CONSTRAINT "cfdi_concepto_acto_fkey"
  FOREIGN KEY ("tipo_acto_id")
  REFERENCES "pravia_os"."tipos_acto" ("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "pravia_os"."conceptos_fiscales_cfdi"
  ADD CONSTRAINT "cfdi_concepto_creator_fkey"
  FOREIGN KEY ("organization_id", "created_by_id")
  REFERENCES "pravia_os"."organization_memberships" ("organization_id", "user_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
