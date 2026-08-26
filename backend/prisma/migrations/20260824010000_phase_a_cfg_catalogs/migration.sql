-- Phase A contractual implementation: CFG-001 Actos y tiempos + CFG-002 Plantillas y formatos.
-- Additive only: existing workflow/document rows are preserved and remain operationally untouched.

ALTER TABLE "pravia_os"."tipos_acto"
  ADD COLUMN IF NOT EXISTS "codigo_catalogo" TEXT,
  ADD COLUMN IF NOT EXISTS "organization_id" UUID;

ALTER TABLE "pravia_os"."tipos_acto"
  ADD CONSTRAINT "tipos_acto_owner_org_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "idx_tipos_acto_owner_org"
  ON "pravia_os"."tipos_acto" ("organization_id");

CREATE UNIQUE INDEX IF NOT EXISTS "tipos_acto_codigo_catalogo_key"
  ON "pravia_os"."tipos_acto" ("codigo_catalogo");

ALTER TABLE "pravia_os"."prospecto_servicios_catalogo"
  ADD COLUMN IF NOT EXISTS "tipo_acto_id" UUID;

-- Reuse an exact existing identity where possible, then materialize only missing
-- canonical identities from the already-approved 38-row service catalog.
UPDATE "pravia_os"."tipos_acto" AS t
SET "codigo_catalogo" = p."codigo"
FROM "pravia_os"."prospecto_servicios_catalogo" AS p
WHERE t."codigo_catalogo" IS NULL
  AND lower(trim(t."nombre")) = lower(trim(p."label"))
  AND NOT EXISTS (
    SELECT 1 FROM "pravia_os"."tipos_acto" AS used
    WHERE used."codigo_catalogo" = p."codigo"
  );

INSERT INTO "pravia_os"."tipos_acto"
  ("id", "codigo_catalogo", "nombre", "descripcion", "activo", "created_at", "updated_at")
SELECT gen_random_uuid(), p."codigo", p."label", NULL, p."activo", now(), now()
FROM "pravia_os"."prospecto_servicios_catalogo" AS p
WHERE NOT EXISTS (
  SELECT 1 FROM "pravia_os"."tipos_acto" AS t
  WHERE t."codigo_catalogo" = p."codigo"
);

UPDATE "pravia_os"."prospecto_servicios_catalogo" AS p
SET "tipo_acto_id" = t."id"
FROM "pravia_os"."tipos_acto" AS t
WHERE t."codigo_catalogo" = p."codigo";

ALTER TABLE "pravia_os"."prospecto_servicios_catalogo"
  ALTER COLUMN "tipo_acto_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_prospecto_servicios_tipo_acto_fk"
  ON "pravia_os"."prospecto_servicios_catalogo" ("tipo_acto_id");

ALTER TABLE "pravia_os"."prospecto_servicios_catalogo"
  ADD CONSTRAINT "prospecto_servicios_catalogo_tipo_acto_id_fkey"
  FOREIGN KEY ("tipo_acto_id") REFERENCES "pravia_os"."tipos_acto"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "pravia_os"."ConfiguracionTipoDias" AS ENUM ('HABILES', 'NATURALES');
CREATE TYPE "pravia_os"."ConfiguracionSelectorExcepcion" AS ENUM ('INSTITUCION', 'NOTARIA', 'JURISDICCION');
CREATE TYPE "pravia_os"."CatalogoInstitucionTipo" AS ENUM ('BANCO', 'FIDUCIARIA', 'OTRA');
CREATE TYPE "pravia_os"."CatalogoPropietarioTipo" AS ENUM ('NOTARIA', 'INSTITUCION');
CREATE TYPE "pravia_os"."CatalogoArtefactoTipo" AS ENUM ('PLANTILLA', 'FORMATO');
CREATE TYPE "pravia_os"."CatalogoMultiplicidad" AS ENUM ('EXPEDIENTE', 'COMPARECIENTE', 'INMUEBLE', 'CANTIDAD_FIJA');

