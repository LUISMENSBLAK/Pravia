-- EXP-007: un único presupuesto operativo vigente por expediente.
-- Los PDFs históricos usan Documento/Storage canónicos y nunca crean versiones editables.

BEGIN;
SET LOCAL search_path TO pravia_os;

CREATE TYPE "PresupuestoOrigen" AS ENUM ('COTIZACION_ESTRUCTURADA', 'LEGACY_JSON', 'LEGACY_SIN_ESTRUCTURA');
CREATE TYPE "PresupuestoConceptoCategoria" AS ENUM ('HONORARIOS', 'IVA_HONORARIOS', 'IMPUESTOS_DERECHOS');

CREATE TABLE "expediente_presupuestos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "cotizacion_version_origen_id" UUID,
  "origen" "PresupuestoOrigen" NOT NULL DEFAULT 'COTIZACION_ESTRUCTURADA',
  "version" INTEGER NOT NULL DEFAULT 1,
  "subtotal_honorarios" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "subtotal_impuestos_derechos" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "legacy_payload" JSONB,
  "requiere_clasificacion" BOOLEAN NOT NULL DEFAULT false,
  "distribucion_requiere_revision" BOOLEAN NOT NULL DEFAULT false,
  "creado_por_id" UUID NOT NULL,
  "actualizado_por_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_presupuestos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expediente_presupuesto_conceptos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "presupuesto_id" UUID NOT NULL,
  "concepto" VARCHAR(240) NOT NULL,
  "categoria" "PresupuestoConceptoCategoria" NOT NULL,
  "importe" DECIMAL(16,2) NOT NULL,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_presupuesto_conceptos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expediente_presupuesto_distribuciones" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "presupuesto_id" UUID NOT NULL,
  "pravia_honorarios" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "pravia_iva" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "notaria_honorarios" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "notaria_iva" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_presupuesto_distribuciones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expediente_presupuesto_documentos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "presupuesto_id" UUID NOT NULL,
  "documento_id" UUID NOT NULL,
  "formato_version_id" UUID,
  "formato_fuente" VARCHAR(160) NOT NULL,
  "presupuesto_version" INTEGER NOT NULL,
  "total_snapshot" DECIMAL(16,2) NOT NULL,
  "nota" VARCHAR(500),
  "idempotency_key" VARCHAR(160) NOT NULL,
  "generado_por_id" UUID NOT NULL,
  "generado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "eliminado_at" TIMESTAMP(3),
  "eliminado_por_id" UUID,
  "motivo_eliminacion" VARCHAR(500),
  CONSTRAINT "expediente_presupuesto_documentos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expediente_presupuestos_expediente_id_key" ON "expediente_presupuestos"("expediente_id");
CREATE UNIQUE INDEX "uq_exp_presupuesto_id_org" ON "expediente_presupuestos"("id", "organization_id");
CREATE INDEX "idx_exp_presupuesto_org_exp" ON "expediente_presupuestos"("organization_id", "expediente_id");
CREATE INDEX "idx_exp_presupuesto_quote_version" ON "expediente_presupuestos"("cotizacion_version_origen_id");
CREATE INDEX "idx_exp_presupuesto_creador" ON "expediente_presupuestos"("creado_por_id");
CREATE INDEX "idx_exp_presupuesto_actualizador" ON "expediente_presupuestos"("actualizado_por_id");
CREATE UNIQUE INDEX "uq_exp_presupuesto_concepto_id_org" ON "expediente_presupuesto_conceptos"("id", "organization_id");
CREATE INDEX "idx_exp_presupuesto_conceptos_org_budget" ON "expediente_presupuesto_conceptos"("organization_id", "presupuesto_id", "orden");
CREATE UNIQUE INDEX "expediente_presupuesto_distribuciones_presupuesto_id_key" ON "expediente_presupuesto_distribuciones"("presupuesto_id");
CREATE UNIQUE INDEX "uq_exp_presupuesto_distribucion_id_org" ON "expediente_presupuesto_distribuciones"("id", "organization_id");
CREATE INDEX "idx_exp_presupuesto_distribucion_org_budget" ON "expediente_presupuesto_distribuciones"("organization_id", "presupuesto_id");
CREATE UNIQUE INDEX "expediente_presupuesto_documentos_documento_id_key" ON "expediente_presupuesto_documentos"("documento_id");
CREATE UNIQUE INDEX "uq_exp_presupuesto_pdf_idempotency" ON "expediente_presupuesto_documentos"("organization_id", "presupuesto_id", "idempotency_key");
CREATE INDEX "idx_exp_presupuesto_pdf_org_budget" ON "expediente_presupuesto_documentos"("organization_id", "presupuesto_id", "generado_at");
CREATE INDEX "idx_exp_presupuesto_pdf_formato" ON "expediente_presupuesto_documentos"("formato_version_id");
CREATE INDEX "idx_exp_presupuesto_pdf_generador" ON "expediente_presupuesto_documentos"("generado_por_id");
CREATE INDEX "idx_exp_presupuesto_pdf_eliminador" ON "expediente_presupuesto_documentos"("eliminado_por_id");

