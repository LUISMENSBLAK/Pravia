-- EXP-004: apéndice documental sincronizado y snapshot inmutable de firma.
-- La migración no copia blobs, no inventa snapshots históricos y no modifica
-- referencias legacy. Los expedientes existentes conservan exactamente su estado.

CREATE TYPE "pravia_os"."ExpedienteDocumentoOrigen" AS ENUM (
  'PROSPECTO', 'COTIZACION', 'COTIZACION_NOTARIA', 'COMPARECIENTE',
  'PREDIO', 'CFG002', 'ISR', 'FINANZAS', 'EXPEDIENTE'
);

ALTER TABLE "pravia_os"."documentos"
  ADD COLUMN "checksum_sha256" TEXT;

ALTER TABLE "pravia_os"."expediente_documentos"
  ADD COLUMN "origen" "pravia_os"."ExpedienteDocumentoOrigen" NOT NULL DEFAULT 'EXPEDIENTE',
  ADD COLUMN "source_entity_type" VARCHAR(80),
  ADD COLUMN "source_entity_id" UUID,
  ADD COLUMN "source_context" VARCHAR(160),
  ADD COLUMN "source_key" VARCHAR(320),
  ADD COLUMN "document_version" VARCHAR(128),
  ADD COLUMN "provenance" JSONB;

-- Backfill estrictamente determinístico: estos vínculos ya existían como cargas
-- del expediente. No se atribuye una fuente maestra que no esté demostrada.
UPDATE "pravia_os"."expediente_documentos" ed
SET "organization_id" = e."organization_id",
    "source_entity_type" = 'EXPEDIENTE',
    "source_entity_id" = ed."expediente_id",
    "source_context" = 'LEGACY_EXISTING_LINK',
    "source_key" = 'EXPEDIENTE:LEGACY_LINK:' || ed."id"::text,
    "document_version" = md5(concat_ws('|', d."id"::text, d."storage_key", d."size_bytes"::text, d."fecha_carga"::text)),
    "provenance" = jsonb_build_object('migration', 'EXP-004', 'classification', 'DETERMINISTIC_EXISTING_LINK')
FROM "pravia_os"."expedientes" e, "pravia_os"."documentos" d
WHERE ed."expediente_id" = e."id"
  AND ed."documento_id" = d."id"
  AND ed."source_key" IS NULL;

ALTER TABLE "pravia_os"."expediente_documentos"
  ALTER COLUMN "source_key" SET NOT NULL;

CREATE UNIQUE INDEX "uq_exp_documentos_source_key"
  ON "pravia_os"."expediente_documentos" ("organization_id", "expediente_id", "source_key");
CREATE INDEX "idx_exp_documentos_source_status"
  ON "pravia_os"."expediente_documentos" ("organization_id", "expediente_id", "origen", "estatus");

CREATE TABLE "pravia_os"."expediente_documento_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "expediente_version" INTEGER NOT NULL,
  "document_revision" VARCHAR(128) NOT NULL,
  "frozen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "frozen_by_id" UUID NOT NULL,
  "correlation_id" VARCHAR(128),
  "metadata" JSONB,
  CONSTRAINT "expediente_documento_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "exp_document_snapshot_expediente_fkey" FOREIGN KEY ("expediente_id")
    REFERENCES "pravia_os"."expedientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "exp_document_snapshot_actor_fkey" FOREIGN KEY ("frozen_by_id")
    REFERENCES "pravia_os"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "expediente_documento_snapshots_expediente_id_key"
  ON "pravia_os"."expediente_documento_snapshots" ("expediente_id");
CREATE UNIQUE INDEX "uq_exp_document_snapshot_id_org"
  ON "pravia_os"."expediente_documento_snapshots" ("id", "organization_id");
CREATE INDEX "idx_exp_document_snapshot_org_frozen"
  ON "pravia_os"."expediente_documento_snapshots" ("organization_id", "frozen_at");