-- Existing tenant-owned notarías remain the canonical owner catalog. The
-- composite key enables database-level rejection of cross-tenant references.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notarias_id_org"
  ON "pravia_os"."notarias" ("id", "organization_id");

CREATE TABLE "pravia_os"."configuracion_actos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "tipo_acto_id" UUID NOT NULL,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "requiere_revision" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "nombre_personalizado" TEXT,
  "descripcion_personalizada" TEXT,
  "creado_por_id" UUID NOT NULL,
  "actualizado_por_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "configuracion_actos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_config_actos_owner" CHECK ("organization_id" IS NOT NULL),
  CONSTRAINT "ck_config_actos_revision" CHECK ("revision" >= 1),
  CONSTRAINT "uq_config_acto_org_tipo" UNIQUE ("organization_id", "tipo_acto_id"),
  CONSTRAINT "uq_config_actos_id_org" UNIQUE ("id", "organization_id"),
  CONSTRAINT "config_actos_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "config_actos_tipo_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "pravia_os"."tipos_acto"("id") ON DELETE RESTRICT,
  CONSTRAINT "config_actos_creador_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "config_actos_actualizador_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT
);
CREATE INDEX "idx_config_actos_tipo_acto_fk" ON "pravia_os"."configuracion_actos"("tipo_acto_id");

-- Canonical acts are global when organization_id is NULL. Tenant-owned custom
-- acts may only be configured or referenced by their owning organization.
CREATE OR REPLACE FUNCTION "pravia_os"."enforce_tipo_acto_tenant_scope"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE act_owner UUID;
BEGIN
  SELECT "organization_id" INTO act_owner
  FROM "pravia_os"."tipos_acto"
  WHERE "id" = NEW."tipo_acto_id";

  IF act_owner IS NOT NULL AND act_owner <> NEW."organization_id" THEN
    RAISE EXCEPTION 'tenant-owned act cannot be referenced by another organization';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "configuracion_actos_tipo_scope"
BEFORE INSERT OR UPDATE OF "tipo_acto_id", "organization_id" ON "pravia_os"."configuracion_actos"
FOR EACH ROW EXECUTE FUNCTION "pravia_os"."enforce_tipo_acto_tenant_scope"();

CREATE TABLE "pravia_os"."configuracion_etapas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "configuracion_id" UUID NOT NULL,
  "nombre" TEXT NOT NULL,
  "orden" INTEGER NOT NULL,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "configuracion_etapas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_config_etapas_orden" UNIQUE ("configuracion_id", "orden"),
  CONSTRAINT "uq_config_etapas_id_org" UNIQUE ("id", "organization_id"),
  CONSTRAINT "ck_config_etapa_nombre" CHECK (length(trim("nombre")) > 0),
  CONSTRAINT "ck_config_etapa_orden" CHECK ("orden" > 0),
  CONSTRAINT "config_etapas_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "config_etapas_parent_tenant_fkey" FOREIGN KEY ("configuracion_id", "organization_id") REFERENCES "pravia_os"."configuracion_actos"("id", "organization_id") ON DELETE CASCADE
);
CREATE INDEX "idx_config_etapas_tenant_parent" ON "pravia_os"."configuracion_etapas"("organization_id", "configuracion_id");

