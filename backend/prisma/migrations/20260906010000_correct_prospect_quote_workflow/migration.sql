-- Correccion Post-Implementacion 001: additive-only prospect-to-quote workflow.
-- Legacy external-notary enum values and rows remain readable and unchanged.
SET search_path TO pravia_os, public;

ALTER TYPE "ProspectoEtapaContractual" ADD VALUE IF NOT EXISTS 'EN_INTEGRACION';
ALTER TYPE "ProspectoEtapaContractual" ADD VALUE IF NOT EXISTS 'LISTO_PARA_COTIZAR';
ALTER TYPE "ProspectoEtapaContractual" ADD VALUE IF NOT EXISTS 'CONVERTIDO_EN_COTIZACION';
ALTER TYPE "ProspectoEtapaContractual" ADD VALUE IF NOT EXISTS 'SUSPENDIDO';
ALTER TYPE "ProspectoEtapaContractual" ADD VALUE IF NOT EXISTS 'CANCELADO';

ALTER TABLE "prospectos"
  ADD COLUMN "honorarios_estimados" DECIMAL(14,2),
  ADD COLUMN "impuestos_derechos_estimados" DECIMAL(14,2),
  ADD COLUMN "total_estimado" DECIMAL(14,2);

ALTER TABLE "prospectos" ADD CONSTRAINT "prospect_quote_economic_preparation_valid" CHECK (
  (honorarios_estimados IS NULL AND impuestos_derechos_estimados IS NULL AND total_estimado IS NULL)
  OR
  (honorarios_estimados >= 0 AND impuestos_derechos_estimados >= 0 AND total_estimado >= 0
    AND total_estimado = honorarios_estimados + impuestos_derechos_estimados)
);

-- The Prisma contract has always modeled Prospecto -> Cotizacion as 1:0..1,
-- but older SQL chains did not materialize the physical unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "cotizaciones_prospecto_id_key"
  ON "cotizaciones"("prospecto_id");

-- COT-001 originally required an external-notary source for every canonical
-- quote. Correction 001 replaces that operational origin with the Prospecto
-- itself while preserving source-backed historical quotes.
CREATE OR REPLACE FUNCTION cot001_current_fact_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q cotizaciones; fact cotizacion_transiciones; projected TEXT;
BEGIN
  IF TG_TABLE_NAME = 'cotizaciones' THEN
    SELECT * INTO q FROM cotizaciones WHERE id = NEW.id;
  ELSE
    SELECT * INTO q FROM cotizaciones WHERE id = NEW.cotizacion_id;
    IF NEW.cambia_etapa AND q.transicion_actual_id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'COT001_ORPHAN_TRANSITION' USING ERRCODE = '23514';
    END IF;
    IF NOT NEW.cambia_etapa AND (q.etapa_contractual IS DISTINCT FROM NEW.etapa_nueva OR q.version_operativa IS DISTINCT FROM NEW.version) THEN
      RAISE EXCEPTION 'COT001_RESEND_NOT_RECORDED' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF q.etapa_contractual IS NULL THEN RETURN NEW; END IF;
  IF q.organization_id IS NULL OR q.prospecto_id IS NULL THEN
    RAISE EXCEPTION 'COT001_CANONICAL_ORIGIN_REQUIRED' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO fact FROM cotizacion_transiciones WHERE id = q.transicion_actual_id;
  IF fact.cotizacion_id IS DISTINCT FROM q.id OR fact.organization_id IS DISTINCT FROM q.organization_id
    OR fact.etapa_nueva IS DISTINCT FROM q.etapa_contractual OR fact.version > q.version_operativa OR NOT fact.cambia_etapa THEN
    RAISE EXCEPTION 'COT001_CURRENT_FACT_INVALID' USING ERRCODE = '23514';
  END IF;
  projected := CASE q.etapa_contractual::text
    WHEN 'ACEPTO_ANTICIPO' THEN 'ACEPTADA'
    ELSE q.etapa_contractual::text
  END;
  IF q.estado::text IS DISTINCT FROM projected THEN
    RAISE EXCEPTION 'COT001_LEGACY_PROJECTION_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- G0-C validates interval lineage against the exact prospect transition that
-- opened/closed it. Extend that canonical guard for the replacement workflow;
-- legacy external-notary facts remain valid for historical reads.
CREATE OR REPLACE FUNCTION g0c_validate_interval_fact() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF (NEW.policy_type = 'PROSPECT_INFO_COLLECTION' AND opening.etapa_nueva::text NOT IN ('EN_INTEGRACION', 'RECABANDO_INFORMACION'))
      OR (NEW.policy_type = 'PROSPECT_READY_TO_REQUEST' AND opening.etapa_nueva::text NOT IN ('LISTO_PARA_COTIZAR', 'LISTO_PARA_SOLICITAR'))
      OR (NEW.policy_type = 'PROSPECT_NOTARY_WAIT' AND opening.accion <> 'REGISTRAR_ENVIO') THEN
      RAISE EXCEPTION 'G0C_PROSPECT_OPENING_TYPE_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.closed_at IS NOT NULL THEN
      SELECT * INTO closing FROM prospecto_transiciones WHERE id = NEW.closed_transition_id;
      IF closing.prospecto_id IS DISTINCT FROM NEW.prospecto_id OR closing.effective_at IS DISTINCT FROM NEW.closed_at THEN
        RAISE EXCEPTION 'G0C_PROSPECT_CLOSING_FACT_INVALID' USING ERRCODE = '23514';
      END IF;
      IF (NEW.policy_type = 'PROSPECT_INFO_COLLECTION' AND closing.etapa_anterior::text NOT IN ('EN_INTEGRACION', 'RECABANDO_INFORMACION'))
        OR (NEW.policy_type = 'PROSPECT_READY_TO_REQUEST' AND closing.etapa_anterior::text NOT IN ('LISTO_PARA_COTIZAR', 'LISTO_PARA_SOLICITAR'))
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
