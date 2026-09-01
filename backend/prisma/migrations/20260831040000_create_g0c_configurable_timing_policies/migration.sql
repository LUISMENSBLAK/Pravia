-- G0-C · Five closed, organization-scoped timing policies.
-- Additive only: no durations, calendars, revisions, intervals or dates are seeded/backfilled.
BEGIN;
SET LOCAL search_path TO pravia_os, public;

CREATE TYPE "TimingPolicyDomain" AS ENUM ('COMMERCIAL', 'ADMINISTRATIVE');
CREATE TYPE "TimingPolicyType" AS ENUM (
  'PROSPECT_INFO_COLLECTION',
  'PROSPECT_READY_TO_REQUEST',
  'PROSPECT_NOTARY_WAIT',
  'ADMIN_PAYMENT_REQUEST_PENDING',
  'ADMIN_RECEIPT_PENDING_APPLICATION'
);
CREATE TYPE "TimingPolicyUnit" AS ENUM ('HOURS', 'DAYS');
CREATE TYPE "TimingCalendarSemantics" AS ENUM ('ELAPSED_UTC');
CREATE TYPE "TimingCalculationStatus" AS ENUM ('CALCULABLE', 'NOT_CONFIGURED', 'UNKNOWN_LEGACY', 'NOT_APPLICABLE');

CREATE TABLE "timing_policy_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "domain" "TimingPolicyDomain" NOT NULL,
  "policy_type" "TimingPolicyType" NOT NULL,
  "revision" INTEGER NOT NULL,
  "duration" INTEGER NOT NULL,
  "unit" "TimingPolicyUnit" NOT NULL,
  "calendar_semantics" "TimingCalendarSemantics" NOT NULL,
  "provenance" JSONB NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMP(3) NOT NULL,
  "superseded_at" TIMESTAMP(3),
  "idempotency_key" VARCHAR(120) NOT NULL,
  "payload_hash" VARCHAR(64) NOT NULL,
  CONSTRAINT "timing_policy_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_timing_policy_positive" CHECK ("revision" > 0 AND "duration" > 0),
  CONSTRAINT "ck_timing_policy_hash" CHECK (length("payload_hash") = 64 AND length(btrim("idempotency_key")) > 0),
  CONSTRAINT "ck_timing_policy_domain" CHECK (
    ("domain" = 'COMMERCIAL' AND "policy_type" IN ('PROSPECT_INFO_COLLECTION', 'PROSPECT_READY_TO_REQUEST', 'PROSPECT_NOTARY_WAIT')) OR
    ("domain" = 'ADMINISTRATIVE' AND "policy_type" IN ('ADMIN_PAYMENT_REQUEST_PENDING', 'ADMIN_RECEIPT_PENDING_APPLICATION'))
  ),
  CONSTRAINT "ck_timing_policy_lifecycle" CHECK ("published_at" >= "created_at" AND ("superseded_at" IS NULL OR "superseded_at" >= "published_at")),
  CONSTRAINT "uq_timing_policy_revision" UNIQUE ("organization_id", "policy_type", "revision"),
  CONSTRAINT "uq_timing_policy_publication_key" UNIQUE ("organization_id", "policy_type", "idempotency_key"),
  CONSTRAINT "uq_timing_policy_revision_tenant_type" UNIQUE ("id", "organization_id", "policy_type"),
  CONSTRAINT "timing_policy_revision_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "timing_policy_revision_actor_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uq_timing_policy_current" ON "timing_policy_revisions"("organization_id", "policy_type") WHERE "superseded_at" IS NULL;
CREATE INDEX "idx_timing_policy_history" ON "timing_policy_revisions"("organization_id", "domain", "policy_type", "published_at");

-- Composite keys are tenant-integrity anchors only; they do not recode legacy rows.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_g0c_prospect_id_org" ON "prospectos"("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_g0c_prospect_transition_id_org" ON "prospecto_transiciones"("id", "organization_id");

