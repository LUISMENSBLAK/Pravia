-- CFG-001 v2.0: additive master concepts, act inheritance and operational provenance.
-- Existing activity rows are preserved byte-for-byte; the backfill deliberately creates
-- one concept per legacy row because semantic sharing cannot be inferred safely.

CREATE TYPE "ConfiguracionActividadNaturaleza" AS ENUM
  ('INTERNA', 'INGRESO_A_EXTERNO', 'ESPERA_EXTERNA', 'CLIENTE_HITO', 'REQUISITO_PREVIO_A_HITO');
CREATE TYPE "ConfiguracionUnidadTiempo" AS ENUM ('DIAS', 'HORAS');
CREATE TYPE "ConfiguracionFuenteTiempo" AS ENUM ('GENERAL', 'OVERRIDE_ACTO', 'INSTITUCION', 'REGLA_JURIDICA');
CREATE TYPE "ConfiguracionAlcanceInstancia" AS ENUM ('EXPEDIENTE', 'ACTO', 'INMUEBLE');

CREATE TABLE "configuracion_conceptos_actividad" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "codigo" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "descripcion" TEXT,
  "naturaleza" "ConfiguracionActividadNaturaleza" NOT NULL DEFAULT 'INTERNA',
  "duracion_estimada" INTEGER NOT NULL DEFAULT 0,
  "unidad_tiempo" "ConfiguracionUnidadTiempo" NOT NULL DEFAULT 'DIAS',
  "tipo_dias" "ConfiguracionTipoDias" NOT NULL DEFAULT 'HABILES',
  "margen_seguridad" INTEGER NOT NULL DEFAULT 0,
  "responsable_rol" "Role",
  "responsable_usuario_id" UUID,
  "aplica_por_defecto" BOOLEAN NOT NULL DEFAULT true,
  "fuente_tiempo" "ConfiguracionFuenteTiempo" NOT NULL DEFAULT 'GENERAL',
  "condicion_json" JSONB,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "requiere_revision" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "configuracion_conceptos_actividad_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_cfg_concepto_duration" CHECK ("duracion_estimada" >= 0 AND "margen_seguridad" >= 0),
  CONSTRAINT "ck_cfg_concepto_responsable" CHECK ("responsable_rol" IS NULL OR "responsable_usuario_id" IS NULL)
);
CREATE UNIQUE INDEX "uq_cfg_concepto_org_codigo" ON "configuracion_conceptos_actividad"("organization_id", "codigo");
CREATE UNIQUE INDEX "uq_cfg_concepto_id_org" ON "configuracion_conceptos_actividad"("id", "organization_id");
CREATE INDEX "idx_cfg_concepto_org_activo" ON "configuracion_conceptos_actividad"("organization_id", "activa", "nombre");
CREATE INDEX "idx_cfg_concepto_responsable" ON "configuracion_conceptos_actividad"("organization_id", "responsable_usuario_id");

ALTER TABLE "configuracion_actos"
  ADD COLUMN "familia" TEXT,
  ADD COLUMN "hereda_configuracion_id" UUID,
  ADD COLUMN "exclusiones_conceptos" JSONB;
CREATE UNIQUE INDEX "uq_config_acto_id_org" ON "configuracion_actos"("id", "organization_id");
ALTER TABLE "configuracion_actos" ADD CONSTRAINT "configuracion_actos_hereda_configuracion_id_fkey"
  FOREIGN KEY ("hereda_configuracion_id", "organization_id") REFERENCES "configuracion_actos"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "idx_cfg_actos_base" ON "configuracion_actos"("organization_id", "hereda_configuracion_id");

