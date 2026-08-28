CREATE TYPE "SeguimientoActividadEstado" AS ENUM ('NO_INICIADO', 'EN_PROCESO', 'EN_ESPERA_EXTERNA', 'COMPLETADO', 'BLOQUEADO', 'NO_APLICA');

CREATE TABLE "expediente_seguimiento_actividades" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "expediente_id" UUID NOT NULL,
  "expediente_acto_id" UUID NOT NULL, "tipo_acto_id" UUID NOT NULL, "configuracion_acto_id" UUID NOT NULL,
  "configuracion_revision" INTEGER NOT NULL, "etapa_maestra_id" UUID NOT NULL, "actividad_maestra_id" UUID NOT NULL,
  "etapa_nombre_snapshot" TEXT NOT NULL, "etapa_orden_snapshot" INTEGER NOT NULL, "actividad_nombre_snapshot" TEXT NOT NULL,
  "actividad_descripcion_snapshot" TEXT, "duracion_estimada" INTEGER NOT NULL, "tipo_dias" "ConfiguracionTipoDias" NOT NULL,
  "margen_seguridad" INTEGER NOT NULL DEFAULT 0, "responsable_rol_snapshot" "Role", "responsable_default_id" UUID,
  "responsable_id" UUID, "aplica_por_defecto" BOOLEAN NOT NULL DEFAULT true, "excepcion_maestra_id" UUID,
  "excepciones_coincidentes" JSONB, "resolucion_fuente" TEXT NOT NULL DEFAULT 'GENERAL', "excepcion_operativa" JSONB,
  "estado" "SeguimientoActividadEstado" NOT NULL DEFAULT 'NO_INICIADO', "version" INTEGER NOT NULL DEFAULT 1,
  "en_alcance" BOOLEAN NOT NULL DEFAULT true, "requiere_revision" BOOLEAN NOT NULL DEFAULT false, "motivo_revision" TEXT,
  "primera_fecha_inicio" TIMESTAMP(3), "fecha_completada_actual" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_seguimiento_actividades_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expediente_seguimiento_dependencias" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "expediente_id" UUID NOT NULL,
  "actividad_id" UUID NOT NULL, "depende_actividad_id" UUID NOT NULL, "dependencia_maestra_id" UUID,
  "excepcion_dependencia_maestra_id" UUID, "bloqueante" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_seguimiento_dependencias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expediente_seguimiento_historial" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "expediente_id" UUID NOT NULL,
  "actividad_id" UUID NOT NULL, "actor_user_id" UUID NOT NULL, "estado_anterior" "SeguimientoActividadEstado",
  "estado_nuevo" "SeguimientoActividadEstado" NOT NULL, "version_anterior" INTEGER, "version_nueva" INTEGER NOT NULL,
  "razon" TEXT, "detalles" JSONB, "correlation_id" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_seguimiento_historial_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_exp_seguimiento_acto_actividad" ON "expediente_seguimiento_actividades"("organization_id", "expediente_acto_id", "actividad_maestra_id");
CREATE INDEX "idx_exp_seguimiento_tenant_expediente" ON "expediente_seguimiento_actividades"("organization_id", "expediente_id", "en_alcance");
CREATE INDEX "idx_exp_seguimiento_responsable_estado" ON "expediente_seguimiento_actividades"("organization_id", "responsable_id", "estado");
CREATE INDEX "idx_exp_seguimiento_expediente_acto_fk" ON "expediente_seguimiento_actividades"("expediente_acto_id");
CREATE INDEX "idx_exp_seguimiento_actividad_maestra_fk" ON "expediente_seguimiento_actividades"("actividad_maestra_id");
CREATE UNIQUE INDEX "uq_exp_seguimiento_dependencia" ON "expediente_seguimiento_dependencias"("organization_id", "actividad_id", "depende_actividad_id");
CREATE INDEX "idx_exp_seguimiento_dep_tenant_expediente" ON "expediente_seguimiento_dependencias"("organization_id", "expediente_id");
CREATE INDEX "idx_exp_seguimiento_dep_prerequisito_fk" ON "expediente_seguimiento_dependencias"("depende_actividad_id");
CREATE INDEX "idx_exp_seguimiento_hist_tenant_exp" ON "expediente_seguimiento_historial"("organization_id", "expediente_id", "created_at");
CREATE INDEX "idx_exp_seguimiento_hist_actividad" ON "expediente_seguimiento_historial"("actividad_id", "created_at");
CREATE INDEX "idx_exp_seguimiento_hist_actor_fk" ON "expediente_seguimiento_historial"("actor_user_id");

ALTER TABLE "expediente_seguimiento_actividades" ADD CONSTRAINT "exp_seguimiento_actividad_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_actividades" ADD CONSTRAINT "exp_seguimiento_actividad_expediente_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_actividades" ADD CONSTRAINT "exp_seguimiento_actividad_acto_fkey" FOREIGN KEY ("expediente_acto_id") REFERENCES "expediente_actos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_actividades" ADD CONSTRAINT "exp_seguimiento_actividad_tipo_acto_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_actividades" ADD CONSTRAINT "exp_seguimiento_actividad_config_fkey" FOREIGN KEY ("configuracion_acto_id") REFERENCES "configuracion_actos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_actividades" ADD CONSTRAINT "exp_seguimiento_actividad_etapa_fkey" FOREIGN KEY ("etapa_maestra_id") REFERENCES "configuracion_etapas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_actividades" ADD CONSTRAINT "exp_seguimiento_actividad_maestra_fkey" FOREIGN KEY ("actividad_maestra_id") REFERENCES "configuracion_actividades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_actividades" ADD CONSTRAINT "exp_seguimiento_actividad_excepcion_fkey" FOREIGN KEY ("excepcion_maestra_id") REFERENCES "configuracion_excepciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_actividades" ADD CONSTRAINT "exp_seguimiento_actividad_responsable_default_fkey" FOREIGN KEY ("responsable_default_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_actividades" ADD CONSTRAINT "exp_seguimiento_actividad_responsable_fkey" FOREIGN KEY ("responsable_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_dependencias" ADD CONSTRAINT "exp_seguimiento_dep_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_dependencias" ADD CONSTRAINT "exp_seguimiento_dep_expediente_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_dependencias" ADD CONSTRAINT "exp_seguimiento_dep_actividad_fkey" FOREIGN KEY ("actividad_id") REFERENCES "expediente_seguimiento_actividades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_dependencias" ADD CONSTRAINT "exp_seguimiento_dep_prerequisito_fkey" FOREIGN KEY ("depende_actividad_id") REFERENCES "expediente_seguimiento_actividades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_dependencias" ADD CONSTRAINT "exp_seguimiento_dep_maestra_fkey" FOREIGN KEY ("dependencia_maestra_id") REFERENCES "configuracion_dependencias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_dependencias" ADD CONSTRAINT "exp_seguimiento_dep_excepcion_maestra_fkey" FOREIGN KEY ("excepcion_dependencia_maestra_id") REFERENCES "configuracion_excepcion_dependencias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_historial" ADD CONSTRAINT "exp_seguimiento_hist_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_historial" ADD CONSTRAINT "exp_seguimiento_hist_expediente_fkey" FOREIGN KEY ("expediente_id") REFERENCES "expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_historial" ADD CONSTRAINT "exp_seguimiento_hist_actividad_fkey" FOREIGN KEY ("actividad_id") REFERENCES "expediente_seguimiento_actividades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expediente_seguimiento_historial" ADD CONSTRAINT "exp_seguimiento_hist_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No historical progress is inferred and this migration inserts no operational rows.
