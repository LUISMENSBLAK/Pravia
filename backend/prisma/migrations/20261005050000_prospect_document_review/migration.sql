CREATE TABLE "prospecto_revisiones_documentales" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "prospecto_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "act_snapshot" JSONB NOT NULL,
    "document_snapshot" JSONB NOT NULL,
    "resumen" TEXT NOT NULL,
    "hallazgos" JSONB NOT NULL,
    "documentos_no_leidos" JSONB NOT NULL,
    "modelo" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospecto_revisiones_documentales_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_prospect_review_org_prospect_created"
    ON "prospecto_revisiones_documentales"("organization_id", "prospecto_id", "created_at");

ALTER TABLE "prospecto_revisiones_documentales"
    ADD CONSTRAINT "prospect_review_org_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "prospecto_revisiones_documentales"
    ADD CONSTRAINT "prospect_review_prospect_tenant_fkey" FOREIGN KEY ("prospecto_id", "organization_id")
    REFERENCES "prospectos"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "prospecto_revisiones_documentales"
    ADD CONSTRAINT "prospect_review_actor_tenant_fkey" FOREIGN KEY ("organization_id", "actor_id")
    REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
