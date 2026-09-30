-- Corrección 017: una sola actividad operativa por Proceso maestro y Expediente.
-- Conserva todas las procedencias por Acto antes de consolidar filas legacy.

BEGIN;

ALTER TABLE "expediente_seguimiento_actividades"
  ADD COLUMN "proceso_clave" VARCHAR(220);

CREATE UNIQUE INDEX "uq_exp_seguimiento_id_org"
  ON "expediente_seguimiento_actividades"("id", "organization_id");

CREATE TABLE "expediente_seguimiento_origenes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "actividad_id" UUID NOT NULL,
  "expediente_acto_id" UUID NOT NULL,
  "tipo_acto_id" UUID NOT NULL,
  "origen_clave" VARCHAR(320) NOT NULL,
  "configuracion_acto_id" UUID,
  "configuracion_revision" INTEGER,
  "actividad_maestra_id" UUID,
  "concepto_maestro_id" UUID,
  "alcance_instancia" "ConfiguracionAlcanceInstancia" NOT NULL,
  "alcance_referencia_id" UUID,
  "duracion_configurada" INTEGER NOT NULL,
  "tipo_dias_configurado" "ConfiguracionTipoDias" NOT NULL,
  "margen_configurado" INTEGER NOT NULL DEFAULT 0,
  "fuente_tiempo_snapshot" "ConfiguracionFuenteTiempo" NOT NULL,
  "en_alcance" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_seguimiento_origenes_pkey" PRIMARY KEY ("id")
);

CREATE TEMP TABLE "_exp017_activity_map" ON COMMIT DROP AS
WITH keyed AS (
  SELECT a.*,
    CASE
      WHEN a."extraordinaria" THEN 'EXTRA:' || a."id"::text
      WHEN a."identidad_instancia" LIKE 'LEGAL:%' THEN a."identidad_instancia"
      ELSE 'PROCESS:' || COALESCE(a."concepto_maestro_id"::text, a."actividad_maestra_id"::text, a."id"::text)
        || CASE WHEN a."alcance_instancia"::text = 'INMUEBLE'
          THEN ':PROPERTY:' || COALESCE(a."alcance_referencia_id"::text, 'SIN_REFERENCIA') ELSE '' END
    END AS process_key
  FROM "expediente_seguimiento_actividades" a
), ranked AS (
  SELECT k.*,
    first_value(k."id") OVER (
      PARTITION BY k."organization_id", k."expediente_id", k.process_key
      ORDER BY (k."estado"::text = 'COMPLETADO') DESC,
               (k."estado"::text = 'NO_APLICA') DESC,
               k."created_at" ASC, k."id" ASC
    ) AS canonical_id
  FROM keyed k
)
SELECT "id" AS old_id, canonical_id, "organization_id", "expediente_id", process_key
FROM ranked;

INSERT INTO "expediente_seguimiento_origenes" (
  "organization_id", "expediente_id", "actividad_id", "expediente_acto_id", "tipo_acto_id", "origen_clave",
  "configuracion_acto_id", "configuracion_revision", "actividad_maestra_id", "concepto_maestro_id",
  "alcance_instancia", "alcance_referencia_id", "duracion_configurada", "tipo_dias_configurado",
  "margen_configurado", "fuente_tiempo_snapshot", "created_at", "updated_at"
)
SELECT a."organization_id", a."expediente_id", m.canonical_id, a."expediente_acto_id", a."tipo_acto_id",
  a."expediente_acto_id"::text || ':' || COALESCE(a."actividad_maestra_id"::text, a."identidad_instancia")
    || ':' || a."alcance_instancia"::text || ':' || COALESCE(a."alcance_referencia_id"::text, 'SIN_REFERENCIA'),
  a."configuracion_acto_id", a."configuracion_revision", a."actividad_maestra_id", a."concepto_maestro_id",
  a."alcance_instancia", a."alcance_referencia_id", a."duracion_estimada", a."tipo_dias",
  a."margen_seguridad", a."fuente_tiempo_snapshot", a."created_at", a."updated_at"
FROM "expediente_seguimiento_actividades" a
JOIN "_exp017_activity_map" m ON m.old_id = a."id"
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE "_exp017_dependencies" ON COMMIT DROP AS
SELECT d."organization_id", d."expediente_id",
  source_map.canonical_id AS actividad_id,
  prerequisite_map.canonical_id AS depende_actividad_id,
  min(d."dependencia_maestra_id"::text)::uuid AS dependencia_maestra_id,
  min(d."excepcion_dependencia_maestra_id"::text)::uuid AS excepcion_dependencia_maestra_id,
  bool_or(d."bloqueante") AS bloqueante,
  min(d."created_at") AS created_at
FROM "expediente_seguimiento_dependencias" d
JOIN "_exp017_activity_map" source_map ON source_map.old_id = d."actividad_id"
JOIN "_exp017_activity_map" prerequisite_map ON prerequisite_map.old_id = d."depende_actividad_id"
WHERE source_map.canonical_id <> prerequisite_map.canonical_id
GROUP BY d."organization_id", d."expediente_id", source_map.canonical_id, prerequisite_map.canonical_id;

DELETE FROM "expediente_seguimiento_dependencias";

INSERT INTO "expediente_seguimiento_dependencias" (
  "id", "organization_id", "expediente_id", "actividad_id", "depende_actividad_id",
  "dependencia_maestra_id", "excepcion_dependencia_maestra_id", "bloqueante", "created_at"
)
SELECT gen_random_uuid(), "organization_id", "expediente_id", actividad_id, depende_actividad_id,
  dependencia_maestra_id, excepcion_dependencia_maestra_id, bloqueante, created_at
