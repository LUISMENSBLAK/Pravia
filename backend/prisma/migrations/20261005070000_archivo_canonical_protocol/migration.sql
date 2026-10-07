-- Archivo: un registro canónico por instrumento y consumos excepcionales de folios.
-- Los valores históricos en expedientes permanecen intactos; se concilian
-- explícitamente antes de asignar un nuevo registro canónico.
CREATE TABLE pravia_os.archivo_registros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES pravia_os.organizations(id),
  expediente_id UUID UNIQUE,
  clase VARCHAR(24) NOT NULL,
  numero_escritura BIGINT,
  folio_inicio BIGINT NOT NULL,
  folio_fin BIGINT NOT NULL,
  fecha_instrumento DATE NOT NULL,
  libro_tomo VARCHAR(80),
  no_paso BOOLEAN NOT NULL DEFAULT FALSE,
  motivo VARCHAR(500),
  created_by_id UUID NOT NULL REFERENCES pravia_os.users(id),
  updated_by_id UUID NOT NULL REFERENCES pravia_os.users(id),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT archivo_clase_check CHECK (
    (clase = 'INSTRUMENTO' AND expediente_id IS NOT NULL AND numero_escritura IS NOT NULL AND motivo IS NULL)
    OR (clase = 'INUTILIZADO' AND expediente_id IS NULL AND numero_escritura IS NULL AND no_paso = FALSE AND NULLIF(BTRIM(motivo), '') IS NOT NULL)
  ),
  CONSTRAINT archivo_rango_check CHECK (folio_inicio > 0 AND folio_fin >= folio_inicio),
  CONSTRAINT archivo_numero_check CHECK (numero_escritura IS NULL OR numero_escritura > 0),
  CONSTRAINT archivo_expediente_tenant_fkey FOREIGN KEY (expediente_id, organization_id)
    REFERENCES pravia_os.expedientes(id, organization_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_archivo_numero_tenant ON pravia_os.archivo_registros(organization_id, numero_escritura);
CREATE UNIQUE INDEX uq_archivo_exp_tenant ON pravia_os.archivo_registros(expediente_id, organization_id);
CREATE INDEX idx_archivo_folios_tenant ON pravia_os.archivo_registros(organization_id, folio_inicio, folio_fin);

-- La fila de organización serializa incluso las escrituras ajenas a la API.
-- Ningún insert/update concurrente puede atravesar la validación de rango.
CREATE FUNCTION pravia_os.guard_archivo_registro() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_number BIGINT;
  previous_number BIGINT;
  next_number BIGINT;
  previous_end BIGINT;
  next_start BIGINT;
  previous_date DATE;
  next_date DATE;
BEGIN
  PERFORM 1 FROM pravia_os.organizations WHERE id = NEW.organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ARCHIVO_ORGANIZATION_INVALID' USING ERRCODE = '23503'; END IF;

  IF TG_OP = 'UPDATE' AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.expediente_id IS DISTINCT FROM OLD.expediente_id OR NEW.clase IS DISTINCT FROM OLD.clase) THEN
    RAISE EXCEPTION 'ARCHIVO_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pravia_os.archivo_registros other
    WHERE other.organization_id = NEW.organization_id AND other.id <> NEW.id
      AND other.folio_inicio <= NEW.folio_fin AND other.folio_fin >= NEW.folio_inicio
  ) THEN RAISE EXCEPTION 'ARCHIVO_FOLIOS_OVERLAP' USING ERRCODE = '23P01'; END IF;

  SELECT MAX(folio_fin) INTO previous_end FROM pravia_os.archivo_registros
    WHERE organization_id = NEW.organization_id AND id <> NEW.id AND folio_fin < NEW.folio_inicio;
  SELECT MIN(folio_inicio) INTO next_start FROM pravia_os.archivo_registros
    WHERE organization_id = NEW.organization_id AND id <> NEW.id AND folio_inicio > NEW.folio_fin;
  IF previous_end IS NOT NULL AND previous_end + 1 <> NEW.folio_inicio THEN
    RAISE EXCEPTION 'ARCHIVO_FOLIO_SEQUENCE_GAP' USING ERRCODE = '23514';
  END IF;
  IF next_start IS NOT NULL AND NEW.folio_fin + 1 <> next_start THEN
    RAISE EXCEPTION 'ARCHIVO_FOLIO_SEQUENCE_GAP' USING ERRCODE = '23514';
  END IF;

  IF NEW.clase = 'INSTRUMENTO' THEN
    SELECT MAX(numero_escritura) INTO last_number FROM pravia_os.archivo_registros
      WHERE organization_id = NEW.organization_id AND id <> NEW.id AND clase = 'INSTRUMENTO';
    SELECT MAX(numero_escritura) INTO previous_number FROM pravia_os.archivo_registros
      WHERE organization_id = NEW.organization_id AND id <> NEW.id AND clase = 'INSTRUMENTO' AND numero_escritura < NEW.numero_escritura;
    SELECT MIN(numero_escritura) INTO next_number FROM pravia_os.archivo_registros
      WHERE organization_id = NEW.organization_id AND id <> NEW.id AND clase = 'INSTRUMENTO' AND numero_escritura > NEW.numero_escritura;
    IF TG_OP = 'INSERT' AND last_number IS NOT NULL AND NEW.numero_escritura <> last_number + 1 THEN
      RAISE EXCEPTION 'ARCHIVO_ESCRITURA_SEQUENCE_GAP' USING ERRCODE = '23514';
    END IF;
    IF previous_number IS NOT NULL AND previous_number + 1 <> NEW.numero_escritura THEN
      RAISE EXCEPTION 'ARCHIVO_ESCRITURA_SEQUENCE_GAP' USING ERRCODE = '23514';
    END IF;
    IF next_number IS NOT NULL AND NEW.numero_escritura + 1 <> next_number THEN
      RAISE EXCEPTION 'ARCHIVO_ESCRITURA_SEQUENCE_GAP' USING ERRCODE = '23514';
    END IF;
    SELECT fecha_instrumento INTO previous_date FROM pravia_os.archivo_registros
      WHERE organization_id = NEW.organization_id AND id <> NEW.id AND clase = 'INSTRUMENTO'
        AND numero_escritura < NEW.numero_escritura ORDER BY numero_escritura DESC LIMIT 1;
    SELECT fecha_instrumento INTO next_date FROM pravia_os.archivo_registros
      WHERE organization_id = NEW.organization_id AND id <> NEW.id AND clase = 'INSTRUMENTO'
        AND numero_escritura > NEW.numero_escritura ORDER BY numero_escritura LIMIT 1;
    IF (previous_date IS NOT NULL AND NEW.fecha_instrumento < previous_date)
      OR (next_date IS NOT NULL AND NEW.fecha_instrumento > next_date) THEN
      RAISE EXCEPTION 'ARCHIVO_DATE_SEQUENCE_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_archivo_registro BEFORE INSERT OR UPDATE ON pravia_os.archivo_registros
