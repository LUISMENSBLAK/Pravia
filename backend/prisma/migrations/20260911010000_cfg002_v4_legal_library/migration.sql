-- CFG-002 v4.0 LEGAL: exact standard library provenance, versioned legal
-- applicability and immutable EXP-006 lineage. This migration is additive;
-- existing catalog and expediente data are preserved.

ALTER TABLE "catalogo_carpetas"
  ADD COLUMN "codigo_biblioteca" VARCHAR(180),
  ADD COLUMN "ruta_biblioteca" VARCHAR(700);

ALTER TABLE "catalogo_artefactos"
  ADD COLUMN "codigo_biblioteca" VARCHAR(120),
  ADD COLUMN "ruta_biblioteca" VARCHAR(700),
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

-- Composite identity used by every new tenant-owned relationship. The
-- primary key already guarantees id uniqueness; this additional key lets the
-- database reject cross-organization references atomically.
CREATE UNIQUE INDEX "uq_catalogo_artefactos_id_org" ON "catalogo_artefactos"("id", "organization_id");

ALTER TABLE "catalogo_artefacto_versiones"
  ADD COLUMN "version_biblioteca" VARCHAR(80);

ALTER TABLE "catalogo_artefacto_reglas"
  ADD COLUMN "codigo_regla" VARCHAR(160),
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "normativa_revision_id" UUID;

CREATE TABLE "catalogo_normativa_revisiones" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "artefacto_id" UUID NOT NULL,
  "codigo_revision" VARCHAR(160) NOT NULL,
  "revision" INTEGER NOT NULL,
  "fundamento_normativo" TEXT NOT NULL,
  "version_normativa" VARCHAR(160) NOT NULL,
  "tipo_cliente" VARCHAR(80),
  "nacionalidad_condicion" VARCHAR(200),
  "regimen_simplificado" BOOLEAN,
  "actividad_vulnerable" BOOLEAN,
  "requiere_bc" BOOLEAN NOT NULL DEFAULT false,
  "requiere_riesgo" BOOLEAN NOT NULL DEFAULT false,
  "requiere_pep" BOOLEAN NOT NULL DEFAULT false,
  "requiere_perfil" BOOLEAN NOT NULL DEFAULT false,
  "requiere_alto_riesgo" BOOLEAN NOT NULL DEFAULT false,
  "vigencia_desde" TIMESTAMP(3),
  "condiciones_json" JSONB,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "creado_por_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalogo_normativa_revisiones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalogo_normativa_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "catalogo_normativa_creator_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "catalogo_normativa_artefacto_org_fkey" FOREIGN KEY ("artefacto_id", "organization_id") REFERENCES "catalogo_artefactos"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "catalogo_biblioteca_importaciones" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "codigo_biblioteca" VARCHAR(120) NOT NULL,
  "version_biblioteca" VARCHAR(80) NOT NULL,
  "source_checksum" VARCHAR(64) NOT NULL,
  "estado" VARCHAR(32) NOT NULL,
  "resultado_json" JSONB,
  "creado_por_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "catalogo_biblioteca_importaciones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalogo_import_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "catalogo_import_creator_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TRIGGER "trg_catalogo_normativa_creator_membership"
BEFORE INSERT OR UPDATE ON pravia_os.catalogo_normativa_revisiones
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership('creado_por_id');

CREATE TRIGGER "trg_catalogo_import_creator_membership"
BEFORE INSERT OR UPDATE ON pravia_os.catalogo_biblioteca_importaciones
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership('creado_por_id');

ALTER TABLE "expediente_artefactos_pendientes"
  ADD COLUMN "normativa_revision_id" UUID,
  ADD COLUMN "hechos_evaluados_snapshot" JSONB,
  ADD COLUMN "condiciones_pendientes_snapshot" JSONB;

CREATE UNIQUE INDEX "uq_catalogo_normativa_id_org" ON "catalogo_normativa_revisiones"("id", "organization_id");

ALTER TABLE "catalogo_artefacto_reglas"
  ADD CONSTRAINT "catalogo_regla_normativa_org_fkey" FOREIGN KEY ("normativa_revision_id", "organization_id") REFERENCES "catalogo_normativa_revisiones"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expediente_artefactos_pendientes"
  ADD CONSTRAINT "exp006_pending_normativa_org_fkey" FOREIGN KEY ("normativa_revision_id", "organization_id") REFERENCES "catalogo_normativa_revisiones"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE UNIQUE INDEX "uq_catalogo_carpetas_biblioteca" ON "catalogo_carpetas"("organization_id", "codigo_biblioteca");
CREATE UNIQUE INDEX "uq_catalogo_artefactos_biblioteca" ON "catalogo_artefactos"("organization_id", "codigo_biblioteca");
CREATE UNIQUE INDEX "uq_catalogo_regla_revision" ON "catalogo_artefacto_reglas"("artefacto_id", "codigo_regla", "revision");
CREATE INDEX "idx_catalogo_regla_normativa" ON "catalogo_artefacto_reglas"("normativa_revision_id", "organization_id");
CREATE UNIQUE INDEX "uq_catalogo_normativa_artefacto_revision" ON "catalogo_normativa_revisiones"("artefacto_id", "revision");
CREATE UNIQUE INDEX "uq_catalogo_normativa_codigo_revision" ON "catalogo_normativa_revisiones"("organization_id", "codigo_revision", "revision");
CREATE INDEX "idx_catalogo_normativa_vigencia" ON "catalogo_normativa_revisiones"("organization_id", "activa", "vigencia_desde");
CREATE INDEX "idx_catalogo_normativa_artefacto_org" ON "catalogo_normativa_revisiones"("artefacto_id", "organization_id");
CREATE INDEX "idx_catalogo_normativa_creador" ON "catalogo_normativa_revisiones"("creado_por_id");
CREATE UNIQUE INDEX "uq_catalogo_import_idempotency" ON "catalogo_biblioteca_importaciones"("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "uq_catalogo_import_release" ON "catalogo_biblioteca_importaciones"("organization_id", "codigo_biblioteca", "version_biblioteca", "source_checksum");
CREATE INDEX "idx_catalogo_import_org_created" ON "catalogo_biblioteca_importaciones"("organization_id", "created_at");
CREATE INDEX "idx_catalogo_import_creador" ON "catalogo_biblioteca_importaciones"("creado_por_id");
CREATE INDEX "idx_exp006_pending_normativa" ON "expediente_artefactos_pendientes"("normativa_revision_id", "organization_id");

ALTER TABLE "catalogo_normativa_revisiones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalogo_biblioteca_importaciones" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_catalogo_normativa_revisiones" ON "catalogo_normativa_revisiones"
USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

CREATE POLICY "tenant_isolation_catalogo_biblioteca_importaciones" ON "catalogo_biblioteca_importaciones"
USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- Existing rows remain valid historical configuration. No legal facts are
-- invented and no v4 applicability is backfilled without source evidence.
