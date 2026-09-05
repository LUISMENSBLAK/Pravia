CREATE TABLE "compliance_assisted_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "compliance_review_id" UUID NOT NULL,
  "executed_by_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "dataset_snapshot" JSONB NOT NULL,
  "dataset_fingerprint" VARCHAR(64) NOT NULL,
  "source_manifest" JSONB NOT NULL,
  "canonical_document_id" UUID,
  "canonical_document_version" VARCHAR(128),
  "canonical_document_checksum" VARCHAR(64),
  "canonical_document_role" VARCHAR(40),
  "provider" VARCHAR(40) NOT NULL,
  "model" VARCHAR(120) NOT NULL,
  "prompt_version" VARCHAR(40) NOT NULL,
  "output_schema_version" VARCHAR(40) NOT NULL,
  "result_json" JSONB NOT NULL,
  "result_checksum" VARCHAR(64) NOT NULL,
  "correct_count" INTEGER NOT NULL,
  "observation_count" INTEGER NOT NULL,
  "critical_count" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_assisted_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "h9_assisted_review_counts_nonnegative" CHECK (
    "correct_count" >= 0 AND "observation_count" >= 0 AND "critical_count" >= 0
  )
);

CREATE UNIQUE INDEX "h9_assisted_review_idempotency_key"
  ON "compliance_assisted_reviews"("organization_id", "expediente_id", "idempotency_key");
CREATE UNIQUE INDEX "h9_assisted_review_tenant_key"
  ON "compliance_assisted_reviews"("id", "organization_id");
CREATE INDEX "idx_h9_assisted_review_history"
  ON "compliance_assisted_reviews"("organization_id", "expediente_id", "created_at");
CREATE INDEX "idx_h9_assisted_review_context"
  ON "compliance_assisted_reviews"("compliance_review_id", "organization_id", "expediente_id");
CREATE INDEX "idx_fk_compliance_assisted_reviews_4089c644"
  ON "compliance_assisted_reviews"("organization_id", "executed_by_id");

ALTER TABLE "compliance_assisted_reviews"
  ADD CONSTRAINT "h9_assisted_review_org_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_assisted_reviews"
  ADD CONSTRAINT "h9_assisted_review_case_fkey"
  FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "expedientes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_assisted_reviews"
  ADD CONSTRAINT "h9_assisted_review_context_fkey"
  FOREIGN KEY ("compliance_review_id", "organization_id", "expediente_id") REFERENCES "compliance_reviews"("id", "organization_id", "expediente_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_assisted_reviews"
  ADD CONSTRAINT "h9_assisted_review_actor_fkey"
  FOREIGN KEY ("organization_id", "executed_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE FUNCTION prevent_h9_assisted_review_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'completed CUM-AUD reviews are append-only';
END;
$$;

CREATE TRIGGER "h9_assisted_review_append_only"
BEFORE UPDATE OR DELETE ON "compliance_assisted_reviews"
FOR EACH ROW EXECUTE FUNCTION prevent_h9_assisted_review_mutation();