FOR EACH ROW EXECUTE FUNCTION pravia_os.guard_archivo_registro();

CREATE FUNCTION pravia_os.sync_archivo_expediente() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.clase = 'INSTRUMENTO' THEN
    UPDATE pravia_os.expedientes SET
      numero_escritura = NEW.numero_escritura::TEXT,
      folio_desde = NEW.folio_inicio::TEXT,
      folio_hasta = NEW.folio_fin::TEXT,
      fecha_escritura = NEW.fecha_instrumento::TIMESTAMP,
      fecha_real_firma = NEW.fecha_instrumento::TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.expediente_id AND organization_id = NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_archivo_expediente AFTER INSERT OR UPDATE ON pravia_os.archivo_registros
FOR EACH ROW EXECUTE FUNCTION pravia_os.sync_archivo_expediente();

CREATE FUNCTION pravia_os.guard_archivo_summary() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE rec RECORD;
BEGIN
  SELECT numero_escritura, folio_inicio, folio_fin, fecha_instrumento INTO rec
    FROM pravia_os.archivo_registros
    WHERE expediente_id = NEW.id AND organization_id = NEW.organization_id AND clase = 'INSTRUMENTO';
  IF FOUND AND (NEW.numero_escritura IS DISTINCT FROM rec.numero_escritura::TEXT
    OR NEW.folio_desde IS DISTINCT FROM rec.folio_inicio::TEXT
    OR NEW.folio_hasta IS DISTINCT FROM rec.folio_fin::TEXT
    OR NEW.fecha_escritura::DATE IS DISTINCT FROM rec.fecha_instrumento
    OR NEW.fecha_real_firma::DATE IS DISTINCT FROM rec.fecha_instrumento) THEN
    RAISE EXCEPTION 'ARCHIVO_SUMMARY_READ_ONLY' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_archivo_summary BEFORE UPDATE ON pravia_os.expedientes
FOR EACH ROW EXECUTE FUNCTION pravia_os.guard_archivo_summary();
