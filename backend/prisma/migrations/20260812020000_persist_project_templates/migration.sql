ALTER TABLE "plantilla_documental_versiones"
  ADD COLUMN "notaria_id" UUID,
  ADD COLUMN "nombre" TEXT,
  ADD COLUMN "storage_key" TEXT,
  ADD COLUMN "mime_type" TEXT,
  ADD COLUMN "size_bytes" INTEGER,
  ADD COLUMN "checksum_sha256" TEXT,
  ADD COLUMN "activa" BOOLEAN NOT NULL DEFAULT TRUE;

DROP INDEX "plantilla_documental_versiones_tipo_acto_id_version_key";
CREATE UNIQUE INDEX "plantilla_documental_versiones_tipo_acto_id_notaria_id_version_key"
  ON "plantilla_documental_versiones"("tipo_acto_id", "notaria_id", "version");
CREATE UNIQUE INDEX "plantilla_documental_versiones_tipo_acto_id_version_general_key"
  ON "plantilla_documental_versiones"("tipo_acto_id", "version") WHERE "notaria_id" IS NULL;

CREATE INDEX "plantilla_documental_versiones_tipo_acto_id_notaria_id_activa_idx"
  ON "plantilla_documental_versiones"("tipo_acto_id", "notaria_id", "activa");

ALTER TABLE "plantilla_documental_versiones" ADD CONSTRAINT "plantilla_documental_versiones_notaria_id_fkey"
  FOREIGN KEY ("notaria_id") REFERENCES "notarias"("id") ON DELETE SET NULL ON UPDATE CASCADE;