CREATE TABLE "timing_intervals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "policy_type" "TimingPolicyType" NOT NULL,
  "calculation_status" "TimingCalculationStatus" NOT NULL,
  "policy_revision_id" UUID,
  "prospecto_id" UUID,
  "payment_request_id" UUID,
  "receipt_report_id" UUID,
  "opened_transition_id" UUID,
  "closed_transition_id" UUID,
  "opened_at" TIMESTAMP(3) NOT NULL,
  "closed_at" TIMESTAMP(3),
  "provenance" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "timing_intervals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_timing_interval_chronology" CHECK ("closed_at" IS NULL OR "closed_at" >= "opened_at"),
  CONSTRAINT "ck_timing_interval_calculation" CHECK (
    ("calculation_status" = 'CALCULABLE' AND "policy_revision_id" IS NOT NULL) OR
    ("calculation_status" <> 'CALCULABLE' AND "policy_revision_id" IS NULL)
  ),
  CONSTRAINT "ck_timing_interval_persisted_states" CHECK ("calculation_status" IN ('CALCULABLE', 'NOT_CONFIGURED')),
  CONSTRAINT "ck_timing_interval_source" CHECK (
    ("policy_type" IN ('PROSPECT_INFO_COLLECTION', 'PROSPECT_READY_TO_REQUEST', 'PROSPECT_NOTARY_WAIT')
      AND "prospecto_id" IS NOT NULL AND "opened_transition_id" IS NOT NULL
      AND "payment_request_id" IS NULL AND "receipt_report_id" IS NULL) OR
    ("policy_type" = 'ADMIN_PAYMENT_REQUEST_PENDING'
      AND "prospecto_id" IS NULL AND "opened_transition_id" IS NULL AND "closed_transition_id" IS NULL
      AND "payment_request_id" IS NOT NULL AND "receipt_report_id" IS NULL) OR
    ("policy_type" = 'ADMIN_RECEIPT_PENDING_APPLICATION'
      AND "prospecto_id" IS NULL AND "opened_transition_id" IS NULL AND "closed_transition_id" IS NULL
      AND "payment_request_id" IS NULL AND "receipt_report_id" IS NOT NULL)
  ),
  CONSTRAINT "timing_interval_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "timing_interval_policy_fkey" FOREIGN KEY ("policy_revision_id", "organization_id", "policy_type") REFERENCES "timing_policy_revisions"("id", "organization_id", "policy_type") ON DELETE RESTRICT,
  CONSTRAINT "timing_interval_prospect_fkey" FOREIGN KEY ("prospecto_id", "organization_id") REFERENCES "prospectos"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "timing_interval_payment_fkey" FOREIGN KEY ("payment_request_id", "organization_id") REFERENCES "expediente_solicitudes_pago"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "timing_interval_receipt_fkey" FOREIGN KEY ("receipt_report_id", "organization_id") REFERENCES "expediente_ingresos_reportados"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "timing_interval_open_transition_fkey" FOREIGN KEY ("opened_transition_id", "organization_id") REFERENCES "prospecto_transiciones"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "timing_interval_close_transition_fkey" FOREIGN KEY ("closed_transition_id", "organization_id") REFERENCES "prospecto_transiciones"("id", "organization_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "uq_timing_interval_prospect" ON "timing_intervals"("organization_id", "policy_type", "prospecto_id") WHERE "prospecto_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_timing_interval_payment" ON "timing_intervals"("organization_id", "policy_type", "payment_request_id") WHERE "payment_request_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_timing_interval_receipt" ON "timing_intervals"("organization_id", "policy_type", "receipt_report_id") WHERE "receipt_report_id" IS NOT NULL;
CREATE INDEX "idx_timing_interval_source" ON "timing_intervals"("organization_id", "policy_type", "calculation_status", "opened_at");
CREATE INDEX "idx_timing_interval_revision_fk" ON "timing_intervals"("policy_revision_id");
CREATE INDEX "idx_timing_interval_open_transition_fk" ON "timing_intervals"("opened_transition_id");
CREATE INDEX "idx_timing_interval_close_transition_fk" ON "timing_intervals"("closed_transition_id");

CREATE FUNCTION g0c_policy_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'G0C_USED_POLICY_REVISION_DELETE_BLOCKED' USING ERRCODE = '23514';
  END IF;
  IF OLD.superseded_at IS NULL AND NEW.superseded_at IS NOT NULL
    AND OLD.id IS NOT DISTINCT FROM NEW.id
    AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id
    AND OLD.domain IS NOT DISTINCT FROM NEW.domain
    AND OLD.policy_type IS NOT DISTINCT FROM NEW.policy_type
    AND OLD.revision IS NOT DISTINCT FROM NEW.revision
    AND OLD.duration IS NOT DISTINCT FROM NEW.duration
    AND OLD.unit IS NOT DISTINCT FROM NEW.unit
    AND OLD.calendar_semantics IS NOT DISTINCT FROM NEW.calendar_semantics
    AND OLD.provenance IS NOT DISTINCT FROM NEW.provenance
    AND OLD.created_by_id IS NOT DISTINCT FROM NEW.created_by_id
    AND OLD.created_at IS NOT DISTINCT FROM NEW.created_at
    AND OLD.published_at IS NOT DISTINCT FROM NEW.published_at
    AND OLD.idempotency_key IS NOT DISTINCT FROM NEW.idempotency_key
    AND OLD.payload_hash IS NOT DISTINCT FROM NEW.payload_hash THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'G0C_POLICY_REVISION_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER g0c_policy_revision_immutable_trigger BEFORE UPDATE OR DELETE ON "timing_policy_revisions"
  FOR EACH ROW EXECUTE FUNCTION g0c_policy_revision_immutable();

CREATE FUNCTION g0c_interval_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'G0C_INTERVAL_DELETE_BLOCKED' USING ERRCODE = '23514';
  END IF;
  IF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL
    AND OLD.id IS NOT DISTINCT FROM NEW.id
    AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id
    AND OLD.policy_type IS NOT DISTINCT FROM NEW.policy_type
    AND OLD.calculation_status IS NOT DISTINCT FROM NEW.calculation_status
    AND OLD.policy_revision_id IS NOT DISTINCT FROM NEW.policy_revision_id
    AND OLD.prospecto_id IS NOT DISTINCT FROM NEW.prospecto_id
    AND OLD.payment_request_id IS NOT DISTINCT FROM NEW.payment_request_id
    AND OLD.receipt_report_id IS NOT DISTINCT FROM NEW.receipt_report_id
    AND OLD.opened_transition_id IS NOT DISTINCT FROM NEW.opened_transition_id
    AND OLD.provenance IS NOT DISTINCT FROM NEW.provenance
    AND OLD.created_at IS NOT DISTINCT FROM NEW.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'G0C_INTERVAL_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER g0c_interval_immutable_trigger BEFORE UPDATE OR DELETE ON "timing_intervals"
  FOR EACH ROW EXECUTE FUNCTION g0c_interval_immutable();

CREATE FUNCTION g0c_validate_interval_fact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  opening prospecto_transiciones;
  closing prospecto_transiciones;
  payment expediente_solicitudes_pago;
  receipt expediente_ingresos_reportados;
  policy timing_policy_revisions;
BEGIN
  IF NEW.policy_revision_id IS NOT NULL THEN
    SELECT * INTO policy FROM timing_policy_revisions WHERE id = NEW.policy_revision_id;
    IF policy.organization_id IS DISTINCT FROM NEW.organization_id OR policy.policy_type IS DISTINCT FROM NEW.policy_type THEN
      RAISE EXCEPTION 'G0C_POLICY_REFERENCE_INVALID' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' AND policy.superseded_at IS NOT NULL THEN
      RAISE EXCEPTION 'G0C_POLICY_REFERENCE_NOT_CURRENT_AT_START' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.prospecto_id IS NOT NULL THEN
    SELECT * INTO opening FROM prospecto_transiciones WHERE id = NEW.opened_transition_id;
    IF opening.prospecto_id IS DISTINCT FROM NEW.prospecto_id OR opening.effective_at IS DISTINCT FROM NEW.opened_at THEN
      RAISE EXCEPTION 'G0C_PROSPECT_OPENING_FACT_INVALID' USING ERRCODE = '23514';
    END IF;
    IF (NEW.policy_type = 'PROSPECT_INFO_COLLECTION' AND opening.etapa_nueva <> 'RECABANDO_INFORMACION')
      OR (NEW.policy_type = 'PROSPECT_READY_TO_REQUEST' AND opening.etapa_nueva <> 'LISTO_PARA_SOLICITAR')
      OR (NEW.policy_type = 'PROSPECT_NOTARY_WAIT' AND opening.accion <> 'REGISTRAR_ENVIO') THEN
      RAISE EXCEPTION 'G0C_PROSPECT_OPENING_TYPE_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.closed_at IS NOT NULL THEN
      SELECT * INTO closing FROM prospecto_transiciones WHERE id = NEW.closed_transition_id;
      IF closing.prospecto_id IS DISTINCT FROM NEW.prospecto_id OR closing.effective_at IS DISTINCT FROM NEW.closed_at THEN
        RAISE EXCEPTION 'G0C_PROSPECT_CLOSING_FACT_INVALID' USING ERRCODE = '23514';
      END IF;
      IF (NEW.policy_type = 'PROSPECT_INFO_COLLECTION' AND closing.etapa_anterior <> 'RECABANDO_INFORMACION')
        OR (NEW.policy_type = 'PROSPECT_READY_TO_REQUEST' AND closing.accion <> 'REGISTRAR_ENVIO')
        OR (NEW.policy_type = 'PROSPECT_NOTARY_WAIT' AND closing.accion <> 'REGISTRAR_RECEPCION') THEN
        RAISE EXCEPTION 'G0C_PROSPECT_CLOSING_TYPE_INVALID' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF NEW.payment_request_id IS NOT NULL THEN
    SELECT * INTO payment FROM expediente_solicitudes_pago WHERE id = NEW.payment_request_id;
    IF payment.created_at IS DISTINCT FROM NEW.opened_at OR
      (NEW.closed_at IS NULL AND payment.estado <> 'PENDIENTE') OR
      (NEW.closed_at IS NOT NULL AND payment.estado NOT IN ('PAGADA', 'ANULADA')) OR
      (NEW.closed_at IS NOT NULL AND payment.estado = 'PAGADA' AND payment.pagado_at IS DISTINCT FROM NEW.closed_at) OR
      (NEW.closed_at IS NOT NULL AND payment.estado = 'ANULADA' AND payment.anulado_at IS DISTINCT FROM NEW.closed_at) THEN
      RAISE EXCEPTION 'G0C_PAYMENT_REQUEST_FACT_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.receipt_report_id IS NOT NULL THEN
    SELECT * INTO receipt FROM expediente_ingresos_reportados WHERE id = NEW.receipt_report_id;
    IF receipt.created_at IS DISTINCT FROM NEW.opened_at OR
      (NEW.closed_at IS NULL AND receipt.estado <> 'PENDIENTE_APLICACION') OR
      (NEW.closed_at IS NOT NULL AND receipt.estado NOT IN ('APLICADO', 'ANULADO')) OR
      (NEW.closed_at IS NOT NULL AND receipt.estado = 'APLICADO' AND receipt.aplicado_at IS DISTINCT FROM NEW.closed_at) OR
      (NEW.closed_at IS NOT NULL AND receipt.estado = 'ANULADO' AND receipt.anulado_at IS DISTINCT FROM NEW.closed_at) THEN
      RAISE EXCEPTION 'G0C_RECEIPT_FACT_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER g0c_interval_fact_integrity AFTER INSERT OR UPDATE ON "timing_intervals"
  FOR EACH ROW EXECUTE FUNCTION g0c_validate_interval_fact();

COMMIT;
