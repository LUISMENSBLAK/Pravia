-- ISR-001: cardinalidad operativa, tenant scope e idempotencia.
-- Aditiva. No cambia importes, snapshots, reglas, tarifas ni vínculos existentes.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pravia_os.calculos_isr
    WHERE expediente_id IS NOT NULL AND archived_at IS NULL
    GROUP BY expediente_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'ISR001_ACTIVE_LINK_CONFLICT: existen expedientes con más de un cálculo ISR activo; requiere clasificación humana antes de migrar';
  END IF;
END $$;

ALTER TABLE pravia_os.calculos_isr
  ADD COLUMN idempotency_key TEXT;

ALTER TABLE pravia_os.calculos_isr_versiones
  ADD COLUMN request_key TEXT;

ALTER TABLE pravia_os.calculos_isr_documentos
  ADD COLUMN idempotency_key TEXT,
  ADD COLUMN generated_from_version INTEGER,
  ADD COLUMN format_source TEXT;

CREATE UNIQUE INDEX uq_isr001_active_expediente
  ON pravia_os.calculos_isr (expediente_id)
  WHERE expediente_id IS NOT NULL AND archived_at IS NULL;

CREATE UNIQUE INDEX uq_isr001_create_idempotency
  ON pravia_os.calculos_isr (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX uq_isr001_calculation_request
  ON pravia_os.calculos_isr_versiones (organization_id, calculo_id, request_key)
  WHERE request_key IS NOT NULL;

CREATE UNIQUE INDEX uq_isr001_pdf_idempotency
  ON pravia_os.calculos_isr_documentos (organization_id, calculo_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_isr001_active_case_link
  ON pravia_os.calculos_isr (organization_id, expediente_id, archived_at);

CREATE INDEX idx_isr001_calculation_tenant
  ON pravia_os.calculos_isr_versiones (organization_id, calculo_id, calculated_at DESC);