CREATE TABLE "pravia_os"."configuracion_actividades" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "etapa_id" UUID NOT NULL,
  "nombre" TEXT NOT NULL,
  "descripcion" TEXT,
  "duracion_estimada" INTEGER NOT NULL,
  "tipo_dias" "pravia_os"."ConfiguracionTipoDias" NOT NULL,
  "margen_seguridad" INTEGER NOT NULL DEFAULT 0,
  "responsable_rol" "pravia_os"."Role",
  "responsable_usuario_id" UUID,
  "aplica_por_defecto" BOOLEAN NOT NULL DEFAULT true,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "configuracion_actividades_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_config_actividades_id_org" UNIQUE ("id", "organization_id"),
  CONSTRAINT "ck_config_actividad_nombre" CHECK (length(trim("nombre")) > 0),
  CONSTRAINT "ck_config_actividad_duracion" CHECK ("duracion_estimada" >= 0),
  CONSTRAINT "ck_config_actividad_margen" CHECK ("margen_seguridad" >= 0),
  CONSTRAINT "ck_config_actividad_responsable" CHECK (NOT ("responsable_rol" IS NOT NULL AND "responsable_usuario_id" IS NOT NULL)),
  CONSTRAINT "config_actividades_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "config_actividades_etapa_tenant_fkey" FOREIGN KEY ("etapa_id", "organization_id") REFERENCES "pravia_os"."configuracion_etapas"("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "config_actividades_usuario_fkey" FOREIGN KEY ("responsable_usuario_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT
);
CREATE INDEX "idx_config_actividades_tenant_etapa" ON "pravia_os"."configuracion_actividades"("organization_id", "etapa_id");

CREATE TABLE "pravia_os"."configuracion_dependencias" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "actividad_id" UUID NOT NULL,
  "depende_actividad_id" UUID NOT NULL,
  "bloqueante" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "configuracion_dependencias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_config_dependencia" UNIQUE ("actividad_id", "depende_actividad_id"),
  CONSTRAINT "ck_config_dependencia_self" CHECK ("actividad_id" <> "depende_actividad_id"),
  CONSTRAINT "config_dependencias_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "config_dependencias_actividad_tenant_fkey" FOREIGN KEY ("actividad_id", "organization_id") REFERENCES "pravia_os"."configuracion_actividades"("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "config_dependencias_prereq_tenant_fkey" FOREIGN KEY ("depende_actividad_id", "organization_id") REFERENCES "pravia_os"."configuracion_actividades"("id", "organization_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_config_dependencias_tenant_actividad" ON "pravia_os"."configuracion_dependencias"("organization_id", "actividad_id");
CREATE INDEX "idx_config_dependencias_prerequisito_fk" ON "pravia_os"."configuracion_dependencias"("depende_actividad_id");

CREATE TABLE "pravia_os"."catalogo_instituciones" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "nombre" TEXT NOT NULL,
  "tipo" "pravia_os"."CatalogoInstitucionTipo" NOT NULL,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalogo_instituciones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_catalogo_institucion_org_nombre" UNIQUE ("organization_id", "nombre"),
  CONSTRAINT "uq_catalogo_instituciones_id_org" UNIQUE ("id", "organization_id"),
  CONSTRAINT "ck_catalogo_institucion_nombre" CHECK (length(trim("nombre")) > 0),
  CONSTRAINT "catalogo_instituciones_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT
);
CREATE INDEX "idx_catalogo_instituciones_org_tipo" ON "pravia_os"."catalogo_instituciones"("organization_id", "tipo", "activa");

