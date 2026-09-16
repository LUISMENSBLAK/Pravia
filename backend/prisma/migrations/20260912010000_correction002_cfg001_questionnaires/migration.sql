-- Correction 002 + CFG-001 real + Cuestionarios v1.0.
-- Additive only: legacy quotation payloads and historical workflow values remain readable.

SET search_path TO pravia_os, public;

CREATE TYPE "ConfiguracionModoDependencia" AS ENUM ('TODAS', 'CUALQUIERA');
CREATE TYPE "CotizacionConceptoOrigen" AS ENUM ('MANUAL', 'IMPORTADO');
CREATE TYPE "CuestionarioRespuestaEstado" AS ENUM ('BORRADOR', 'FINALIZADO');

ALTER TYPE "CatalogoArtefactoPurpose" ADD VALUE IF NOT EXISTS 'QUESTIONNAIRE';
ALTER TYPE "CotizacionEtapaContractual" ADD VALUE IF NOT EXISTS 'EN_ELABORACION';
ALTER TYPE "CotizacionEtapaContractual" ADD VALUE IF NOT EXISTS 'EN_SEGUIMIENTO';
ALTER TYPE "CotizacionEtapaContractual" ADD VALUE IF NOT EXISTS 'ACEPTADA';
ALTER TYPE "CotizacionEtapaContractual" ADD VALUE IF NOT EXISTS 'RECHAZADA';

-- Correction 002 replaces the original reduced COT-001 path while retaining
-- every historical shape that may already exist. Workflow events remain
-- append-only; only the accepted transition grammar is broadened.
ALTER TABLE "cotizacion_transiciones" DROP CONSTRAINT IF EXISTS "cot001_transition_shape";
ALTER TABLE "cotizacion_transiciones" ADD CONSTRAINT "cot001_transition_shape" CHECK (
  "version" > 0
  AND length(btrim("idempotency_key")) > 0
  AND length("payload_hash") = 64
  AND "effective_at" <= "recorded_at"
  AND (
    ("accion" = 'CREAR' AND "cambia_etapa" AND "etapa_anterior" IS NULL AND "etapa_nueva"::text = 'BORRADOR')
    OR ("accion" = 'COMENZAR_ELABORACION' AND "cambia_etapa" AND "etapa_anterior"::text = 'BORRADOR' AND "etapa_nueva"::text = 'EN_ELABORACION')
    OR ("accion" = 'ENVIAR_CLIENTE' AND "cambia_etapa" AND "etapa_anterior"::text IN ('BORRADOR','EN_ELABORACION') AND "etapa_nueva"::text = 'ENVIADA_CLIENTE'
      AND length(btrim("canal")) > 0 AND length(btrim("destinatario")) > 0)
    OR ("accion" = 'INICIAR_SEGUIMIENTO' AND "cambia_etapa" AND "etapa_anterior"::text = 'ENVIADA_CLIENTE' AND "etapa_nueva"::text = 'EN_SEGUIMIENTO')
    OR ("accion" = 'REENVIAR_CLIENTE' AND NOT "cambia_etapa" AND "etapa_anterior"::text IN ('ENVIADA_CLIENTE','EN_SEGUIMIENTO') AND "etapa_nueva"::text = "etapa_anterior"::text
      AND length(btrim("canal")) > 0 AND length(btrim("destinatario")) > 0)
    OR ("accion" = 'ACEPTAR' AND "cambia_etapa" AND "etapa_anterior"::text IN ('ENVIADA_CLIENTE','EN_SEGUIMIENTO') AND "etapa_nueva"::text = 'ACEPTADA')
    OR ("accion" = 'RECHAZAR' AND "cambia_etapa" AND "etapa_anterior"::text IN ('ENVIADA_CLIENTE','EN_SEGUIMIENTO') AND "etapa_nueva"::text = 'RECHAZADA')
    OR ("accion" = 'REGISTRAR_ACEPTACION_ANTICIPO' AND "cambia_etapa" AND "etapa_anterior"::text = 'ENVIADA_CLIENTE' AND "etapa_nueva"::text = 'ACEPTO_ANTICIPO')
    OR ("accion" = 'SUSPENDER' AND "cambia_etapa" AND "etapa_anterior"::text IN ('BORRADOR','EN_ELABORACION','ENVIADA_CLIENTE','EN_SEGUIMIENTO','ACEPTO_ANTICIPO') AND "etapa_nueva"::text = 'SUSPENDIDA')
    OR ("accion" = 'CANCELAR' AND "cambia_etapa" AND "etapa_anterior"::text IN ('BORRADOR','EN_ELABORACION','ENVIADA_CLIENTE','EN_SEGUIMIENTO','ACEPTO_ANTICIPO') AND "etapa_nueva"::text = 'CANCELADA')
    OR ("accion" = 'CONVERTIR' AND "cambia_etapa" AND "etapa_anterior"::text IN ('ACEPTADA','ACEPTO_ANTICIPO') AND "etapa_nueva"::text = 'CONVERTIDA_EXPEDIENTE')
  )
);