ALTER TABLE "expediente_presupuestos" ADD CONSTRAINT "expediente_presupuestos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_presupuestos" ADD CONSTRAINT "expediente_presupuestos_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_presupuestos" ADD CONSTRAINT "expediente_presupuestos_cotizacion_version_origen_id_fkey" FOREIGN KEY ("cotizacion_version_origen_id") REFERENCES "cotizacion_versiones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_presupuestos" ADD CONSTRAINT "expediente_presupuestos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_presupuestos" ADD CONSTRAINT "expediente_presupuestos_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_presupuesto_conceptos" ADD CONSTRAINT "expediente_presupuesto_conceptos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_presupuesto_conceptos" ADD CONSTRAINT "expediente_presupuesto_conceptos_presupuesto_id_fkey" FOREIGN KEY ("presupuesto_id") REFERENCES "expediente_presupuestos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expediente_presupuesto_distribuciones" ADD CONSTRAINT "expediente_presupuesto_distribuciones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_presupuesto_distribuciones" ADD CONSTRAINT "expediente_presupuesto_distribuciones_presupuesto_id_fkey" FOREIGN KEY ("presupuesto_id") REFERENCES "expediente_presupuestos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expediente_presupuesto_documentos" ADD CONSTRAINT "expediente_presupuesto_documentos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_presupuesto_documentos" ADD CONSTRAINT "expediente_presupuesto_documentos_presupuesto_id_fkey" FOREIGN KEY ("presupuesto_id") REFERENCES "expediente_presupuestos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_presupuesto_documentos" ADD CONSTRAINT "expediente_presupuesto_documentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_presupuesto_documentos" ADD CONSTRAINT "expediente_presupuesto_documentos_formato_version_id_fkey" FOREIGN KEY ("formato_version_id") REFERENCES "catalogo_artefacto_versiones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_presupuesto_documentos" ADD CONSTRAINT "expediente_presupuesto_documentos_generado_por_id_fkey" FOREIGN KEY ("generado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_presupuesto_documentos" ADD CONSTRAINT "expediente_presupuesto_documentos_eliminado_por_id_fkey" FOREIGN KEY ("eliminado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backend-only: no exposición directa mediante Data API/GraphQL.
ALTER TABLE "expediente_presupuestos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expediente_presupuesto_conceptos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expediente_presupuesto_distribuciones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expediente_presupuesto_documentos" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE pravia_os.expediente_presupuestos FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE pravia_os.expediente_presupuesto_conceptos FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE pravia_os.expediente_presupuesto_distribuciones FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE pravia_os.expediente_presupuesto_documentos FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

-- Defensa física cross-tenant reutilizando el mecanismo canónico.
DO $$
DECLARE relation RECORD; trigger_name TEXT;
BEGIN
  FOR relation IN SELECT * FROM (VALUES
    ('expediente_presupuestos','expedientes','expediente_id'),
    ('expediente_presupuestos','cotizacion_versiones','cotizacion_version_origen_id'),
    ('expediente_presupuesto_conceptos','expediente_presupuestos','presupuesto_id'),
    ('expediente_presupuesto_distribuciones','expediente_presupuestos','presupuesto_id'),
    ('expediente_presupuesto_documentos','expediente_presupuestos','presupuesto_id'),
    ('expediente_presupuesto_documentos','documentos','documento_id'),
    ('expediente_presupuesto_documentos','catalogo_artefacto_versiones','formato_version_id')
  ) AS relations(child_table, parent_table, parent_column)
  LOOP
    trigger_name := 'trg_exp007_tenant_' || relation.child_table || '_' || relation.parent_column;
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON pravia_os.%I FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization(%L,%L)', trigger_name, relation.child_table, relation.parent_table, relation.parent_column);
  END LOOP;
END $$;

DO $$
DECLARE relation RECORD; trigger_name TEXT;
BEGIN
  FOR relation IN SELECT * FROM (VALUES
    ('expediente_presupuestos','creado_por_id'),
    ('expediente_presupuestos','actualizado_por_id'),
    ('expediente_presupuesto_documentos','generado_por_id'),
    ('expediente_presupuesto_documentos','eliminado_por_id')
  ) AS relations(child_table, user_column)
  LOOP
    trigger_name := 'trg_exp007_membership_' || relation.child_table || '_' || relation.user_column;
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON pravia_os.%I FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership(%L)', trigger_name, relation.child_table, relation.user_column);
  END LOOP;
END $$;

-- Materializa exactamente un presupuesto para cada expediente tenant-aware.
-- Conserva íntegro el JSON legacy. Cuando no existe, usa la versión estructurada
-- de la cotización origen; nunca mezcla ambas fuentes ni inventa categorías legacy.
WITH source AS (
  SELECT e.*,
    CASE WHEN jsonb_typeof(e.datos_operacion->'presupuesto') = 'object'
      THEN e.datos_operacion->'presupuesto' ELSE NULL END AS payload
  FROM "expedientes" e
  WHERE e.organization_id IS NOT NULL
), origin_version AS (
  SELECT s.id AS expediente_id,
    CASE
      WHEN (s.payload->>'cotizacion_version_id') ~* '^[0-9a-f-]{36}$'
        AND EXISTS (
          SELECT 1 FROM "cotizacion_versiones" cv
          JOIN "cotizaciones" q ON q.id=cv.cotizacion_id
          WHERE cv.id=(s.payload->>'cotizacion_version_id')::uuid
            AND cv.cotizacion_id=s.cotizacion_id
            AND q.organization_id=s.organization_id
        )
      THEN (s.payload->>'cotizacion_version_id')::uuid
      ELSE (
        SELECT cv.id FROM "cotizacion_versiones" cv
        JOIN "cotizaciones" q ON q.id=cv.cotizacion_id
        WHERE cv.cotizacion_id=s.cotizacion_id AND q.organization_id=s.organization_id
        ORDER BY cv.aprobada DESC, cv.version DESC LIMIT 1
      )
    END AS version_id
  FROM source s
), classified AS (
  SELECT s.*, ov.version_id, cv.desglose_notaria, cv.total_cliente AS quote_total
  FROM source s
  LEFT JOIN origin_version ov ON ov.expediente_id=s.id
  LEFT JOIN "cotizacion_versiones" cv ON cv.id=ov.version_id
)
INSERT INTO "expediente_presupuestos" (
  organization_id, expediente_id, cotizacion_version_origen_id, origen,
  subtotal_honorarios, subtotal_impuestos_derechos, total, legacy_payload,
  requiere_clasificacion, distribucion_requiere_revision,
  creado_por_id, actualizado_por_id, created_at, updated_at
)
SELECT c.organization_id, c.id, c.version_id,
  CASE
    WHEN c.payload IS NOT NULL THEN 'LEGACY_JSON'::"PresupuestoOrigen"
    WHEN c.version_id IS NOT NULL THEN 'COTIZACION_ESTRUCTURADA'::"PresupuestoOrigen"
    ELSE 'LEGACY_SIN_ESTRUCTURA'::"PresupuestoOrigen"
  END,
  0, 0,
  CASE
    WHEN COALESCE(c.payload->>'total_cliente', c.payload->>'total_notaria', '') ~ '^[0-9]+(?:\.[0-9]+)?$'
      THEN ROUND(COALESCE(c.payload->>'total_cliente', c.payload->>'total_notaria')::numeric, 2)
    WHEN c.quote_total IS NOT NULL THEN ROUND(c.quote_total, 2)
    ELSE 0
  END,
  c.payload,
  CASE
    WHEN c.payload IS NOT NULL THEN
      jsonb_typeof(c.payload->'rubros') <> 'array'
      OR jsonb_array_length(CASE WHEN jsonb_typeof(c.payload->'rubros')='array' THEN c.payload->'rubros' ELSE '[]'::jsonb END)=0
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.payload->'rubros')='array' THEN c.payload->'rubros' ELSE '[]'::jsonb END) item
        WHERE UPPER(COALESCE(item->>'categoria', '')) NOT IN ('HONORARIOS', 'IVA_HONORARIOS', 'IMPUESTOS_DERECHOS')
          OR COALESCE(item->>'monto', '') !~ '^[0-9]+(?:\.[0-9]+)?$'
          OR TRIM(COALESCE(item->>'concepto', ''))=''
      )
    WHEN c.version_id IS NOT NULL THEN
      jsonb_typeof(c.desglose_notaria->'rubros') <> 'array'
      OR jsonb_array_length(CASE WHEN jsonb_typeof(c.desglose_notaria->'rubros')='array' THEN c.desglose_notaria->'rubros' ELSE '[]'::jsonb END)=0
    ELSE true
  END,
  c.payload IS NOT NULL AND COALESCE(c.payload->>'honorarios_pravia', '') <> '',
  c.creador_id, c.creador_id, c.created_at, c.updated_at