CREATE TABLE "pravia_os"."configuracion_excepciones" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "actividad_id" UUID NOT NULL,
  "selector_tipo" "pravia_os"."ConfiguracionSelectorExcepcion" NOT NULL,
  "institucion_id" UUID,
  "notaria_id" UUID,
  "jurisdiccion" TEXT,
  "duracion" INTEGER NOT NULL,
  "tipo_dias" "pravia_os"."ConfiguracionTipoDias" NOT NULL,
  "margen_seguridad" INTEGER NOT NULL DEFAULT 0,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "configuracion_excepciones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_config_excepciones_id_org" UNIQUE ("id", "organization_id"),
  CONSTRAINT "ck_config_excepcion_duracion" CHECK ("duracion" >= 0),
  CONSTRAINT "ck_config_excepcion_margen" CHECK ("margen_seguridad" >= 0),
  CONSTRAINT "ck_config_excepcion_selector" CHECK (
    ("selector_tipo" = 'INSTITUCION' AND "institucion_id" IS NOT NULL AND "notaria_id" IS NULL AND "jurisdiccion" IS NULL) OR
    ("selector_tipo" = 'NOTARIA' AND "institucion_id" IS NULL AND "notaria_id" IS NOT NULL AND "jurisdiccion" IS NULL) OR
    ("selector_tipo" = 'JURISDICCION' AND "institucion_id" IS NULL AND "notaria_id" IS NULL AND length(trim("jurisdiccion")) > 0)
  ),
  CONSTRAINT "config_excepciones_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "config_excepciones_actividad_tenant_fkey" FOREIGN KEY ("actividad_id", "organization_id") REFERENCES "pravia_os"."configuracion_actividades"("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "config_excepciones_institucion_tenant_fkey" FOREIGN KEY ("institucion_id", "organization_id") REFERENCES "pravia_os"."catalogo_instituciones"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "config_excepciones_notaria_tenant_fkey" FOREIGN KEY ("notaria_id", "organization_id") REFERENCES "pravia_os"."notarias"("id", "organization_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_config_excepciones_tenant_actividad" ON "pravia_os"."configuracion_excepciones"("organization_id", "actividad_id");
CREATE INDEX "idx_config_excepciones_institucion_fk" ON "pravia_os"."configuracion_excepciones"("institucion_id");
CREATE INDEX "idx_config_excepciones_notaria_fk" ON "pravia_os"."configuracion_excepciones"("notaria_id");
CREATE UNIQUE INDEX "uq_config_excepcion_institucion" ON "pravia_os"."configuracion_excepciones"("organization_id", "actividad_id", "institucion_id") WHERE "institucion_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_config_excepcion_notaria" ON "pravia_os"."configuracion_excepciones"("organization_id", "actividad_id", "notaria_id") WHERE "notaria_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_config_excepcion_jurisdiccion" ON "pravia_os"."configuracion_excepciones"("organization_id", "actividad_id", lower("jurisdiccion")) WHERE "jurisdiccion" IS NOT NULL;

CREATE TABLE "pravia_os"."configuracion_excepcion_dependencias" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "excepcion_id" UUID NOT NULL,
  "depende_actividad_id" UUID NOT NULL,
  "bloqueante" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "configuracion_excepcion_dependencias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_config_excepcion_dependencia" UNIQUE ("excepcion_id", "depende_actividad_id"),
  CONSTRAINT "config_excepcion_deps_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "config_excepcion_deps_exception_tenant_fkey" FOREIGN KEY ("excepcion_id", "organization_id") REFERENCES "pravia_os"."configuracion_excepciones"("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "config_excepcion_deps_activity_tenant_fkey" FOREIGN KEY ("depende_actividad_id", "organization_id") REFERENCES "pravia_os"."configuracion_actividades"("id", "organization_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_config_excepcion_deps_tenant" ON "pravia_os"."configuracion_excepcion_dependencias"("organization_id", "excepcion_id");
CREATE INDEX "idx_config_excepcion_deps_prerequisito_fk" ON "pravia_os"."configuracion_excepcion_dependencias"("depende_actividad_id");

CREATE TABLE "pravia_os"."catalogo_carpetas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "propietario_tipo" "pravia_os"."CatalogoPropietarioTipo" NOT NULL,
  "tipo" "pravia_os"."CatalogoArtefactoTipo" NOT NULL,
  "notaria_id" UUID,
  "institucion_id" UUID,
  "parent_id" UUID,
  "nombre" TEXT NOT NULL,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalogo_carpetas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_catalogo_carpetas_id_org" UNIQUE ("id", "organization_id"),
  CONSTRAINT "ck_catalogo_carpeta_nombre" CHECK (length(trim("nombre")) > 0),
  CONSTRAINT "ck_catalogo_carpeta_owner" CHECK (
    ("propietario_tipo" = 'NOTARIA' AND "notaria_id" IS NOT NULL AND "institucion_id" IS NULL) OR
    ("propietario_tipo" = 'INSTITUCION' AND "tipo" = 'FORMATO' AND "notaria_id" IS NULL AND "institucion_id" IS NOT NULL)
  ),
  CONSTRAINT "catalogo_carpetas_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "catalogo_carpetas_parent_tenant_fkey" FOREIGN KEY ("parent_id", "organization_id") REFERENCES "pravia_os"."catalogo_carpetas"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "catalogo_carpetas_notaria_tenant_fkey" FOREIGN KEY ("notaria_id", "organization_id") REFERENCES "pravia_os"."notarias"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "catalogo_carpetas_institucion_tenant_fkey" FOREIGN KEY ("institucion_id", "organization_id") REFERENCES "pravia_os"."catalogo_instituciones"("id", "organization_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_catalogo_carpetas_explorer" ON "pravia_os"."catalogo_carpetas"("organization_id", "propietario_tipo", "tipo", "notaria_id", "institucion_id", "parent_id");
CREATE UNIQUE INDEX "uq_catalogo_carpetas_notaria_sibling" ON "pravia_os"."catalogo_carpetas"("organization_id", "notaria_id", "tipo", COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("nombre")) WHERE "notaria_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_catalogo_carpetas_institucion_sibling" ON "pravia_os"."catalogo_carpetas"("organization_id", "institucion_id", "tipo", COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("nombre")) WHERE "institucion_id" IS NOT NULL;

CREATE OR REPLACE FUNCTION "pravia_os"."prevent_catalog_folder_cycle"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE creates_cycle BOOLEAN;
BEGIN
  IF NEW."parent_id" IS NULL THEN RETURN NEW; END IF;
  IF NEW."parent_id" = NEW."id" THEN
    RAISE EXCEPTION 'catalog folder cannot be its own parent';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "pravia_os"."catalogo_carpetas" p
    WHERE p."id" = NEW."parent_id"
      AND p."organization_id" = NEW."organization_id"
      AND p."tipo" = NEW."tipo"
      AND p."propietario_tipo" = NEW."propietario_tipo"
      AND p."notaria_id" IS NOT DISTINCT FROM NEW."notaria_id"
      AND p."institucion_id" IS NOT DISTINCT FROM NEW."institucion_id"
      AND p."activa" = true
  ) THEN
    RAISE EXCEPTION 'catalog folder parent scope mismatch';
  END IF;
  WITH RECURSIVE ancestors AS (
    SELECT c."id", c."parent_id"
    FROM "pravia_os"."catalogo_carpetas" c
    WHERE c."id" = NEW."parent_id" AND c."organization_id" = NEW."organization_id"
    UNION ALL
    SELECT c."id", c."parent_id"
    FROM "pravia_os"."catalogo_carpetas" c
    JOIN ancestors a ON c."id" = a."parent_id"
    WHERE c."organization_id" = NEW."organization_id"
  )
  SELECT EXISTS (SELECT 1 FROM ancestors WHERE "id" = NEW."id") INTO creates_cycle;
  IF creates_cycle THEN RAISE EXCEPTION 'catalog folder hierarchy cycle'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "catalogo_carpetas_no_cycles"
BEFORE INSERT OR UPDATE OF "parent_id", "organization_id", "tipo", "propietario_tipo", "notaria_id", "institucion_id" ON "pravia_os"."catalogo_carpetas"
FOR EACH ROW EXECUTE FUNCTION "pravia_os"."prevent_catalog_folder_cycle"();

CREATE TABLE "pravia_os"."catalogo_artefactos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "tipo" "pravia_os"."CatalogoArtefactoTipo" NOT NULL,
  "propietario_tipo" "pravia_os"."CatalogoPropietarioTipo" NOT NULL,
  "notaria_id" UUID,
  "institucion_id" UUID,
  "carpeta_id" UUID,
  "nombre" TEXT NOT NULL,
  "descripcion" TEXT,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "creado_por_id" UUID NOT NULL,
  "actualizado_por_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalogo_artefactos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_catalogo_artefactos_id_org" UNIQUE ("id", "organization_id"),
  CONSTRAINT "ck_catalogo_artefacto_nombre" CHECK (length(trim("nombre")) > 0),
  CONSTRAINT "ck_catalogo_artefacto_owner" CHECK (
    ("tipo" = 'PLANTILLA' AND "propietario_tipo" = 'NOTARIA' AND "notaria_id" IS NOT NULL AND "institucion_id" IS NULL) OR
    ("tipo" = 'FORMATO' AND "propietario_tipo" = 'NOTARIA' AND "notaria_id" IS NOT NULL AND "institucion_id" IS NULL) OR
    ("tipo" = 'FORMATO' AND "propietario_tipo" = 'INSTITUCION' AND "notaria_id" IS NULL AND "institucion_id" IS NOT NULL)
  ),
  CONSTRAINT "catalogo_artefactos_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "catalogo_artefactos_carpeta_tenant_fkey" FOREIGN KEY ("carpeta_id", "organization_id") REFERENCES "pravia_os"."catalogo_carpetas"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "catalogo_artefactos_notaria_tenant_fkey" FOREIGN KEY ("notaria_id", "organization_id") REFERENCES "pravia_os"."notarias"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "catalogo_artefactos_institucion_tenant_fkey" FOREIGN KEY ("institucion_id", "organization_id") REFERENCES "pravia_os"."catalogo_instituciones"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "catalogo_artefactos_creador_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "catalogo_artefactos_actualizador_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT
);
CREATE INDEX "idx_catalogo_artefactos_explorer" ON "pravia_os"."catalogo_artefactos"("organization_id", "propietario_tipo", "notaria_id", "institucion_id", "carpeta_id");

