-- CFG-002 owner cutover. The legacy notaria_id remains as provenance for
-- existing rows; new organization-owned rows leave it NULL. IDs, versions,
-- links, storage keys and checksums are not recreated or rewritten.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "pravia_os"."catalogo_carpetas" f
    LEFT JOIN "pravia_os"."notarias" n ON n."id" = f."notaria_id" AND n."organization_id" = f."organization_id"
    WHERE f."propietario_tipo" = 'NOTARIA' AND n."id" IS NULL
  ) OR EXISTS (
    SELECT 1 FROM "pravia_os"."catalogo_artefactos" a
    LEFT JOIN "pravia_os"."notarias" n ON n."id" = a."notaria_id" AND n."organization_id" = a."organization_id"
    WHERE a."propietario_tipo" = 'NOTARIA' AND n."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'CFG002_OWNER_MAPPING_REVIEW_REQUIRED: legacy owner is missing or outside tenant';
  END IF;
END $$;

ALTER TABLE "pravia_os"."catalogo_carpetas" DROP CONSTRAINT "ck_catalogo_carpeta_owner";
ALTER TABLE "pravia_os"."catalogo_carpetas" ADD CONSTRAINT "ck_catalogo_carpeta_owner" CHECK (
  ("propietario_tipo" = 'ORGANIZACION' AND "institucion_id" IS NULL) OR
  ("propietario_tipo" = 'NOTARIA' AND "notaria_id" IS NOT NULL AND "institucion_id" IS NULL) OR
  ("propietario_tipo" = 'INSTITUCION' AND "tipo" = 'FORMATO' AND "notaria_id" IS NULL AND "institucion_id" IS NOT NULL)
);
ALTER TABLE "pravia_os"."catalogo_artefactos" DROP CONSTRAINT "ck_catalogo_artefacto_owner";
ALTER TABLE "pravia_os"."catalogo_artefactos" ADD CONSTRAINT "ck_catalogo_artefacto_owner" CHECK (
  ("propietario_tipo" = 'ORGANIZACION' AND "institucion_id" IS NULL) OR
  ("propietario_tipo" = 'NOTARIA' AND "notaria_id" IS NOT NULL AND "institucion_id" IS NULL) OR
  ("tipo" = 'FORMATO' AND "propietario_tipo" = 'INSTITUCION' AND "notaria_id" IS NULL AND "institucion_id" IS NOT NULL)
);

CREATE OR REPLACE FUNCTION "pravia_os"."prevent_catalog_folder_cycle"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE creates_cycle BOOLEAN;
BEGIN
  IF NEW."parent_id" IS NULL THEN RETURN NEW; END IF;
  IF NEW."parent_id" = NEW."id" THEN RAISE EXCEPTION 'catalog folder cannot be its own parent'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "pravia_os"."catalogo_carpetas" p
    WHERE p."id" = NEW."parent_id"
      AND p."organization_id" = NEW."organization_id"
      AND p."tipo" = NEW."tipo"
      AND p."propietario_tipo" = NEW."propietario_tipo"
      AND (NEW."propietario_tipo" = 'ORGANIZACION' OR p."notaria_id" IS NOT DISTINCT FROM NEW."notaria_id")
      AND p."institucion_id" IS NOT DISTINCT FROM NEW."institucion_id"
      AND p."activa" = true
  ) THEN RAISE EXCEPTION 'catalog folder parent scope mismatch'; END IF;
  WITH RECURSIVE ancestors AS (
    SELECT c."id", c."parent_id" FROM "pravia_os"."catalogo_carpetas" c
    WHERE c."id" = NEW."parent_id" AND c."organization_id" = NEW."organization_id"
    UNION ALL
    SELECT c."id", c."parent_id" FROM "pravia_os"."catalogo_carpetas" c
    JOIN ancestors a ON c."id" = a."parent_id"
    WHERE c."organization_id" = NEW."organization_id"
  )
  SELECT EXISTS (SELECT 1 FROM ancestors WHERE "id" = NEW."id") INTO creates_cycle;
  IF creates_cycle THEN RAISE EXCEPTION 'catalog folder hierarchy cycle'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "pravia_os"."enforce_catalog_artifact_folder_scope"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."carpeta_id" IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "pravia_os"."catalogo_carpetas" f
    WHERE f."id" = NEW."carpeta_id"
      AND f."organization_id" = NEW."organization_id"
      AND f."tipo" = NEW."tipo"
      AND f."propietario_tipo" = NEW."propietario_tipo"
      AND (NEW."propietario_tipo" = 'ORGANIZACION' OR f."notaria_id" IS NOT DISTINCT FROM NEW."notaria_id")
      AND f."institucion_id" IS NOT DISTINCT FROM NEW."institucion_id"
      AND f."activa" = true
  ) THEN RAISE EXCEPTION 'catalog artifact folder scope mismatch'; END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE folder RECORD;
        before_folders BIGINT;
        before_artifacts BIGINT;
BEGIN
  SELECT count(*) INTO before_folders FROM "pravia_os"."catalogo_carpetas" WHERE "propietario_tipo" = 'NOTARIA';
  SELECT count(*) INTO before_artifacts FROM "pravia_os"."catalogo_artefactos" WHERE "propietario_tipo" = 'NOTARIA';
  FOR folder IN
    WITH RECURSIVE tree AS (
      SELECT f."id", f."parent_id", 0 AS depth FROM "pravia_os"."catalogo_carpetas" f
      WHERE f."propietario_tipo" = 'NOTARIA' AND f."parent_id" IS NULL
      UNION ALL
      SELECT child."id", child."parent_id", parent.depth + 1
      FROM "pravia_os"."catalogo_carpetas" child
      JOIN tree parent ON parent."id" = child."parent_id"
      WHERE child."propietario_tipo" = 'NOTARIA'
    ) SELECT "id" FROM tree ORDER BY depth, "id"
  LOOP
    UPDATE "pravia_os"."catalogo_carpetas" SET "propietario_tipo" = 'ORGANIZACION' WHERE "id" = folder."id";
  END LOOP;
  IF EXISTS (SELECT 1 FROM "pravia_os"."catalogo_carpetas" WHERE "propietario_tipo" = 'NOTARIA') THEN
    RAISE EXCEPTION 'CFG002_OWNER_MAPPING_REVIEW_REQUIRED: folder hierarchy could not be mapped';
  END IF;
  UPDATE "pravia_os"."catalogo_artefactos" SET "propietario_tipo" = 'ORGANIZACION' WHERE "propietario_tipo" = 'NOTARIA';
  IF (SELECT count(*) FROM "pravia_os"."catalogo_carpetas" WHERE "propietario_tipo" = 'ORGANIZACION') < before_folders
    OR (SELECT count(*) FROM "pravia_os"."catalogo_artefactos" WHERE "propietario_tipo" = 'ORGANIZACION') < before_artifacts THEN
    RAISE EXCEPTION 'CFG002_OWNER_BACKFILL_COUNT_MISMATCH';
  END IF;
END $$;

-- New organization-owned folders have one sibling name per parent. Historical
-- folders with different legacy owners may coexist until explicit review.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_catalogo_carpetas_org_new_sibling"
ON "pravia_os"."catalogo_carpetas"("organization_id", "tipo", COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("nombre"))
WHERE "propietario_tipo" = 'ORGANIZACION' AND "notaria_id" IS NULL;

COMMIT;
