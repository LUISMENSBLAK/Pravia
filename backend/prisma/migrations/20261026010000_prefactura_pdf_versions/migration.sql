-- Additive, tenant-scoped immutable history of generated prefactura PDFs.
-- Existing CFDI and document rows are not rewritten.
CREATE SEQUENCE "pravia_os"."cfdi_internal_folio_seq";
ALTER TABLE "pravia_os"."documentos_cfdi" ADD COLUMN "internal_folio" VARCHAR(60);
CREATE UNIQUE INDEX "uq_documentos_cfdi_internal_folio" ON "pravia_os"."documentos_cfdi" ("organization_id", "internal_folio");

CREATE TABLE "pravia_os"."prefactura_representaciones" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "cfdi_id" UUID NOT NULL,
  "documento_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "snapshot_sha256" VARCHAR(64) NOT NULL,
  "pdf_sha256" VARCHAR(64) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "generator" VARCHAR(80) NOT NULL DEFAULT 'PRAVIA_PREFACTURA_V1',
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prefactura_representaciones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prefactura_repr_positive_version" CHECK ("version" > 0),
  CONSTRAINT "prefactura_repr_positive_size" CHECK ("size_bytes" > 0)
);

CREATE UNIQUE INDEX "uq_prefactura_repr_version" ON "pravia_os"."prefactura_representaciones" ("organization_id", "cfdi_id", "version");
CREATE UNIQUE INDEX "uq_prefactura_repr_idempotency" ON "pravia_os"."prefactura_representaciones" ("organization_id", "cfdi_id", "idempotency_key");
CREATE UNIQUE INDEX "uq_prefactura_repr_documento" ON "pravia_os"."prefactura_representaciones" ("documento_id", "organization_id");
CREATE INDEX "idx_prefactura_repr_history" ON "pravia_os"."prefactura_representaciones" ("organization_id", "cfdi_id", "created_at");

ALTER TABLE "pravia_os"."prefactura_representaciones" ADD CONSTRAINT "prefactura_repr_org_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "pravia_os"."organizations" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "pravia_os"."prefactura_representaciones" ADD CONSTRAINT "prefactura_repr_cfdi_fkey"
  FOREIGN KEY ("cfdi_id", "organization_id") REFERENCES "pravia_os"."documentos_cfdi" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "pravia_os"."prefactura_representaciones" ADD CONSTRAINT "prefactura_repr_documento_fkey"
  FOREIGN KEY ("documento_id", "organization_id") REFERENCES "pravia_os"."documentos" ("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "pravia_os"."prefactura_representaciones" ADD CONSTRAINT "prefactura_repr_creator_fkey"
  FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "pravia_os"."organization_memberships" ("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