CREATE OR REPLACE FUNCTION "pravia_os"."enforce_catalog_artifact_folder_scope"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."carpeta_id" IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "pravia_os"."catalogo_carpetas" f
    WHERE f."id" = NEW."carpeta_id"
      AND f."organization_id" = NEW."organization_id"
      AND f."tipo" = NEW."tipo"
      AND f."propietario_tipo" = NEW."propietario_tipo"
      AND f."notaria_id" IS NOT DISTINCT FROM NEW."notaria_id"
      AND f."institucion_id" IS NOT DISTINCT FROM NEW."institucion_id"
      AND f."activa" = true
  ) THEN
    RAISE EXCEPTION 'catalog artifact folder scope mismatch';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "catalogo_artefactos_folder_scope"
BEFORE INSERT OR UPDATE OF "carpeta_id", "organization_id", "tipo", "propietario_tipo", "notaria_id", "institucion_id" ON "pravia_os"."catalogo_artefactos"
FOR EACH ROW EXECUTE FUNCTION "pravia_os"."enforce_catalog_artifact_folder_scope"();

CREATE TABLE "pravia_os"."catalogo_artefacto_versiones" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "artefacto_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "nombre_original" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "checksum_sha256" TEXT NOT NULL,
  "origen" TEXT NOT NULL,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "creado_por_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalogo_artefacto_versiones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_catalogo_artefacto_version" UNIQUE ("artefacto_id", "version"),
  CONSTRAINT "uq_catalogo_storage_key_org" UNIQUE ("organization_id", "storage_key"),
  CONSTRAINT "ck_catalogo_version_num" CHECK ("version" > 0),
  CONSTRAINT "ck_catalogo_version_size" CHECK ("size_bytes" >= 0),
  CONSTRAINT "catalogo_versiones_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "catalogo_versiones_artefacto_tenant_fkey" FOREIGN KEY ("artefacto_id", "organization_id") REFERENCES "pravia_os"."catalogo_artefactos"("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "catalogo_versiones_creador_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT
);
CREATE INDEX "idx_catalogo_versiones_tenant_artefacto" ON "pravia_os"."catalogo_artefacto_versiones"("organization_id", "artefacto_id");

