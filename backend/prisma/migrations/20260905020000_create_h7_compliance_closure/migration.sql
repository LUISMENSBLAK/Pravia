CREATE TABLE "compliance_requirement_exceptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "expediente_id" UUID NOT NULL,
  "review_id" UUID NOT NULL,
  "requirement_id" UUID NOT NULL,
  "resolution" VARCHAR(80) NOT NULL DEFAULT 'NO_APLICA_BY_AUTHORIZED_EXCEPTION',
  "reason" TEXT NOT NULL,
  "authorization_permission" VARCHAR(120) NOT NULL,
  "authorized_by_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "payload_hash" VARCHAR(64) NOT NULL,
  "supersedes_id" UUID,
  "superseded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_requirement_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "h7_compliance_exception_idempotency_key"
  ON "compliance_requirement_exceptions"("organization_id", "requirement_id", "idempotency_key");
CREATE UNIQUE INDEX "h7_compliance_exception_id_tenant_key"
  ON "compliance_requirement_exceptions"("id", "organization_id");
CREATE UNIQUE INDEX "h7_compliance_exception_one_current_key"
  ON "compliance_requirement_exceptions"("organization_id", "requirement_id")
  WHERE "superseded_at" IS NULL;
CREATE INDEX "h7_compliance_exception_current_idx"
  ON "compliance_requirement_exceptions"("organization_id", "requirement_id", "superseded_at");
CREATE INDEX "h7_compliance_exception_case_history_idx"
  ON "compliance_requirement_exceptions"("organization_id", "expediente_id", "created_at");
CREATE INDEX "h7_compliance_exception_review_history_idx"
  ON "compliance_requirement_exceptions"("organization_id", "review_id", "created_at");
CREATE INDEX "h7_compliance_exception_review_fk_idx"
  ON "compliance_requirement_exceptions"("review_id", "organization_id", "expediente_id");
CREATE INDEX "h7_compliance_exception_requirement_fk_idx"
  ON "compliance_requirement_exceptions"("requirement_id", "organization_id", "expediente_id", "review_id");
CREATE INDEX "h7_compliance_exception_actor_fk_idx"
  ON "compliance_requirement_exceptions"("organization_id", "authorized_by_id");
CREATE INDEX "h7_compliance_exception_supersedes_fk_idx"
  ON "compliance_requirement_exceptions"("supersedes_id", "organization_id");
CREATE UNIQUE INDEX "h7_compliance_requirement_exact_lineage_key"
  ON "compliance_requirements"("id", "organization_id", "expediente_id", "review_id");

ALTER TABLE "compliance_requirement_exceptions"
  ADD CONSTRAINT "h7_compliance_exception_org_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_requirement_exceptions"
  ADD CONSTRAINT "h7_compliance_exception_exp_fkey"
  FOREIGN KEY ("expediente_id", "organization_id") REFERENCES "expedientes"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_requirement_exceptions"
  ADD CONSTRAINT "h7_compliance_exception_review_fkey"
  FOREIGN KEY ("review_id", "organization_id", "expediente_id") REFERENCES "compliance_reviews"("id", "organization_id", "expediente_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_requirement_exceptions"
  ADD CONSTRAINT "h7_compliance_exception_requirement_fkey"
  FOREIGN KEY ("requirement_id", "organization_id", "expediente_id", "review_id") REFERENCES "compliance_requirements"("id", "organization_id", "expediente_id", "review_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_requirement_exceptions"
  ADD CONSTRAINT "h7_compliance_exception_actor_fkey"
  FOREIGN KEY ("organization_id", "authorized_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "compliance_requirement_exceptions"
  ADD CONSTRAINT "h7_compliance_exception_supersedes_fkey"
  FOREIGN KEY ("supersedes_id", "organization_id") REFERENCES "compliance_requirement_exceptions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "compliance_requirement_exceptions"
  ADD CONSTRAINT "h7_compliance_exception_resolution_check"
  CHECK ("resolution" = 'NO_APLICA_BY_AUTHORIZED_EXCEPTION');
ALTER TABLE "compliance_requirement_exceptions"
  ADD CONSTRAINT "h7_compliance_exception_reason_check"
  CHECK (length(btrim("reason")) >= 10);

-- The append-only exception is the current legal resolution. Provider
-- refreshes may update the requirement, but cannot silently reopen it.
CREATE FUNCTION "h7_preserve_authorized_exception_resolution"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" <> 'NO_APLICA'
     AND EXISTS (
       SELECT 1 FROM "compliance_requirement_exceptions" exception
       WHERE exception."organization_id" = NEW."organization_id"
         AND exception."requirement_id" = NEW."id"
         AND exception."superseded_at" IS NULL
     ) THEN
    NEW."status" := 'NO_APLICA';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "h7_preserve_authorized_exception_resolution_trigger"
BEFORE UPDATE OF "status" ON "compliance_requirements"
FOR EACH ROW
EXECUTE FUNCTION "h7_preserve_authorized_exception_resolution"();