ALTER TABLE "configuracion_actividades"
  ADD COLUMN "concepto_maestro_id" UUID,
  ADD COLUMN "naturaleza" "ConfiguracionActividadNaturaleza" NOT NULL DEFAULT 'INTERNA',
  ADD COLUMN "unidad_tiempo" "ConfiguracionUnidadTiempo" NOT NULL DEFAULT 'DIAS',
  ADD COLUMN "fuente_tiempo" "ConfiguracionFuenteTiempo" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "alcance_instancia" "ConfiguracionAlcanceInstancia" NOT NULL DEFAULT 'ACTO',
  ADD COLUMN "atributos_heredados" JSONB,
  ADD COLUMN "condicion_json" JSONB,
  ADD COLUMN "grupo_paralelo" TEXT,
  ADD COLUMN "orden_operativo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "configuracion_actividades" ADD CONSTRAINT "configuracion_actividades_concepto_maestro_id_fkey"
  FOREIGN KEY ("concepto_maestro_id", "organization_id") REFERENCES "configuracion_conceptos_actividad"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "idx_cfg_actividad_concepto" ON "configuracion_actividades"("organization_id", "concepto_maestro_id");

CREATE UNIQUE INDEX "uq_catalogo_institucion_id_org_cfg" ON "catalogo_instituciones"("id", "organization_id");

CREATE TABLE "catalogo_institucion_tipos_respuesta" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "institucion_id" UUID NOT NULL,
  "codigo" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "duracion" INTEGER NOT NULL,
  "tipo_dias" "ConfiguracionTipoDias" NOT NULL,
  "margen_seguridad" INTEGER NOT NULL DEFAULT 0,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalogo_institucion_tipos_respuesta_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_cfg_inst_response_duration" CHECK ("duracion" >= 0 AND "margen_seguridad" >= 0),
  CONSTRAINT "catalogo_institucion_tipos_respuesta_institucion_id_fkey" FOREIGN KEY ("institucion_id", "organization_id") REFERENCES "catalogo_instituciones"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uq_cfg_inst_respuesta_org_inst_codigo" ON "catalogo_institucion_tipos_respuesta"("organization_id", "institucion_id", "codigo");
CREATE UNIQUE INDEX "uq_cfg_inst_respuesta_id_org" ON "catalogo_institucion_tipos_respuesta"("id", "organization_id");
CREATE INDEX "idx_cfg_inst_respuesta_org_inst" ON "catalogo_institucion_tipos_respuesta"("organization_id", "institucion_id", "activa");

ALTER TABLE "configuracion_excepciones" ADD COLUMN "tipo_respuesta_id" UUID;
ALTER TABLE "configuracion_excepciones" ADD CONSTRAINT "configuracion_excepciones_tipo_respuesta_id_fkey"
  FOREIGN KEY ("tipo_respuesta_id", "organization_id") REFERENCES "catalogo_institucion_tipos_respuesta"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "idx_config_excepciones_tipo_respuesta" ON "configuracion_excepciones"("tipo_respuesta_id", "organization_id");

-- Conservative legacy backfill. No two pre-v2 rows are merged automatically.
INSERT INTO "configuracion_conceptos_actividad" (
  "id", "organization_id", "codigo", "nombre", "descripcion", "duracion_estimada",
  "tipo_dias", "margen_seguridad", "responsable_rol", "responsable_usuario_id",
  "aplica_por_defecto", "activa", "requiere_revision", "created_at", "updated_at"
)
SELECT gen_random_uuid(), a."organization_id", 'LEGACY_' || replace(a."id"::text, '-', ''),
       a."nombre", a."descripcion", a."duracion_estimada", a."tipo_dias", a."margen_seguridad",
       a."responsable_rol", a."responsable_usuario_id", a."aplica_por_defecto", a."activa", true,
       a."created_at", a."updated_at"
FROM "configuracion_actividades" a;

UPDATE "configuracion_actividades" a
SET "concepto_maestro_id" = c."id",
    "atributos_heredados" = '[]'::jsonb
FROM "configuracion_conceptos_actividad" c
WHERE c."organization_id" = a."organization_id"
  AND c."codigo" = 'LEGACY_' || replace(a."id"::text, '-', '');