-- Keep the deferred COT-001 integrity trigger aligned with the expanded
-- contractual stages. The persisted legacy status remains a compatibility
-- projection; it does not become the workflow source of truth.
CREATE OR REPLACE FUNCTION cot001_current_fact_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q cotizaciones; fact cotizacion_transiciones; projected TEXT;
BEGIN
  IF TG_TABLE_NAME = 'cotizaciones' THEN
    SELECT * INTO q FROM cotizaciones WHERE id = NEW.id;
  ELSE
    SELECT * INTO q FROM cotizaciones WHERE id = NEW.cotizacion_id;
    IF NEW.cambia_etapa AND q.transicion_actual_id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'COT001_ORPHAN_TRANSITION' USING ERRCODE = '23514';
    END IF;
    IF NOT NEW.cambia_etapa AND (q.etapa_contractual IS DISTINCT FROM NEW.etapa_nueva OR q.version_operativa IS DISTINCT FROM NEW.version) THEN
      RAISE EXCEPTION 'COT001_RESEND_NOT_RECORDED' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF q.etapa_contractual IS NULL THEN RETURN NEW; END IF;
  IF q.organization_id IS NULL OR q.prospecto_id IS NULL THEN
    RAISE EXCEPTION 'COT001_CANONICAL_ORIGIN_REQUIRED' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO fact FROM cotizacion_transiciones WHERE id = q.transicion_actual_id;
  IF fact.cotizacion_id IS DISTINCT FROM q.id OR fact.organization_id IS DISTINCT FROM q.organization_id
    OR fact.etapa_nueva IS DISTINCT FROM q.etapa_contractual OR fact.version > q.version_operativa OR NOT fact.cambia_etapa THEN
    RAISE EXCEPTION 'COT001_CURRENT_FACT_INVALID' USING ERRCODE = '23514';
  END IF;
  projected := CASE q.etapa_contractual::text
    WHEN 'BORRADOR' THEN 'BORRADOR'
    WHEN 'EN_ELABORACION' THEN 'BORRADOR'
    WHEN 'ENVIADA_CLIENTE' THEN 'ENVIADA_CLIENTE'
    WHEN 'EN_SEGUIMIENTO' THEN 'EN_NEGOCIACION'
    WHEN 'ACEPTADA' THEN 'ACEPTADA'
    WHEN 'ACEPTO_ANTICIPO' THEN 'ACEPTADA'
    WHEN 'RECHAZADA' THEN 'RECHAZADA'
    WHEN 'SUSPENDIDA' THEN 'SUSPENDIDA'
    WHEN 'CANCELADA' THEN 'CANCELADA'
    WHEN 'CONVERTIDA_EXPEDIENTE' THEN 'CONVERTIDA_EXPEDIENTE'
    ELSE NULL
  END;
  IF projected IS NULL OR q.estado::text IS DISTINCT FROM projected THEN
    RAISE EXCEPTION 'COT001_LEGACY_PROJECTION_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE "configuracion_actividades"
  ADD COLUMN "modo_dependencias" "ConfiguracionModoDependencia" NOT NULL DEFAULT 'TODAS';
ALTER TABLE "configuracion_actos" ADD COLUMN "clasificacion" TEXT;
ALTER TABLE "expediente_seguimiento_actividades"
  ADD COLUMN "modo_dependencias_snapshot" "ConfiguracionModoDependencia" NOT NULL DEFAULT 'TODAS';