FROM classified c;

-- Conceptos legacy: sólo categorías ya explícitas y montos inequívocos.
INSERT INTO "expediente_presupuesto_conceptos" (organization_id, presupuesto_id, concepto, categoria, importe, orden)
SELECT p.organization_id, p.id, LEFT(TRIM(item->>'concepto'), 240),
  UPPER(item->>'categoria')::"PresupuestoConceptoCategoria",
  ROUND((item->>'monto')::numeric, 2), ordinality - 1
FROM "expediente_presupuestos" p
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.legacy_payload->'rubros')='array' THEN p.legacy_payload->'rubros' ELSE '[]'::jsonb END) WITH ORDINALITY AS legacy_item(item, ordinality)
WHERE UPPER(COALESCE(item->>'categoria', '')) IN ('HONORARIOS', 'IVA_HONORARIOS', 'IMPUESTOS_DERECHOS')
  AND COALESCE(item->>'monto', '') ~ '^[0-9]+(?:\.[0-9]+)?$'
  AND TRIM(COALESCE(item->>'concepto', '')) <> '';

-- Expedientes sin JSON legacy: la cotización estructurada es una fuente
-- inequívoca y conserva su FK de procedencia. HONORARIOS/IVA permanecen juntos.
INSERT INTO "expediente_presupuesto_conceptos" (organization_id, presupuesto_id, concepto, categoria, importe, orden)
SELECT p.organization_id, p.id, LEFT(TRIM(item->>'concepto'), 240),
  CASE
    WHEN UPPER(COALESCE(item->>'categoria', ''))='HONORARIOS' AND UPPER(COALESCE(item->>'concepto', '')) LIKE '%IVA%'
      THEN 'IVA_HONORARIOS'::"PresupuestoConceptoCategoria"
    WHEN UPPER(COALESCE(item->>'categoria', ''))='HONORARIOS'
      THEN 'HONORARIOS'::"PresupuestoConceptoCategoria"
    ELSE 'IMPUESTOS_DERECHOS'::"PresupuestoConceptoCategoria"
  END,
  ROUND((item->>'monto')::numeric, 2), ordinality - 1
