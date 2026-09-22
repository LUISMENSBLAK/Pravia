-- Correcciones 011, 012 y 014.
-- Este cambio es aditivo y conserva artefactos, cuestionarios, respuestas y
-- documentos históricos. Las carpetas continúan siendo sólo organizativas.

CREATE TYPE "CatalogoDestinoFuncional" AS ENUM (
  'COTIZACION_SERVICIOS',
  'EXPEDIENTE_PRESUPUESTO',
  'CALCULO_ISR_MEMORIA',
  'FINANZAS_RECIBO_PAGO',
  'FINANZAS_SOLICITUD_PAGO',
  'PROYECTO_MACHOTE',
  'EXPEDIENTE_DOCUMENTO_GENERICO',
  'CUMPLIMIENTO_PLD_UIF',
  'SIN_ASIGNAR'
);

CREATE TABLE "catalogo_artefacto_destinos" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "artefacto_id" UUID NOT NULL,
  "destino" "CatalogoDestinoFuncional" NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "predeterminado" BOOLEAN NOT NULL DEFAULT false,
  "reglas_json" JSONB,
  "mapeo_datos_json" JSONB,
  "creado_por_id" UUID NOT NULL,
  "actualizado_por_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalogo_artefacto_destinos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalogo_artefacto_destinos_artifact_tenant_fkey"
    FOREIGN KEY ("artefacto_id", "organization_id")
    REFERENCES "catalogo_artefactos"("id", "organization_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "catalogo_artefacto_destinos_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "catalogo_artefacto_destinos_creado_por_id_fkey"
    FOREIGN KEY ("creado_por_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "catalogo_artefacto_destinos_actualizado_por_id_fkey"
    FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_catalogo_artefacto_destino"
  ON "catalogo_artefacto_destinos"("organization_id", "artefacto_id", "destino");
CREATE INDEX "idx_catalogo_destino_resolver"
  ON "catalogo_artefacto_destinos"("organization_id", "destino", "activo", "predeterminado");
CREATE TRIGGER "trg_catalogo_destino_creator_membership"
BEFORE INSERT OR UPDATE ON pravia_os.catalogo_artefacto_destinos
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership('creado_por_id');

CREATE TRIGGER "trg_catalogo_destino_updater_membership"
BEFORE INSERT OR UPDATE ON pravia_os.catalogo_artefacto_destinos
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership('actualizado_por_id');

ALTER TABLE "catalogo_artefacto_destinos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_catalogo_artefacto_destinos" ON "catalogo_artefacto_destinos"
USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- Backfill únicamente para artefactos estándar cuya identidad contractual es
-- inequívoca. La misma ADM-001 puede atender Cotización y Presupuesto sin
-- duplicar el blob. Todo lo no demostrable queda explícitamente SIN_ASIGNAR.
INSERT INTO "catalogo_artefacto_destinos" (
  "id", "organization_id", "artefacto_id", "destino", "activo", "predeterminado",
  "creado_por_id", "actualizado_por_id"
)
SELECT gen_random_uuid(), a."organization_id", a."id", x."destino"::"CatalogoDestinoFuncional", true, true,
       a."creado_por_id", a."actualizado_por_id"
FROM "catalogo_artefactos" a
CROSS JOIN LATERAL (
  SELECT unnest(CASE
    WHEN a."codigo_biblioteca" LIKE '%:ADM-001' THEN ARRAY['COTIZACION_SERVICIOS', 'EXPEDIENTE_PRESUPUESTO']
    WHEN a."codigo_biblioteca" LIKE '%:ADM-002' THEN ARRAY['FINANZAS_RECIBO_PAGO']
    WHEN a."codigo_biblioteca" LIKE '%:ADM-003' THEN ARRAY['EXPEDIENTE_DOCUMENTO_GENERICO']
    WHEN a."codigo_biblioteca" LIKE '%:PRY-%' THEN ARRAY['PROYECTO_MACHOTE']
    WHEN a."codigo_biblioteca" LIKE '%:PLD-%' THEN ARRAY['CUMPLIMIENTO_PLD_UIF']
    WHEN lower(a."nombre") LIKE '%memoria%isr%' THEN ARRAY['CALCULO_ISR_MEMORIA']
    ELSE ARRAY['SIN_ASIGNAR']
  END) AS "destino"
) x
ON CONFLICT ("organization_id", "artefacto_id", "destino") DO NOTHING;

-- Un posible catálogo duplicado se conserva y se deja revisable; sólo el
-- primero por destino mantiene la preselección para evitar una elección al azar.
WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "organization_id", "destino"
    ORDER BY "created_at", "id"
  ) AS rn
  FROM "catalogo_artefacto_destinos"
  WHERE "predeterminado" = true AND "destino" <> 'SIN_ASIGNAR'
)
UPDATE "catalogo_artefacto_destinos" d
SET "predeterminado" = false
FROM ranked r
WHERE d."id" = r."id" AND r.rn > 1;