CREATE TABLE "cotizacion_conceptos" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "cotizacion_id" UUID NOT NULL,
  "concepto" VARCHAR(240) NOT NULL,
  "categoria" "PresupuestoConceptoCategoria" NOT NULL,
  "importe" DECIMAL(16,2) NOT NULL,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "origen" "CotizacionConceptoOrigen" NOT NULL DEFAULT 'MANUAL',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cotizacion_conceptos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cotizacion_conceptos_importe_check" CHECK ("importe" >= 0)
);

CREATE TABLE "cotizacion_version_conceptos" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "cotizacion_version_id" UUID NOT NULL,
  "concepto" VARCHAR(240) NOT NULL,
  "categoria" "PresupuestoConceptoCategoria" NOT NULL,
  "importe" DECIMAL(16,2) NOT NULL,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "origen" "CotizacionConceptoOrigen" NOT NULL DEFAULT 'MANUAL',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cotizacion_version_conceptos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cotizacion_version_conceptos_importe_check" CHECK ("importe" >= 0)
);

CREATE TABLE "catalogo_cuestionario_formatos" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "cuestionario_artefacto_id" UUID NOT NULL,
  "formato_artefacto_id" UUID NOT NULL,
  "mapping_json" JSONB NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalogo_cuestionario_formatos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalogo_cuestionario_formatos_distinct_check"
    CHECK ("cuestionario_artefacto_id" <> "formato_artefacto_id")
);

CREATE TABLE "expediente_cuestionario_respuestas" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "artefacto_version_id" UUID NOT NULL,
  "scope" "CatalogoMultiplicidad" NOT NULL,
  "subject_key" VARCHAR(120) NOT NULL,
  "revision" INTEGER NOT NULL,
  "estado" "CuestionarioRespuestaEstado" NOT NULL DEFAULT 'BORRADOR',
  "definition_snapshot" JSONB NOT NULL,
  "answers_json" JSONB NOT NULL,
  "mapped_values_json" JSONB,
  "completeness_json" JSONB NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "finalized_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_cuestionario_respuestas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expediente_cuestionario_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "expediente_cuestionario_subject_check" CHECK (length(btrim("subject_key")) > 0)
);

CREATE INDEX "idx_cotizacion_conceptos_org_quote"
  ON "cotizacion_conceptos"("organization_id", "cotizacion_id", "orden");
CREATE UNIQUE INDEX "uq_cotizacion_concepto_id_org"
  ON "cotizacion_conceptos"("id", "organization_id");
CREATE INDEX "idx_cot_version_conceptos_org_version"
  ON "cotizacion_version_conceptos"("organization_id", "cotizacion_version_id", "orden");
CREATE UNIQUE INDEX "uq_cotizacion_version_concepto_id_org"
  ON "cotizacion_version_conceptos"("id", "organization_id");
CREATE UNIQUE INDEX "uq_cotizacion_version_id_org"
  ON "cotizacion_versiones"("id", "organization_id");
CREATE INDEX "idx_cuestionario_formato_definition"
  ON "catalogo_cuestionario_formatos"("organization_id", "cuestionario_artefacto_id");
CREATE UNIQUE INDEX "uq_cuestionario_formato_org"
  ON "catalogo_cuestionario_formatos"("organization_id", "cuestionario_artefacto_id", "formato_artefacto_id");
CREATE INDEX "idx_exp_cuestionario_subject"
  ON "expediente_cuestionario_respuestas"("organization_id", "expediente_id", "scope", "subject_key", "created_at");
CREATE UNIQUE INDEX "uq_exp_cuestionario_revision"
  ON "expediente_cuestionario_respuestas"("organization_id", "expediente_id", "artefacto_version_id", "scope", "subject_key", "revision");
