-- Corrección Integral Actos + Plantillas + Proyección.
-- La retirada es deliberadamente no destructiva: las filas históricas y sus
-- claves foráneas permanecen disponibles para expedientes y snapshots.

CREATE TABLE "project_template_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "tipo_acto_id" UUID NOT NULL,
    "artefacto_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_template_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_project_template_assignment_org_act"
ON "project_template_assignments"("organization_id", "tipo_acto_id");

CREATE INDEX "idx_project_template_assignment_active"
ON "project_template_assignments"("organization_id", "active");

CREATE INDEX "idx_project_template_assignment_artifact_version"
ON "project_template_assignments"("artefacto_id", "version_id");

CREATE INDEX "idx_project_template_assignment_created_by"
ON "project_template_assignments"("created_by_id");

CREATE INDEX "idx_project_template_assignment_updated_by"
ON "project_template_assignments"("updated_by_id");

CREATE INDEX "idx_project_template_assignment_artifact_tenant"
ON "project_template_assignments"("artefacto_id", "organization_id");

CREATE INDEX "idx_project_template_assignment_version_tenant"
ON "project_template_assignments"("version_id", "organization_id");

-- Cierra dos índices tenant/actor pendientes en las relaciones de Actos de
-- Prospectos y Cotizaciones, sin alterar sus datos ni su semántica.
CREATE INDEX IF NOT EXISTS "idx_prospecto_actos_actor_tenant"
ON "prospecto_actos"("organization_id", "created_by_id");

CREATE INDEX IF NOT EXISTS "idx_cotizacion_actos_confirmer_tenant"
ON "cotizacion_actos"("organization_id", "confirmed_by_id");

ALTER TABLE "project_template_assignments"
ADD CONSTRAINT "project_template_assignments_organization_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_template_assignments"
ADD CONSTRAINT "project_template_assignments_act_fkey"
FOREIGN KEY ("tipo_acto_id") REFERENCES "tipos_acto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_template_assignments"
ADD CONSTRAINT "project_template_assignments_artifact_tenant_fkey"
FOREIGN KEY ("artefacto_id", "organization_id") REFERENCES "catalogo_artefactos"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_template_assignments"
ADD CONSTRAINT "project_template_assignments_version_tenant_fkey"
FOREIGN KEY ("version_id", "organization_id") REFERENCES "catalogo_artefacto_versiones"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_template_assignments"
ADD CONSTRAINT "project_template_assignments_created_by_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_template_assignments"
ADD CONSTRAINT "project_template_assignments_updated_by_fkey"
FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "trg_project_template_assignments_created_by_membership"
BEFORE INSERT OR UPDATE ON pravia_os.project_template_assignments
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership('created_by_id');

CREATE TRIGGER "trg_project_template_assignments_updated_by_membership"
BEFORE INSERT OR UPDATE ON pravia_os.project_template_assignments
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership('updated_by_id');

-- Vacía el inventario activo inicial sin borrar identidad ni trazabilidad.
UPDATE "tipos_acto"
SET "activo" = false,
    "archived_at" = COALESCE("archived_at", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "activo" = true OR "archived_at" IS NULL;

-- Retira únicamente el inventario funcional de machotes Project. Los
-- artefactos, versiones, blobs y demás destinos CFG-002 se preservan.
UPDATE "catalogo_artefacto_destinos"
SET "activo" = false,
    "predeterminado" = false,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "destino" = 'PROYECTO_MACHOTE';
