-- G0-B additive only. Existing quote states and dates are preserved exactly as legacy facts.
-- No commercial milestone, date or contractual transition is inferred during this migration.
SET search_path TO pravia_os, public;

-- Compatibility projection for canonical exceptional exits. Historical values remain untouched.
ALTER TYPE "CotizacionEstado" ADD VALUE IF NOT EXISTS 'SUSPENDIDA';
ALTER TYPE "CotizacionEstado" ADD VALUE IF NOT EXISTS 'CANCELADA';

CREATE TYPE "CotizacionEtapaContractual" AS ENUM (
  'BORRADOR',
  'ENVIADA_CLIENTE',
  'ACEPTO_ANTICIPO',
  'SUSPENDIDA',
  'CANCELADA',
  'CONVERTIDA_EXPEDIENTE'
);

ALTER TABLE "cotizaciones"
  ADD COLUMN "etapa_contractual" "CotizacionEtapaContractual",
  ADD COLUMN "version_operativa" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "transicion_actual_id" UUID;

CREATE TABLE "cotizacion_transiciones" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "cotizacion_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "etapa_anterior" "CotizacionEtapaContractual",
  "etapa_nueva" "CotizacionEtapaContractual" NOT NULL,
  "effective_at" TIMESTAMP(3) NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accion" VARCHAR(60) NOT NULL,
  "procedencia" VARCHAR(60) NOT NULL,
  "canal" VARCHAR(100),
  "destinatario" VARCHAR(320),
  "causa" TEXT,
  "evidencia" JSONB NOT NULL,
  "version" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(120) NOT NULL,
  "payload_hash" VARCHAR(64) NOT NULL,
  "cambia_etapa" BOOLEAN NOT NULL DEFAULT true,
  "cotizacion_version_id" UUID,
  CONSTRAINT "cotizacion_transiciones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_cotizacion_transition_key"
  ON "cotizacion_transiciones"("organization_id", "cotizacion_id", "idempotency_key");
CREATE UNIQUE INDEX "uq_cotizacion_transition_version"
  ON "cotizacion_transiciones"("cotizacion_id", "version");
CREATE INDEX "idx_cotizacion_transition_actor"
  ON "cotizacion_transiciones"("organization_id", "actor_id");
CREATE INDEX "idx_cotizacion_transition_history"
  ON "cotizacion_transiciones"("cotizacion_id", "organization_id", "effective_at");
CREATE INDEX "idx_cotizacion_transition_version_fk"
  ON "cotizacion_transiciones"("cotizacion_version_id");
CREATE UNIQUE INDEX "uq_cotizacion_first_client_send"
  ON "cotizacion_transiciones"("cotizacion_id") WHERE "accion" = 'ENVIAR_CLIENTE';
CREATE UNIQUE INDEX "uq_cotizacion_acceptance_milestone"
  ON "cotizacion_transiciones"("cotizacion_id") WHERE "accion" = 'REGISTRAR_ACEPTACION_ANTICIPO';
CREATE UNIQUE INDEX "uq_cotizacion_conversion_milestone"
  ON "cotizacion_transiciones"("cotizacion_id") WHERE "accion" = 'CONVERTIR';
CREATE INDEX "idx_cotizacion_current_transition" ON "cotizaciones"("transicion_actual_id");
CREATE INDEX "idx_cotizacion_contract_stage" ON "cotizaciones"("organization_id", "etapa_contractual");

