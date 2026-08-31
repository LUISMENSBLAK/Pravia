-- G0-A additive only. No historical recoding, dates or events are backfilled.
SET search_path TO pravia_os, public;

-- CreateEnum
CREATE TYPE "ProspectoEtapaContractual" AS ENUM ('NUEVO', 'RECABANDO_INFORMACION', 'LISTO_PARA_SOLICITAR', 'SOLICITUD_ENVIADA_NOTARIA', 'EN_ESPERA_COTIZACION', 'COTIZACION_RECIBIDA', 'CONVERTIDO_COTIZACION');

-- AlterTable
ALTER TABLE "prospectos" ADD COLUMN     "creation_hash" VARCHAR(64),
ADD COLUMN     "creation_key" VARCHAR(120),
ADD COLUMN     "etapa_contractual" "ProspectoEtapaContractual",
ADD COLUMN     "folio" TEXT,
ADD COLUMN     "notaria_id" UUID,
ADD COLUMN     "transicion_actual_id" UUID,
ADD COLUMN     "version_operativa" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "cotizaciones" ADD COLUMN     "fuente_notarial_id" UUID;

-- CreateTable
CREATE TABLE "prospecto_transiciones" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "prospecto_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "etapa_anterior" "ProspectoEtapaContractual",
    "etapa_nueva" "ProspectoEtapaContractual" NOT NULL,
    "hito_intermedio" "ProspectoEtapaContractual",
    "effective_at" TIMESTAMP(3) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accion" VARCHAR(60) NOT NULL,
    "procedencia" VARCHAR(60) NOT NULL,
    "evidencia" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,

    CONSTRAINT "prospecto_transiciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospecto_fuentes_notariales" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "prospecto_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "notaria_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origen" VARCHAR(60) NOT NULL,
    "motivo" TEXT NOT NULL,
    "sustituye_id" UUID,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,

    CONSTRAINT "prospecto_fuentes_notariales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_prospecto_transition_actor" ON "prospecto_transiciones"("organization_id", "actor_id");