FROM "_exp017_dependencies";

UPDATE "expediente_seguimiento_historial" h
SET "actividad_id" = m.canonical_id
FROM "_exp017_activity_map" m
WHERE h."actividad_id" = m.old_id AND m.old_id <> m.canonical_id;

WITH aggregate_state AS (
  SELECT m.canonical_id,
    max(a."duracion_estimada") AS duration_max,
    max(a."margen_seguridad") AS margin_max,
    min(a."orden_operativo") AS order_min,
    min(a."etapa_orden_snapshot") AS stage_order_min,
    min(a."primera_fecha_inicio") AS first_started_at,
    min(a."fecha_inicio_base") AS baseline_start,
    max(a."fecha_objetivo_base") AS baseline_due,
    min(a."fecha_inicio_proyectada") AS projected_start,
    max(a."fecha_objetivo_proyectada") AS projected_due,
    max(a."fecha_completada_actual") AS completed_at,
    bool_or(a."en_alcance") AS in_scope,
    bool_or(a."requiere_revision") AS review_required,
    bool_or(a."estado"::text = 'COMPLETADO') AS any_completed,
    bool_and(a."estado"::text = 'NO_APLICA') AS all_not_applicable,
    max(a."version") + CASE WHEN count(*) > 1 THEN 1 ELSE 0 END AS merged_version
  FROM "_exp017_activity_map" m
  JOIN "expediente_seguimiento_actividades" a ON a."id" = m.old_id
  GROUP BY m.canonical_id
), completion_actor AS (
  SELECT DISTINCT ON (m.canonical_id) m.canonical_id, a."completada_por_id"
  FROM "_exp017_activity_map" m
  JOIN "expediente_seguimiento_actividades" a ON a."id" = m.old_id
  WHERE a."estado"::text = 'COMPLETADO'
  ORDER BY m.canonical_id, a."fecha_completada_actual" DESC NULLS LAST, a."updated_at" DESC
)
UPDATE "expediente_seguimiento_actividades" target
SET "proceso_clave" = mapping.process_key,
    "duracion_estimada" = aggregate_state.duration_max,
    "tipo_dias" = 'HABILES'::"ConfiguracionTipoDias",
    "margen_seguridad" = aggregate_state.margin_max,
    "orden_operativo" = aggregate_state.order_min,
    "etapa_orden_snapshot" = aggregate_state.stage_order_min,
    "primera_fecha_inicio" = aggregate_state.first_started_at,
    "fecha_inicio_base" = aggregate_state.baseline_start,
    "fecha_objetivo_base" = aggregate_state.baseline_due,
    "fecha_inicio_proyectada" = aggregate_state.projected_start,
    "fecha_objetivo_proyectada" = aggregate_state.projected_due,
    "fecha_completada_actual" = aggregate_state.completed_at,
    "completada_por_id" = completion_actor."completada_por_id",
    "en_alcance" = aggregate_state.in_scope,
    "requiere_revision" = aggregate_state.review_required,
    "estado" = CASE
      WHEN aggregate_state.any_completed THEN 'COMPLETADO'::"SeguimientoActividadEstado"
      WHEN aggregate_state.all_not_applicable THEN 'NO_APLICA'::"SeguimientoActividadEstado"
      ELSE target."estado"
    END,
    "version" = aggregate_state.merged_version,
    "updated_at" = CURRENT_TIMESTAMP
FROM "_exp017_activity_map" mapping
JOIN aggregate_state ON aggregate_state.canonical_id = mapping.canonical_id
LEFT JOIN completion_actor ON completion_actor.canonical_id = mapping.canonical_id
WHERE target."id" = mapping.canonical_id;

DELETE FROM "expediente_seguimiento_actividades" a
USING "_exp017_activity_map" m
WHERE a."id" = m.old_id AND m.old_id <> m.canonical_id;

ALTER TABLE "expediente_seguimiento_actividades"
  ALTER COLUMN "proceso_clave" SET NOT NULL;

CREATE UNIQUE INDEX "uq_exp_seguimiento_proceso"
  ON "expediente_seguimiento_actividades"("organization_id", "expediente_id", "proceso_clave");

CREATE UNIQUE INDEX "uq_exp_seguimiento_origen"
  ON "expediente_seguimiento_origenes"("organization_id", "actividad_id", "origen_clave");
CREATE INDEX "idx_exp_seguimiento_origen_acto"
  ON "expediente_seguimiento_origenes"("organization_id", "expediente_id", "expediente_acto_id");
CREATE INDEX "idx_exp_seguimiento_origen_concepto"
  ON "expediente_seguimiento_origenes"("organization_id", "concepto_maestro_id");

ALTER TABLE "expediente_seguimiento_origenes"
  ADD CONSTRAINT "exp_seguimiento_origen_org_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "exp_seguimiento_origen_expediente_fkey"
  FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "expedientes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "exp_seguimiento_origen_actividad_fkey"
  FOREIGN KEY ("actividad_id", "organization_id") REFERENCES "expediente_seguimiento_actividades"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "exp_seguimiento_origen_acto_fkey"
  FOREIGN KEY ("expediente_acto_id", "organization_id", "expediente_id") REFERENCES "expediente_actos"("id", "organization_id", "expediente_id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