FROM "expediente_presupuestos" p
JOIN "cotizacion_versiones" cv ON cv.id=p.cotizacion_version_origen_id
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cv.desglose_notaria->'rubros')='array' THEN cv.desglose_notaria->'rubros' ELSE '[]'::jsonb END) WITH ORDINALITY AS quote_item(item, ordinality)
WHERE p.legacy_payload IS NULL
  AND COALESCE(item->>'monto', '') ~ '^[0-9]+(?:\.[0-9]+)?$'
  AND TRIM(COALESCE(item->>'concepto', '')) <> '';

UPDATE "expediente_presupuestos" p SET
  subtotal_honorarios = totals.honorarios,
  subtotal_impuestos_derechos = totals.impuestos,
  total = CASE WHEN p.requiere_clasificacion THEN p.total ELSE totals.honorarios + totals.impuestos END
FROM (
  SELECT presupuesto_id,
    COALESCE(SUM(importe) FILTER (WHERE categoria IN ('HONORARIOS', 'IVA_HONORARIOS')), 0) AS honorarios,
    COALESCE(SUM(importe) FILTER (WHERE categoria = 'IMPUESTOS_DERECHOS'), 0) AS impuestos
  FROM "expediente_presupuesto_conceptos" GROUP BY presupuesto_id
) totals WHERE totals.presupuesto_id = p.id;