CREATE TABLE "pravia_os"."catalogo_artefacto_actos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "artefacto_id" UUID NOT NULL,
  "tipo_acto_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalogo_artefacto_actos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_catalogo_artefacto_acto" UNIQUE ("artefacto_id", "tipo_acto_id"),
  CONSTRAINT "catalogo_artefacto_actos_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "catalogo_artefacto_actos_parent_tenant_fkey" FOREIGN KEY ("artefacto_id", "organization_id") REFERENCES "pravia_os"."catalogo_artefactos"("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "catalogo_artefacto_actos_tipo_fkey" FOREIGN KEY ("tipo_acto_id") REFERENCES "pravia_os"."tipos_acto"("id") ON DELETE RESTRICT
);
CREATE INDEX "idx_catalogo_artefacto_actos_tipo_fk" ON "pravia_os"."catalogo_artefacto_actos"("tipo_acto_id");
CREATE INDEX "idx_catalogo_artefacto_actos_tenant" ON "pravia_os"."catalogo_artefacto_actos"("organization_id", "artefacto_id");

CREATE TRIGGER "catalogo_artefacto_actos_tipo_scope"
BEFORE INSERT OR UPDATE OF "tipo_acto_id", "organization_id" ON "pravia_os"."catalogo_artefacto_actos"
FOR EACH ROW EXECUTE FUNCTION "pravia_os"."enforce_tipo_acto_tenant_scope"();

