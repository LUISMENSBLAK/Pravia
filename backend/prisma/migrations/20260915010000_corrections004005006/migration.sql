-- Correcciones post-implementación 004 + 005 + 006.
-- Migración aditiva: no elimina maestros, documentos, vínculos ni snapshots.

SET search_path TO pravia_os, public;

-- Corrección 004: el acto canónico heredado desde Cotización debe disponer
-- del catálogo mínimo ya existente para vincular comparecientes. Los mismos
-- roles permanecen relaciones configuradas; no se crean personas ni vínculos.
INSERT INTO "tipo_acto_caracteres_compareciente" ("tipo_acto_id", "caracter_id", "sugerido", "orden")
SELECT t."id", c."id", true, mapping."orden"
FROM (VALUES
  ('COMPRAVENTA', 'PARTE_VENDEDORA', 0),
  ('COMPRAVENTA', 'PARTE_COMPRADORA', 1),
  ('CANCELACION_HIPOTECA', 'ACREEDOR_HIPOTECARIO', 0),
  ('CANCELACION_HIPOTECA', 'DEUDOR_HIPOTECARIO', 1)
) AS mapping("tipo_codigo", "caracter_clave", "orden")
JOIN "tipos_acto" t ON t."codigo_catalogo" = mapping."tipo_codigo"
JOIN "caracteres_compareciente" c ON c."clave" = mapping."caracter_clave"
ON CONFLICT ("tipo_acto_id", "caracter_id") DO UPDATE
SET "sugerido" = EXCLUDED."sugerido", "orden" = EXCLUDED."orden";

CREATE TYPE "PredioDocumentoVigencia" AS ENUM ('VIGENTE', 'HISTORICO');

ALTER TABLE "predio_documentos"
  ADD COLUMN "vigencia" "PredioDocumentoVigencia" NOT NULL DEFAULT 'VIGENTE',
  ADD COLUMN "es_antecedente_principal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "origen" VARCHAR(60) NOT NULL DEFAULT 'CARGA_DIRECTA',
  ADD COLUMN "source_expediente_documento_id" UUID,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "ck_predio_documento_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "predio_documentos_source_exp_documento_fkey"
    FOREIGN KEY ("source_expediente_documento_id") REFERENCES "expediente_documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_predio_documentos_org_predio_vigencia"
  ON "predio_documentos"("organization_id", "predio_id", "vigencia");
CREATE INDEX "idx_predio_documentos_source_exp_documento"
  ON "predio_documentos"("source_expediente_documento_id");
CREATE UNIQUE INDEX "uq_predio_antecedente_principal_active"
  ON "predio_documentos"("organization_id", "predio_id")
  WHERE "estatus" = 'ACTIVO' AND "vigencia" = 'VIGENTE' AND "es_antecedente_principal" = true;

ALTER TABLE "predio_datos_fuente"
  ADD COLUMN "source_document_ids" JSONB;

CREATE TABLE "expediente_documento_carpetas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "parent_id" UUID,
  "nombre" VARCHAR(180) NOT NULL,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMP(3),
  CONSTRAINT "expediente_documento_carpetas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_exp_document_folder_tenant" UNIQUE ("id", "organization_id", "expediente_id"),
  CONSTRAINT "ck_exp_document_folder_name" CHECK (length(btrim("nombre")) > 0 AND "nombre" NOT IN ('.', '..')),
  CONSTRAINT "ck_exp_document_folder_not_self" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  CONSTRAINT "exp_document_folder_expediente_tenant_fkey" FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "expedientes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "exp_document_folder_parent_tenant_fkey" FOREIGN KEY ("parent_id", "organization_id", "expediente_id") REFERENCES "expediente_documento_carpetas"("id", "organization_id", "expediente_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "exp_document_folder_actor_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_exp_document_folder_sibling"
  ON "expediente_documento_carpetas"("organization_id", "expediente_id", "parent_id", "nombre") WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "uq_exp_document_folder_root"
  ON "expediente_documento_carpetas"("organization_id", "expediente_id", "nombre") WHERE "parent_id" IS NULL AND "archived_at" IS NULL;
CREATE INDEX "idx_exp_document_folder_tree"
  ON "expediente_documento_carpetas"("organization_id", "expediente_id", "parent_id", "archived_at");
CREATE INDEX "idx_exp_document_folder_actor"
  ON "expediente_documento_carpetas"("created_by_id");

ALTER TABLE "expediente_documentos"
  ADD COLUMN "carpeta_id" UUID,
  ADD COLUMN "nombre_visual" VARCHAR(500),
  ADD COLUMN "moved_at" TIMESTAMP(3),
  ADD COLUMN "moved_by_id" UUID,
  ADD CONSTRAINT "expediente_documentos_carpeta_tenant_fkey" FOREIGN KEY ("carpeta_id", "organization_id", "expediente_id") REFERENCES "expediente_documento_carpetas"("id", "organization_id", "expediente_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "expediente_documentos_moved_by_id_fkey" FOREIGN KEY ("moved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_exp_documentos_folder"
  ON "expediente_documentos"("organization_id", "expediente_id", "carpeta_id");
CREATE INDEX "idx_exp_documentos_moved_by"
  ON "expediente_documentos"("moved_by_id");

ALTER TABLE "expediente_documento_snapshot_items"
  ADD COLUMN "folder_path_snapshot" VARCHAR(1200);

-- Defensa tenant para el árbol y sus actores. La ubicación visual nunca cambia
-- la provenance técnica almacenada en expediente_documentos.
CREATE TRIGGER "trg_exp006_folder_expediente_tenant"
BEFORE INSERT OR UPDATE ON "expediente_documento_carpetas"
FOR EACH ROW EXECUTE FUNCTION enforce_same_organization('expedientes','expediente_id');

CREATE TRIGGER "trg_exp006_folder_parent_tenant"
BEFORE INSERT OR UPDATE ON "expediente_documento_carpetas"
FOR EACH ROW EXECUTE FUNCTION enforce_same_organization('expediente_documento_carpetas','parent_id');

CREATE TRIGGER "trg_exp006_folder_actor_membership"
BEFORE INSERT OR UPDATE ON pravia_os.expediente_documento_carpetas
FOR EACH ROW EXECUTE FUNCTION enforce_organization_membership('created_by_id');

CREATE TRIGGER "trg_exp006_document_folder_tenant"
BEFORE INSERT OR UPDATE ON "expediente_documentos"
FOR EACH ROW EXECUTE FUNCTION enforce_same_organization('expediente_documento_carpetas','carpeta_id');

CREATE TRIGGER "trg_exp006_document_mover_membership"
BEFORE INSERT OR UPDATE ON pravia_os.expediente_documentos
FOR EACH ROW EXECUTE FUNCTION enforce_organization_membership('moved_by_id');

CREATE TRIGGER "trg_prd001_document_source_tenant"
BEFORE INSERT OR UPDATE ON "predio_documentos"
FOR EACH ROW EXECUTE FUNCTION enforce_same_organization('expediente_documentos','source_expediente_documento_id');

-- No se crean carpetas ni importaciones históricas ficticias. Los vínculos
-- existentes conservan sus IDs y blobs; la importación controlada comienza
-- sólo con una acción explícita posterior a esta migración.
