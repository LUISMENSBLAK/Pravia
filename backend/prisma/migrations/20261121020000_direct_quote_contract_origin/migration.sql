-- Client update 4: explicit direct origins, without backfill or historical renumbering.
CREATE OR REPLACE FUNCTION pravia_os.cot001_current_fact_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF q.organization_id IS NULL OR q.user_id IS NULL THEN
    RAISE EXCEPTION 'COT001_CANONICAL_ORIGIN_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF q.prospecto_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM pravia_os.cotizacion_transiciones origin
    WHERE origin.cotizacion_id = q.id AND origin.organization_id = q.organization_id
      AND origin.accion = 'CREAR' AND origin.procedencia = 'ALTA_DIRECTA'
      AND origin.etapa_anterior IS NULL AND origin.etapa_nueva::text = 'BORRADOR'
      AND origin.evidencia->>'origin' = 'DIRECT'
  ) THEN
    RAISE EXCEPTION 'COT001_CANONICAL_ORIGIN_REQUIRED' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO fact FROM pravia_os.cotizacion_transiciones WHERE id = q.transicion_actual_id;
  IF NOT FOUND OR fact.cotizacion_id IS DISTINCT FROM q.id OR fact.organization_id IS DISTINCT FROM q.organization_id
    OR fact.etapa_nueva IS DISTINCT FROM q.etapa_contractual OR fact.version > q.version_operativa OR NOT fact.cambia_etapa THEN
    RAISE EXCEPTION 'COT001_CURRENT_FACT_INVALID' USING ERRCODE = '23514';
  END IF;
  projected := CASE q.etapa_contractual::text
    WHEN 'BORRADOR' THEN 'BORRADOR' WHEN 'EN_ELABORACION' THEN 'BORRADOR'
    WHEN 'ENVIADA_CLIENTE' THEN 'ENVIADA_CLIENTE' WHEN 'EN_SEGUIMIENTO' THEN 'EN_NEGOCIACION'
    WHEN 'ACEPTADA' THEN 'ACEPTADA' WHEN 'ACEPTO_ANTICIPO' THEN 'ACEPTADA'
    WHEN 'RECHAZADA' THEN 'RECHAZADA' WHEN 'SUSPENDIDA' THEN 'SUSPENDIDA'
    WHEN 'CANCELADA' THEN 'CANCELADA' WHEN 'CONVERTIDA_EXPEDIENTE' THEN 'CONVERTIDA_EXPEDIENTE'
    ELSE NULL END;
  IF projected IS NULL OR q.estado::text IS DISTINCT FROM projected THEN
    RAISE EXCEPTION 'COT001_LEGACY_PROJECTION_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE UNIQUE INDEX uq_cotizacion_direct_creation_key
  ON pravia_os.cotizacion_transiciones (organization_id, actor_id, idempotency_key)
  WHERE accion = 'CREAR' AND procedencia = 'ALTA_DIRECTA';