CREATE TABLE "pravia_os"."expediente_documento_snapshot_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "expediente_documento_id" UUID,
  "documento_id" UUID,
  "source_key" VARCHAR(320) NOT NULL,
  "origen" "pravia_os"."ExpedienteDocumentoOrigen" NOT NULL,
  "source_entity_type" VARCHAR(80),
  "source_entity_id" UUID,
  "source_context" VARCHAR(160),
  "document_version" VARCHAR(128) NOT NULL,
  "nombre_snapshot" VARCHAR(500) NOT NULL,
  "tipo_snapshot" VARCHAR(180) NOT NULL,
  "categoria_snapshot" VARCHAR(80),
  "estado_snapshot" VARCHAR(80),
  "mime_type_snapshot" VARCHAR(180),
  "size_bytes_snapshot" INTEGER,
  "storage_key_snapshot" TEXT,
  "checksum_sha256_snapshot" TEXT,
  "file_availability_snapshot" VARCHAR(40) NOT NULL DEFAULT 'NO_VERIFICADO',
  "incorporated_at_snapshot" TIMESTAMP(3) NOT NULL,
  "provenance_snapshot" JSONB,
  "metadata_snapshot" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expediente_documento_snapshot_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "exp_document_snapshot_item_snapshot_fkey" FOREIGN KEY ("snapshot_id")
    REFERENCES "pravia_os"."expediente_documento_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "exp_document_snapshot_item_link_fkey" FOREIGN KEY ("expediente_documento_id")
    REFERENCES "pravia_os"."expediente_documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "exp_document_snapshot_item_document_fkey" FOREIGN KEY ("documento_id")
    REFERENCES "pravia_os"."documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_exp_document_snapshot_item_source"
  ON "pravia_os"."expediente_documento_snapshot_items" ("snapshot_id", "source_key");
CREATE INDEX "idx_exp_document_snapshot_items_org"
  ON "pravia_os"."expediente_documento_snapshot_items" ("organization_id", "snapshot_id");
CREATE INDEX "idx_exp_document_snapshot_items_document"
  ON "pravia_os"."expediente_documento_snapshot_items" ("documento_id");
CREATE INDEX "idx_exp_document_snapshot_items_link"
  ON "pravia_os"."expediente_documento_snapshot_items" ("expediente_documento_id");

-- Aislamiento tenant y actor: reutiliza las funciones de defensa en profundidad
-- creadas por la fundación multitenant; el backend no es la única barrera.
CREATE TRIGGER "trg_exp004_snapshot_expediente_tenant"
BEFORE INSERT OR UPDATE ON pravia_os.expediente_documento_snapshots
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('expedientes','expediente_id');

CREATE TRIGGER "trg_exp004_snapshot_actor_membership"
BEFORE INSERT OR UPDATE ON pravia_os.expediente_documento_snapshots
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership('frozen_by_id');

CREATE TRIGGER "trg_exp004_snapshot_item_snapshot_tenant"
BEFORE INSERT OR UPDATE ON pravia_os.expediente_documento_snapshot_items
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('expediente_documento_snapshots','snapshot_id');

CREATE TRIGGER "trg_exp004_snapshot_item_link_tenant"
BEFORE INSERT OR UPDATE ON pravia_os.expediente_documento_snapshot_items
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('expediente_documentos','expediente_documento_id');

CREATE TRIGGER "trg_exp004_snapshot_item_document_tenant"
BEFORE INSERT OR UPDATE ON pravia_os.expediente_documento_snapshot_items
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('documentos','documento_id');

-- Defensa en profundidad: el snapshot firmado no se reescribe ni elimina.
CREATE OR REPLACE FUNCTION "pravia_os"."prevent_exp004_snapshot_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'EXP004_SIGNED_SNAPSHOT_IMMUTABLE';
END;
$$;

CREATE TRIGGER "trg_exp004_snapshot_immutable"
BEFORE UPDATE OR DELETE ON "pravia_os"."expediente_documento_snapshots"
FOR EACH ROW EXECUTE FUNCTION "pravia_os"."prevent_exp004_snapshot_mutation"();

CREATE TRIGGER "trg_exp004_snapshot_items_immutable"
BEFORE UPDATE OR DELETE ON "pravia_os"."expediente_documento_snapshot_items"
FOR EACH ROW EXECUTE FUNCTION "pravia_os"."prevent_exp004_snapshot_mutation"();

-- Intencionalmente no se crean snapshots para los siete expedientes legacy.
-- Storage blob count before/after: unchanged. Missing-file records: preserved.