CREATE UNIQUE INDEX "uq_catalogo_destino_default"
  ON "catalogo_artefacto_destinos"("organization_id", "destino")
  WHERE "activo" = true AND "predeterminado" = true AND "destino" <> 'SIN_ASIGNAR';

-- Los cuestionarios genéricos previos y sus respuestas no se eliminan ni se
-- reclasifican automáticamente: quedan como histórico hasta una clasificación
-- humana inequívoca en los dos bancos globales de Cumplimiento.

-- Corrección 012 permite un solo artefacto activo por banco y organización.
-- Si una versión anterior publicó más de uno, se preservan los registros y las
-- revisiones históricas; sólo se retiran los catálogos activos excedentes.
WITH ranked_banks AS (
  SELECT a."id",
         row_number() OVER (
           PARTITION BY a."organization_id", a."purpose"
           ORDER BY
             CASE
               WHEN a."purpose" = 'CUE_PERSONAL' AND a."codigo_biblioteca" = 'CFG-CUE-PERSONAL' THEN 0
               WHEN a."purpose" = 'CUE_GENERAL' AND a."codigo_biblioteca" = 'CFG-CUE-OPERACION' THEN 0
               ELSE 1
             END,
             a."created_at",
             a."id"
         ) AS rn
  FROM "catalogo_artefactos" a
  WHERE a."activo" = true
    AND a."purpose" IN ('CUE_PERSONAL', 'CUE_GENERAL')
), retired_banks AS (
  UPDATE "catalogo_artefactos" a
  SET "activo" = false,
      "updated_at" = CURRENT_TIMESTAMP
  FROM ranked_banks r
  WHERE a."id" = r."id" AND r.rn > 1
  RETURNING a."id"
)
UPDATE "catalogo_artefacto_versiones" v
SET "activa" = false
WHERE v."artefacto_id" IN (SELECT "id" FROM retired_banks)
  AND v."activa" = true;

CREATE UNIQUE INDEX "uq_catalogo_questionnaire_bank_purpose"
  ON "catalogo_artefactos"("organization_id", "purpose")
  WHERE "activo" = true AND "purpose" IN ('CUE_PERSONAL', 'CUE_GENERAL');

-- H5 originalmente modelaba un único cuestionario GENERAL. Corrección 012
-- mantiene esa identidad como histórica, pero para nuevos registros exige una
-- instancia Acto / Operación por cada acto aplicable.
ALTER TABLE "compliance_questionnaire_assessments"
  DROP CONSTRAINT "h5_questionnaire_scope_target_check";

ALTER TABLE "compliance_questionnaire_assessments"
  ADD CONSTRAINT "h5_questionnaire_scope_target_check" CHECK (
    (
      "scope" = 'GENERAL'
      AND "target_compareciente_id" IS NULL
      AND (
        "identity_key" = 'GENERAL'
        OR "identity_key" ~ '^OPERACION:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    )
    OR
    (
      "scope" = 'PERSONAL'
      AND "target_compareciente_id" IS NOT NULL
      AND "identity_key" = 'PERSONAL:' || "target_compareciente_id"::text
    )
  );