CREATE UNIQUE INDEX "uq_exp_cuestionario_idempotency"
  ON "expediente_cuestionario_respuestas"("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "uq_exp_cuestionario_id_org"
  ON "expediente_cuestionario_respuestas"("id", "organization_id");

ALTER TABLE "cotizacion_conceptos"
  ADD CONSTRAINT "cotizacion_conceptos_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "cotizacion_conceptos_cotizacion_tenant_fkey"
  FOREIGN KEY ("cotizacion_id", "organization_id") REFERENCES "cotizaciones"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cotizacion_version_conceptos"
  ADD CONSTRAINT "cotizacion_version_conceptos_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "cotizacion_version_conceptos_version_tenant_fkey"
  FOREIGN KEY ("cotizacion_version_id", "organization_id") REFERENCES "cotizacion_versiones"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalogo_cuestionario_formatos"
  ADD CONSTRAINT "catalogo_cuestionario_formatos_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "catalogo_cuestionario_formatos_questionnaire_tenant_fkey"
  FOREIGN KEY ("cuestionario_artefacto_id", "organization_id") REFERENCES "catalogo_artefactos"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "catalogo_cuestionario_formatos_format_tenant_fkey"
  FOREIGN KEY ("formato_artefacto_id", "organization_id") REFERENCES "catalogo_artefactos"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_cuestionario_respuestas"
  ADD CONSTRAINT "expediente_cuestionario_respuestas_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "expediente_cuestionario_respuestas_expediente_tenant_fkey"
  FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "expedientes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "expediente_cuestionario_respuestas_version_tenant_fkey"
  FOREIGN KEY ("artefacto_version_id", "organization_id") REFERENCES "catalogo_artefacto_versiones"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve usable legacy budgets by normalizing every recognizable row. Unknown
-- payloads stay untouched in JSON and are never assigned invented amounts.
WITH legacy_rows AS (
  SELECT
    cv."organization_id",
    cv."id" AS version_id,
    cv."cotizacion_id",
    item.value AS item,
    item.ordinality::integer - 1 AS orden
  FROM "cotizacion_versiones" cv
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(cv."desglose_notaria"->'rubros') = 'array'
      THEN cv."desglose_notaria"->'rubros'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS item(value, ordinality)
  WHERE cv."organization_id" IS NOT NULL
), normalized AS (
  SELECT *,
    NULLIF(btrim(item->>'concepto'), '') AS concepto,
    CASE
      WHEN upper(coalesce(item->>'categoria', '')) IN ('HONORARIOS') THEN 'HONORARIOS'::"PresupuestoConceptoCategoria"
      WHEN upper(coalesce(item->>'categoria', '')) IN ('IVA', 'IVA_HONORARIOS') THEN 'IVA_HONORARIOS'::"PresupuestoConceptoCategoria"
      WHEN upper(coalesce(item->>'categoria', '')) IN ('IMPUESTOS', 'DERECHOS', 'IMPUESTOS_DERECHOS', 'IMPUESTOS Y DERECHOS')
        THEN 'IMPUESTOS_DERECHOS'::"PresupuestoConceptoCategoria"
      ELSE NULL
    END AS categoria,
    CASE
      WHEN coalesce(item->>'monto', item->>'importe', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$'
      THEN coalesce(item->>'monto', item->>'importe')::numeric
      ELSE NULL
    END AS importe
  FROM legacy_rows
)
INSERT INTO "cotizacion_version_conceptos"
  ("id", "organization_id", "cotizacion_version_id", "concepto", "categoria", "importe", "orden", "origen")
SELECT gen_random_uuid(), organization_id, version_id, concepto, categoria, importe, orden, 'IMPORTADO'
FROM normalized
WHERE concepto IS NOT NULL AND categoria IS NOT NULL AND importe IS NOT NULL AND importe >= 0;

WITH latest_version AS (
  SELECT DISTINCT ON ("cotizacion_id") "id", "organization_id", "cotizacion_id"
  FROM "cotizacion_versiones"
  WHERE "organization_id" IS NOT NULL
  ORDER BY "cotizacion_id", "version" DESC
)
INSERT INTO "cotizacion_conceptos"
  ("id", "organization_id", "cotizacion_id", "concepto", "categoria", "importe", "orden", "origen")
SELECT gen_random_uuid(), cvc."organization_id", lv."cotizacion_id", cvc."concepto", cvc."categoria", cvc."importe", cvc."orden", cvc."origen"
FROM latest_version lv
JOIN "cotizacion_version_conceptos" cvc ON cvc."cotizacion_version_id" = lv."id";