INSERT INTO "expediente_presupuesto_distribuciones" (
  organization_id, presupuesto_id, pravia_honorarios, pravia_iva,
  notaria_honorarios, notaria_iva
)
SELECT p.organization_id, p.id,
  LEAST(COALESCE(cv.honorarios_pravia, 0), p.subtotal_honorarios - COALESCE(vat.total, 0)),
  LEAST(GREATEST(COALESCE(cv.honorarios_pravia, 0) - (p.subtotal_honorarios - COALESCE(vat.total, 0)), 0), COALESCE(vat.total, 0)),
  (p.subtotal_honorarios - COALESCE(vat.total, 0)) - LEAST(COALESCE(cv.honorarios_pravia, 0), p.subtotal_honorarios - COALESCE(vat.total, 0)),
  COALESCE(vat.total, 0) - LEAST(GREATEST(COALESCE(cv.honorarios_pravia, 0) - (p.subtotal_honorarios - COALESCE(vat.total, 0)), 0), COALESCE(vat.total, 0))
FROM "expediente_presupuestos" p
LEFT JOIN "cotizacion_versiones" cv ON cv.id=p.cotizacion_version_origen_id AND p.legacy_payload IS NULL
LEFT JOIN (
  SELECT presupuesto_id, SUM(importe) AS total
  FROM "expediente_presupuesto_conceptos"
  WHERE categoria='IVA_HONORARIOS'
  GROUP BY presupuesto_id
) vat ON vat.presupuesto_id=p.id;

-- Guardas forenses: si alguna relación no cierra, la migración falla y revierte.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "expediente_presupuestos" p LEFT JOIN "expedientes" e ON e.id=p.expediente_id AND e.organization_id=p.organization_id WHERE e.id IS NULL) THEN
    RAISE EXCEPTION 'EXP007_ORPHAN_OR_CROSS_TENANT_BUDGET';
  END IF;
  IF EXISTS (SELECT 1 FROM "expediente_presupuesto_conceptos" c JOIN "expediente_presupuestos" p ON p.id=c.presupuesto_id WHERE c.organization_id<>p.organization_id) THEN
    RAISE EXCEPTION 'EXP007_CROSS_TENANT_CONCEPT';
  END IF;
  IF EXISTS (SELECT 1 FROM "expediente_presupuesto_distribuciones" d JOIN "expediente_presupuestos" p ON p.id=d.presupuesto_id WHERE d.organization_id<>p.organization_id) THEN
    RAISE EXCEPTION 'EXP007_CROSS_TENANT_DISTRIBUTION';
  END IF;
END $$;

COMMIT;