-- CreateIndex
CREATE INDEX "idx_prospecto_transition_history" ON "prospecto_transiciones"("prospecto_id", "organization_id", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_prospecto_transition_key" ON "prospecto_transiciones"("organization_id", "prospecto_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_prospecto_transition_version" ON "prospecto_transiciones"("prospecto_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "prospecto_fuentes_notariales_sustituye_id_key" ON "prospecto_fuentes_notariales"("sustituye_id");

-- CreateIndex
CREATE INDEX "idx_prospecto_source_actor" ON "prospecto_fuentes_notariales"("organization_id", "actor_id");

-- CreateIndex
CREATE INDEX "idx_prospecto_source_document" ON "prospecto_fuentes_notariales"("documento_id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_prospecto_source_notary" ON "prospecto_fuentes_notariales"("notaria_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_prospecto_source_key" ON "prospecto_fuentes_notariales"("organization_id", "prospecto_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_prospecto_source_version" ON "prospecto_fuentes_notariales"("prospecto_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_prospecto_source_document" ON "prospecto_fuentes_notariales"("prospecto_id", "documento_id");

-- CreateIndex
CREATE UNIQUE INDEX "prospectos_folio_key" ON "prospectos"("folio");

-- CreateIndex
CREATE INDEX "idx_prospecto_notaria_org" ON "prospectos"("notaria_id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_prospecto_current_transition" ON "prospectos"("transicion_actual_id");

-- CreateIndex
CREATE INDEX "idx_prospecto_contract_stage" ON "prospectos"("organization_id", "etapa_contractual");

-- CreateIndex
CREATE UNIQUE INDEX "uq_prospecto_creation_key" ON "prospectos"("organization_id", "creation_key");

-- CreateIndex
CREATE INDEX "idx_cotizaciones_source_org" ON "cotizaciones"("fuente_notarial_id", "organization_id");

-- AddForeignKey
ALTER TABLE "prospectos" ADD CONSTRAINT "prospectos_notaria_id_fkey" FOREIGN KEY ("notaria_id") REFERENCES "notarias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospectos" ADD CONSTRAINT "prospectos_transicion_actual_id_fkey" FOREIGN KEY ("transicion_actual_id") REFERENCES "prospecto_transiciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_transiciones" ADD CONSTRAINT "prospecto_transiciones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_transiciones" ADD CONSTRAINT "prospecto_transiciones_prospecto_id_fkey" FOREIGN KEY ("prospecto_id") REFERENCES "prospectos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_transiciones" ADD CONSTRAINT "prospecto_transiciones_organization_id_actor_id_fkey" FOREIGN KEY ("organization_id", "actor_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_fuentes_notariales" ADD CONSTRAINT "prospecto_fuentes_notariales_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_fuentes_notariales" ADD CONSTRAINT "prospecto_fuentes_notariales_prospecto_id_fkey" FOREIGN KEY ("prospecto_id") REFERENCES "prospectos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_fuentes_notariales" ADD CONSTRAINT "prospecto_fuentes_notariales_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_fuentes_notariales" ADD CONSTRAINT "prospecto_fuentes_notariales_notaria_id_fkey" FOREIGN KEY ("notaria_id") REFERENCES "notarias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_fuentes_notariales" ADD CONSTRAINT "prospecto_fuentes_notariales_organization_id_actor_id_fkey" FOREIGN KEY ("organization_id", "actor_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecto_fuentes_notariales" ADD CONSTRAINT "prospecto_fuentes_notariales_sustituye_id_fkey" FOREIGN KEY ("sustituye_id") REFERENCES "prospecto_fuentes_notariales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizaciones" ADD CONSTRAINT "cotizaciones_fuente_notarial_id_fkey" FOREIGN KEY ("fuente_notarial_id") REFERENCES "prospecto_fuentes_notariales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE prospectos ADD CONSTRAINT pro001_stage_has_fact CHECK
  ((etapa_contractual IS NULL) = (transicion_actual_id IS NULL));
ALTER TABLE prospectos ADD CONSTRAINT pro001_version_positive CHECK (version_operativa >= 0);
ALTER TABLE prospecto_transiciones ADD CONSTRAINT pro001_transition_shape CHECK (
  version > 0 AND length(btrim(idempotency_key)) > 0 AND length(payload_hash) = 64
  AND effective_at <= recorded_at
  AND (hito_intermedio IS NULL OR
    (accion = 'REGISTRAR_ENVIO' AND hito_intermedio = 'SOLICITUD_ENVIADA_NOTARIA'
      AND etapa_anterior = 'LISTO_PARA_SOLICITAR' AND etapa_nueva = 'EN_ESPERA_COTIZACION'))
);
ALTER TABLE prospecto_fuentes_notariales ADD CONSTRAINT pro001_source_shape CHECK (
  version > 0 AND length(btrim(motivo)) > 0 AND length(btrim(idempotency_key)) > 0
  AND length(payload_hash) = 64 AND received_at <= recorded_at
  AND ((version = 1) = (sustituye_id IS NULL))
);

-- Reuse the existing same-organization enforcement, including nullable legacy parents.
DO $$
DECLARE rel RECORD;
BEGIN
  FOR rel IN SELECT * FROM (VALUES
    ('prospectos','notarias','notaria_id'),
    ('prospectos','prospecto_transiciones','transicion_actual_id'),
    ('prospecto_transiciones','prospectos','prospecto_id'),
    ('prospecto_fuentes_notariales','prospectos','prospecto_id'),
    ('prospecto_fuentes_notariales','documentos','documento_id'),
    ('prospecto_fuentes_notariales','notarias','notaria_id'),
    ('prospecto_fuentes_notariales','prospecto_fuentes_notariales','sustituye_id'),
    ('cotizaciones','prospecto_fuentes_notariales','fuente_notarial_id')
  ) AS r(child_table,parent_table,fk_column)
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON pravia_os.%I FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization(%L,%L)',
      'pro001_org_' || rel.child_table || '_' || rel.fk_column, rel.child_table, rel.parent_table, rel.fk_column);
  END LOOP;
END $$;

CREATE FUNCTION pravia_os.pro001_immutable_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PRO001_FACT_IMMUTABLE' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER pro001_transition_immutable BEFORE UPDATE OR DELETE ON prospecto_transiciones
  FOR EACH ROW EXECUTE FUNCTION pravia_os.pro001_immutable_fact();
CREATE TRIGGER pro001_source_immutable BEFORE UPDATE OR DELETE ON prospecto_fuentes_notariales
  FOR EACH ROW EXECUTE FUNCTION pravia_os.pro001_immutable_fact();

CREATE FUNCTION pravia_os.pro001_source_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous pravia_os.prospecto_fuentes_notariales;
BEGIN
  IF NEW.sustituye_id IS NOT NULL THEN
    SELECT * INTO previous FROM pravia_os.prospecto_fuentes_notariales WHERE id = NEW.sustituye_id;
    IF previous.prospecto_id IS DISTINCT FROM NEW.prospecto_id
      OR previous.notaria_id IS DISTINCT FROM NEW.notaria_id
      OR previous.received_at IS DISTINCT FROM NEW.received_at
      OR NEW.version <> previous.version + 1 THEN
      RAISE EXCEPTION 'PRO001_SOURCE_HISTORY_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pro001_source_history BEFORE INSERT ON prospecto_fuentes_notariales
  FOR EACH ROW EXECUTE FUNCTION pravia_os.pro001_source_integrity();

CREATE FUNCTION pravia_os.pro001_current_fact_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p pravia_os.prospectos; fact pravia_os.prospecto_transiciones;
BEGIN
  IF TG_TABLE_NAME = 'prospectos' THEN
    SELECT * INTO p FROM pravia_os.prospectos WHERE id = NEW.id;
  ELSE
    SELECT * INTO p FROM pravia_os.prospectos WHERE id = NEW.prospecto_id;
    IF p.transicion_actual_id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'PRO001_ORPHAN_TRANSITION' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF p.transicion_actual_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO fact FROM pravia_os.prospecto_transiciones WHERE id = p.transicion_actual_id;
  IF fact.prospecto_id IS DISTINCT FROM p.id OR fact.organization_id IS DISTINCT FROM p.organization_id
    OR fact.etapa_nueva IS DISTINCT FROM p.etapa_contractual OR fact.version > p.version_operativa THEN
    RAISE EXCEPTION 'PRO001_CURRENT_FACT_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER pro001_current_fact AFTER INSERT OR UPDATE ON prospectos
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pravia_os.pro001_current_fact_integrity();
CREATE CONSTRAINT TRIGGER pro001_atomic_transition AFTER INSERT ON prospecto_transiciones
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pravia_os.pro001_current_fact_integrity();

CREATE FUNCTION pravia_os.pro001_quote_source_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source pravia_os.prospecto_fuentes_notariales;
BEGIN
  IF NEW.fuente_notarial_id IS NOT NULL THEN
    SELECT * INTO source FROM pravia_os.prospecto_fuentes_notariales WHERE id = NEW.fuente_notarial_id;
    IF source.prospecto_id IS DISTINCT FROM NEW.prospecto_id OR source.notaria_id IS DISTINCT FROM NEW.notaria_id THEN
      RAISE EXCEPTION 'PRO001_QUOTE_SOURCE_MISMATCH' USING ERRCODE = '23514';
    END IF;
    IF NEW.estado::text = 'ENVIADA_NOTARIA' THEN
      RAISE EXCEPTION 'PRO001_NOTARY_SOURCE_ALREADY_RECEIVED' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.fuente_notarial_id IS NOT NULL AND
    (NEW.fuente_notarial_id IS DISTINCT FROM OLD.fuente_notarial_id OR NEW.prospecto_id IS DISTINCT FROM OLD.prospecto_id) THEN
    RAISE EXCEPTION 'PRO001_QUOTE_ORIGIN_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pro001_quote_origin BEFORE INSERT OR UPDATE ON cotizaciones
  FOR EACH ROW EXECUTE FUNCTION pravia_os.pro001_quote_source_integrity();