ALTER TABLE "cotizaciones" ADD CONSTRAINT "cotizaciones_transicion_actual_id_fkey"
  FOREIGN KEY ("transicion_actual_id") REFERENCES "cotizacion_transiciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cotizacion_transiciones" ADD CONSTRAINT "cotizacion_transiciones_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cotizacion_transiciones" ADD CONSTRAINT "cotizacion_transiciones_cotizacion_id_fkey"
  FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cotizacion_transiciones" ADD CONSTRAINT "cotizacion_transiciones_organization_id_actor_id_fkey"
  FOREIGN KEY ("organization_id", "actor_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cotizacion_transiciones" ADD CONSTRAINT "cotizacion_transiciones_cotizacion_version_id_fkey"
  FOREIGN KEY ("cotizacion_version_id") REFERENCES "cotizacion_versiones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cotizaciones" ADD CONSTRAINT "cot001_stage_has_fact" CHECK
  (("etapa_contractual" IS NULL) = ("transicion_actual_id" IS NULL));
ALTER TABLE "cotizaciones" ADD CONSTRAINT "cot001_version_nonnegative" CHECK ("version_operativa" >= 0);
ALTER TABLE "cotizacion_transiciones" ADD CONSTRAINT "cot001_transition_shape" CHECK (
  "version" > 0
  AND length(btrim("idempotency_key")) > 0
  AND length("payload_hash") = 64
  AND "effective_at" <= "recorded_at"
  AND (
    ("accion" = 'CREAR' AND "cambia_etapa" AND "etapa_anterior" IS NULL AND "etapa_nueva" = 'BORRADOR')
    OR ("accion" = 'ENVIAR_CLIENTE' AND "cambia_etapa" AND "etapa_anterior" = 'BORRADOR' AND "etapa_nueva" = 'ENVIADA_CLIENTE'
      AND length(btrim("canal")) > 0 AND length(btrim("destinatario")) > 0)
    OR ("accion" = 'REENVIAR_CLIENTE' AND NOT "cambia_etapa" AND "etapa_anterior" = 'ENVIADA_CLIENTE' AND "etapa_nueva" = 'ENVIADA_CLIENTE'
      AND length(btrim("canal")) > 0 AND length(btrim("destinatario")) > 0)
    OR ("accion" = 'REGISTRAR_ACEPTACION_ANTICIPO' AND "cambia_etapa" AND "etapa_anterior" = 'ENVIADA_CLIENTE' AND "etapa_nueva" = 'ACEPTO_ANTICIPO')
    OR ("accion" = 'SUSPENDER' AND "cambia_etapa" AND "etapa_anterior" IN ('BORRADOR','ENVIADA_CLIENTE','ACEPTO_ANTICIPO') AND "etapa_nueva" = 'SUSPENDIDA')
    OR ("accion" = 'CANCELAR' AND "cambia_etapa" AND "etapa_anterior" IN ('BORRADOR','ENVIADA_CLIENTE','ACEPTO_ANTICIPO') AND "etapa_nueva" = 'CANCELADA')
    OR ("accion" = 'CONVERTIR' AND "cambia_etapa" AND "etapa_anterior" = 'ACEPTO_ANTICIPO' AND "etapa_nueva" = 'CONVERTIDA_EXPEDIENTE')
  )
);

-- Tenant checks reuse the structural multitenancy guard and cover nullable legacy parents.
DO $$
DECLARE rel RECORD;
BEGIN
  FOR rel IN SELECT * FROM (VALUES
    ('cotizaciones','cotizacion_transiciones','transicion_actual_id'),
    ('cotizacion_transiciones','cotizaciones','cotizacion_id'),
    ('cotizacion_transiciones','cotizacion_versiones','cotizacion_version_id')
  ) AS r(child_table,parent_table,fk_column)
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON pravia_os.%I FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization(%L,%L)',
      'cot001_org_' || rel.child_table || '_' || rel.fk_column, rel.child_table, rel.parent_table, rel.fk_column);
  END LOOP;
END $$;

CREATE FUNCTION pravia_os.cot001_immutable_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'COT001_FACT_IMMUTABLE' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER cot001_transition_immutable BEFORE UPDATE OR DELETE ON "cotizacion_transiciones"
  FOR EACH ROW EXECUTE FUNCTION pravia_os.cot001_immutable_fact();

CREATE FUNCTION pravia_os.cot001_current_fact_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q pravia_os.cotizaciones; fact pravia_os.cotizacion_transiciones; projected TEXT;
BEGIN
  IF TG_TABLE_NAME = 'cotizaciones' THEN
    SELECT * INTO q FROM pravia_os.cotizaciones WHERE id = NEW.id;
  ELSE
    SELECT * INTO q FROM pravia_os.cotizaciones WHERE id = NEW.cotizacion_id;
    IF NEW.cambia_etapa AND q.transicion_actual_id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'COT001_ORPHAN_TRANSITION' USING ERRCODE = '23514';
    END IF;
    IF NOT NEW.cambia_etapa AND (q.etapa_contractual IS DISTINCT FROM NEW.etapa_nueva OR q.version_operativa IS DISTINCT FROM NEW.version) THEN
      RAISE EXCEPTION 'COT001_RESEND_NOT_RECORDED' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF q.etapa_contractual IS NULL THEN RETURN NEW; END IF;
  IF q.organization_id IS NULL OR q.prospecto_id IS NULL OR q.fuente_notarial_id IS NULL THEN
    RAISE EXCEPTION 'COT001_CANONICAL_ORIGIN_REQUIRED' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO fact FROM pravia_os.cotizacion_transiciones WHERE id = q.transicion_actual_id;
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
CREATE CONSTRAINT TRIGGER cot001_current_fact AFTER INSERT OR UPDATE ON "cotizaciones"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pravia_os.cot001_current_fact_integrity();
CREATE CONSTRAINT TRIGGER cot001_atomic_transition AFTER INSERT ON "cotizacion_transiciones"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pravia_os.cot001_current_fact_integrity();

CREATE FUNCTION pravia_os.cot001_version_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_quote UUID;
BEGIN
  IF NEW.cotizacion_version_id IS NOT NULL THEN
    SELECT cotizacion_id INTO version_quote FROM pravia_os.cotizacion_versiones WHERE id = NEW.cotizacion_version_id;
    IF version_quote IS DISTINCT FROM NEW.cotizacion_id THEN
      RAISE EXCEPTION 'COT001_QUOTE_VERSION_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cot001_transition_version BEFORE INSERT ON "cotizacion_transiciones"
  FOR EACH ROW EXECUTE FUNCTION pravia_os.cot001_version_integrity();