ALTER TABLE "expediente_seguimiento_actividades"
  ALTER COLUMN "configuracion_acto_id" DROP NOT NULL,
  ALTER COLUMN "configuracion_revision" DROP NOT NULL,
  ALTER COLUMN "etapa_maestra_id" DROP NOT NULL,
  ALTER COLUMN "actividad_maestra_id" DROP NOT NULL,
  ADD COLUMN "concepto_maestro_id" UUID,
  ADD COLUMN "concepto_revision" INTEGER,
  ADD COLUMN "identidad_instancia" TEXT,
  ADD COLUMN "naturaleza_snapshot" "ConfiguracionActividadNaturaleza" NOT NULL DEFAULT 'INTERNA',
  ADD COLUMN "fuente_tiempo_snapshot" "ConfiguracionFuenteTiempo" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "alcance_instancia" "ConfiguracionAlcanceInstancia" NOT NULL DEFAULT 'ACTO',
  ADD COLUMN "alcance_referencia_id" UUID,
  ADD COLUMN "grupo_paralelo_snapshot" TEXT,
  ADD COLUMN "orden_operativo" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "condicion_snapshot" JSONB,
  ADD COLUMN "extraordinaria" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fecha_inicio_base" TIMESTAMP(3),
  ADD COLUMN "fecha_objetivo_base" TIMESTAMP(3),
  ADD COLUMN "fecha_inicio_proyectada" TIMESTAMP(3),
  ADD COLUMN "fecha_objetivo_proyectada" TIMESTAMP(3),
  ADD COLUMN "completada_por_id" UUID;

UPDATE "expediente_seguimiento_actividades" e
SET "concepto_maestro_id" = a."concepto_maestro_id",
    "concepto_revision" = c."revision",
    "identidad_instancia" = 'ACT:' || e."actividad_maestra_id"::text,
    "naturaleza_snapshot" = a."naturaleza",
    "fuente_tiempo_snapshot" = a."fuente_tiempo",
    "alcance_instancia" = a."alcance_instancia",
    "grupo_paralelo_snapshot" = a."grupo_paralelo",
    "orden_operativo" = a."orden_operativo",
    "condicion_snapshot" = a."condicion_json",
    "fecha_inicio_base" = e."primera_fecha_inicio",
    "fecha_objetivo_base" = CASE WHEN e."primera_fecha_inicio" IS NOT NULL
      THEN e."primera_fecha_inicio" + make_interval(days => e."duracion_estimada") ELSE NULL END,
    "fecha_inicio_proyectada" = e."primera_fecha_inicio",
    "fecha_objetivo_proyectada" = CASE WHEN e."primera_fecha_inicio" IS NOT NULL
      THEN e."primera_fecha_inicio" + make_interval(days => e."duracion_estimada") ELSE NULL END
FROM "configuracion_actividades" a
JOIN "configuracion_conceptos_actividad" c ON c."id" = a."concepto_maestro_id"
WHERE a."id" = e."actividad_maestra_id";

ALTER TABLE "expediente_seguimiento_actividades" ALTER COLUMN "identidad_instancia" SET NOT NULL;
DROP INDEX IF EXISTS "uq_exp_seguimiento_acto_actividad";
CREATE UNIQUE INDEX "uq_exp_seguimiento_identidad" ON "expediente_seguimiento_actividades"("organization_id", "expediente_acto_id", "identidad_instancia");
CREATE INDEX "idx_exp_seguimiento_concepto" ON "expediente_seguimiento_actividades"("organization_id", "concepto_maestro_id");
CREATE INDEX "idx_exp_seguimiento_completada_por" ON "expediente_seguimiento_actividades"("organization_id", "completada_por_id");
ALTER TABLE "expediente_seguimiento_actividades" ADD CONSTRAINT "exp_seguimiento_concepto_maestro_fkey"
  FOREIGN KEY ("concepto_maestro_id", "organization_id") REFERENCES "configuracion_conceptos_actividad"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_actividades" ADD CONSTRAINT "exp_seguimiento_completada_por_fkey"
  FOREIGN KEY ("organization_id", "completada_por_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "configuracion_conceptos_actividad" ADD CONSTRAINT "configuracion_conceptos_org_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "configuracion_conceptos_actividad" ADD CONSTRAINT "configuracion_conceptos_responsable_fkey"
  FOREIGN KEY ("organization_id", "responsable_usuario_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "catalogo_institucion_tipos_respuesta" ADD CONSTRAINT "catalogo_inst_respuesta_org_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
