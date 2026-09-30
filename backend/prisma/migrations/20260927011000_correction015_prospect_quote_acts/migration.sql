-- Correction 015: structured Prospecto -> Cotizacion act lineage and editable
-- operation/e-mail context. Legacy textual fields remain available read-only.

ALTER TABLE "pravia_os"."prospectos"
  ADD COLUMN "contexto_operacion" TEXT;

ALTER TABLE "pravia_os"."cotizaciones"
  ADD COLUMN "correo_cc" TEXT,
  ADD COLUMN "correo_asunto" TEXT,
  ADD COLUMN "contexto_operacion" TEXT,
  ADD COLUMN "solicitante_formal_id" UUID;

ALTER TABLE "pravia_os"."prospectos"
  ADD CONSTRAINT "uq_prospectos_id_org" UNIQUE ("id", "organization_id");

CREATE TABLE "pravia_os"."prospecto_actos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "prospecto_id" UUID NOT NULL,
  "tipo_acto_id" UUID NOT NULL,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prospecto_actos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_prospecto_actos_org_prospecto_tipo" UNIQUE ("organization_id", "prospecto_id", "tipo_acto_id"),
  CONSTRAINT "uq_prospecto_actos_id_org" UNIQUE ("id", "organization_id"),
  CONSTRAINT "prospecto_actos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "prospecto_actos_prospecto_tenant_fkey" FOREIGN KEY ("prospecto_id", "organization_id") REFERENCES "pravia_os"."prospectos"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "prospecto_actos_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "pravia_os"."tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "prospecto_actos_actor_tenant_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "pravia_os"."organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_prospecto_actos_org_prospecto" ON "pravia_os"."prospecto_actos"("organization_id", "prospecto_id", "orden");
CREATE INDEX "idx_prospecto_actos_tipo_acto" ON "pravia_os"."prospecto_actos"("tipo_acto_id");

CREATE TABLE "pravia_os"."cotizacion_actos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "cotizacion_id" UUID NOT NULL,
  "tipo_acto_id" UUID NOT NULL,
  "prospecto_acto_origen_id" UUID,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "confirmed_at" TIMESTAMP(3),
  "confirmed_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cotizacion_actos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_cotizacion_actos_org_cotizacion_tipo" UNIQUE ("organization_id", "cotizacion_id", "tipo_acto_id"),
  CONSTRAINT "uq_cotizacion_actos_id_org" UNIQUE ("id", "organization_id"),
  CONSTRAINT "cotizacion_actos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cotizacion_actos_cotizacion_tenant_fkey" FOREIGN KEY ("cotizacion_id", "organization_id") REFERENCES "pravia_os"."cotizaciones"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cotizacion_actos_tipo_acto_id_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "pravia_os"."tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cotizacion_actos_prospecto_acto_tenant_fkey" FOREIGN KEY ("prospecto_acto_origen_id", "organization_id") REFERENCES "pravia_os"."prospecto_actos"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cotizacion_actos_confirmer_tenant_fkey" FOREIGN KEY ("organization_id", "confirmed_by_id") REFERENCES "pravia_os"."organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_cotizacion_actos_org_cotizacion" ON "pravia_os"."cotizacion_actos"("organization_id", "cotizacion_id", "orden");
CREATE INDEX "idx_cotizacion_actos_tipo_acto" ON "pravia_os"."cotizacion_actos"("tipo_acto_id");
CREATE INDEX "idx_cotizacion_actos_origen" ON "pravia_os"."cotizacion_actos"("organization_id", "prospecto_acto_origen_id");

ALTER TABLE "pravia_os"."cotizaciones"
  ADD CONSTRAINT "cotizaciones_solicitante_tenant_fkey"
  FOREIGN KEY ("solicitante_formal_id", "organization_id")
  REFERENCES "pravia_os"."comparecientes"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_cotizaciones_solicitante_formal"
  ON "pravia_os"."cotizaciones"("organization_id", "solicitante_formal_id");

-- Only migrate legacy records when the existing service code gives an exact,
-- already-configured TipoActo identity. Ambiguous free text remains legacy.
INSERT INTO "pravia_os"."prospecto_actos"
  ("organization_id", "prospecto_id", "tipo_acto_id", "orden", "created_by_id", "created_at")
SELECT p."organization_id", p."id", s."tipo_acto_id", 0, p."user_id", p."created_at"
FROM "pravia_os"."prospectos" p
JOIN "pravia_os"."prospecto_servicios_catalogo" s
  ON s."codigo" = p."servicio_catalogo_codigo"
JOIN "pravia_os"."tipos_acto" t
  ON t."id" = s."tipo_acto_id"
WHERE p."organization_id" IS NOT NULL
  AND t."archived_at" IS NULL
  AND (t."organization_id" IS NULL OR t."organization_id" = p."organization_id")
ON CONFLICT ("organization_id", "prospecto_id", "tipo_acto_id") DO NOTHING;

INSERT INTO "pravia_os"."cotizacion_actos"
  ("organization_id", "cotizacion_id", "tipo_acto_id", "prospecto_acto_origen_id", "orden", "created_at")
SELECT c."organization_id", c."id", pa."tipo_acto_id", pa."id", pa."orden", c."created_at"
FROM "pravia_os"."cotizaciones" c
JOIN "pravia_os"."prospecto_actos" pa
  ON pa."prospecto_id" = c."prospecto_id"
 AND pa."organization_id" = c."organization_id"
WHERE c."organization_id" IS NOT NULL
ON CONFLICT ("organization_id", "cotizacion_id", "tipo_acto_id") DO NOTHING;

CREATE OR REPLACE FUNCTION "pravia_os"."validate_correction015_act_tenant"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pravia_os"."tipos_acto" t
    WHERE t."id" = NEW."tipo_acto_id"
      AND t."archived_at" IS NULL
      AND (t."organization_id" IS NULL OR t."organization_id" = NEW."organization_id")
  ) THEN
    RAISE EXCEPTION 'tipo_acto_id is not visible to the active organization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_prospecto_actos_tenant"
BEFORE INSERT OR UPDATE OF "organization_id", "tipo_acto_id"
ON "pravia_os"."prospecto_actos"
FOR EACH ROW EXECUTE FUNCTION "pravia_os"."validate_correction015_act_tenant"();

CREATE TRIGGER "trg_cotizacion_actos_tenant"
BEFORE INSERT OR UPDATE OF "organization_id", "tipo_acto_id"
ON "pravia_os"."cotizacion_actos"
FOR EACH ROW EXECUTE FUNCTION "pravia_os"."validate_correction015_act_tenant"();