CREATE TABLE "pravia_os"."catalogo_artefacto_reglas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "artefacto_id" UUID NOT NULL,
  "tipo_persona" "pravia_os"."TipoPersona",
  "caracter_compareciente_id" UUID,
  "etapa_requerida_id" UUID,
  "momento_limite_etapa_id" UUID,
  "obligatoria" BOOLEAN NOT NULL DEFAULT false,
  "multiplicidad" "pravia_os"."CatalogoMultiplicidad" NOT NULL DEFAULT 'EXPEDIENTE',
  "cantidad_fija" INTEGER,
  "condiciones_json" JSONB,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalogo_artefacto_reglas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_catalogo_regla_multiplicidad" CHECK (
    ("multiplicidad" = 'CANTIDAD_FIJA' AND "cantidad_fija" IS NOT NULL AND "cantidad_fija" > 0) OR
    ("multiplicidad" <> 'CANTIDAD_FIJA' AND "cantidad_fija" IS NULL)
  ),
  CONSTRAINT "catalogo_reglas_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "catalogo_reglas_artefacto_tenant_fkey" FOREIGN KEY ("artefacto_id", "organization_id") REFERENCES "pravia_os"."catalogo_artefactos"("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "catalogo_reglas_caracter_fkey" FOREIGN KEY ("caracter_compareciente_id") REFERENCES "pravia_os"."caracteres_compareciente"("id") ON DELETE RESTRICT,
  CONSTRAINT "catalogo_reglas_etapa_tenant_fkey" FOREIGN KEY ("etapa_requerida_id", "organization_id") REFERENCES "pravia_os"."configuracion_etapas"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "catalogo_reglas_limite_tenant_fkey" FOREIGN KEY ("momento_limite_etapa_id", "organization_id") REFERENCES "pravia_os"."configuracion_etapas"("id", "organization_id") ON DELETE RESTRICT
);
CREATE INDEX "idx_catalogo_reglas_tenant_artefacto" ON "pravia_os"."catalogo_artefacto_reglas"("organization_id", "artefacto_id");
CREATE INDEX "idx_catalogo_reglas_caracter_fk" ON "pravia_os"."catalogo_artefacto_reglas"("caracter_compareciente_id");
CREATE INDEX "idx_catalogo_reglas_etapa_fk" ON "pravia_os"."catalogo_artefacto_reglas"("etapa_requerida_id");
CREATE INDEX "idx_catalogo_reglas_limite_fk" ON "pravia_os"."catalogo_artefacto_reglas"("momento_limite_etapa_id");
