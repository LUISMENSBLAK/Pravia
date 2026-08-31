-- EXP-009 evoluciona la proyección operativa existente. No crea una segunda
-- auditoría ni altera el historial técnico de AuditLog.
ALTER TYPE pravia_os."TipoActividad" ADD VALUE IF NOT EXISTS 'NOTA';

DO $$ BEGIN
  CREATE TYPE pravia_os."ExpedienteActividadCategoria" AS ENUM ('OPERACION', 'DOCUMENTOS', 'FINANZAS', 'SISTEMA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE pravia_os.expediente_actividades
  ADD COLUMN IF NOT EXISTS categoria pravia_os."ExpedienteActividadCategoria" NOT NULL DEFAULT 'SISTEMA',
  ADD COLUMN IF NOT EXISTS valores_anteriores JSONB,
  ADD COLUMN IF NOT EXISTS valores_nuevos JSONB,
  ADD COLUMN IF NOT EXISTS seccion_relacionada TEXT,
  ADD COLUMN IF NOT EXISTS entidad_relacionada TEXT,
  ADD COLUMN IF NOT EXISTS entidad_relacionada_id UUID,
  ADD COLUMN IF NOT EXISTS correlation_id UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS es_nota_manual BOOLEAN NOT NULL DEFAULT false;

-- Backfill determinista: clasifica sólo por tipos y fuentes operativas ya
-- persistidas. No inventa hechos, autores, fechas ni vínculos históricos.
UPDATE pravia_os.expediente_actividades
SET categoria = CASE
  WHEN tipo = 'DOCUMENTO' THEN 'DOCUMENTOS'::pravia_os."ExpedienteActividadCategoria"
  WHEN tipo = 'PAGO' THEN 'FINANZAS'::pravia_os."ExpedienteActividadCategoria"
  WHEN metadatos->>'source' IN ('EXP-007', 'EXP-008') THEN 'FINANZAS'::pravia_os."ExpedienteActividadCategoria"
  WHEN metadatos->>'source' IN ('EXP-004', 'EXP-006') THEN 'DOCUMENTOS'::pravia_os."ExpedienteActividadCategoria"
  WHEN tipo IN ('CAMBIO_ESTATUS', 'CAMBIO_ETAPA', 'SEGUIMIENTO', 'COMPARECIENTE')
    OR metadatos->>'source' IN ('EXP-001', 'EXP-002', 'EXP-003', 'EXP-005', 'PRD-001')
    THEN 'OPERACION'::pravia_os."ExpedienteActividadCategoria"
  ELSE 'SISTEMA'::pravia_os."ExpedienteActividadCategoria"
END;

CREATE OR REPLACE FUNCTION pravia_os.classify_exp009_activity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.es_nota_manual OR NEW.tipo::text = 'NOTA' THEN
    NEW.categoria := 'OPERACION';
  ELSIF NEW.tipo = 'DOCUMENTO' THEN
    NEW.categoria := 'DOCUMENTOS';
  ELSIF NEW.tipo = 'PAGO' THEN
    NEW.categoria := 'FINANZAS';
  ELSIF NEW.metadatos->>'source' IN ('EXP-007', 'EXP-008') THEN
    NEW.categoria := 'FINANZAS';
  ELSIF NEW.metadatos->>'source' IN ('EXP-004', 'EXP-006') THEN
    NEW.categoria := 'DOCUMENTOS';
  ELSIF NEW.tipo IN ('CAMBIO_ESTATUS', 'CAMBIO_ETAPA', 'SEGUIMIENTO', 'COMPARECIENTE')
    OR NEW.metadatos->>'source' IN ('EXP-001', 'EXP-002', 'EXP-003', 'EXP-005', 'PRD-001') THEN
    NEW.categoria := 'OPERACION';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_classify_exp009_activity ON pravia_os.expediente_actividades;
CREATE TRIGGER trg_classify_exp009_activity
  BEFORE INSERT ON pravia_os.expediente_actividades
  FOR EACH ROW EXECUTE FUNCTION pravia_os.classify_exp009_activity();

-- El cutover multitenant debe haber asignado ownership antes de EXP-009. La
-- migración se detiene en vez de inferir o asignar silenciosamente un tenant.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pravia_os.expediente_actividades WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'EXP009_ACTIVITY_TENANT_BACKFILL_REQUIRED';
  END IF;
END $$;

ALTER TABLE pravia_os.expediente_actividades
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE pravia_os.expediente_actividades
  DROP CONSTRAINT IF EXISTS expediente_actividades_organization_id_fkey;
ALTER TABLE pravia_os.expediente_actividades
  ADD CONSTRAINT expediente_actividades_organization_id_fkey
  FOREIGN KEY (organization_id)
  REFERENCES pravia_os.organizations(id)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

ALTER TABLE pravia_os.expediente_actividades
  DROP CONSTRAINT IF EXISTS expediente_actividades_expediente_id_fkey;
ALTER TABLE pravia_os.expediente_actividades
  ADD CONSTRAINT expediente_actividades_expediente_tenant_fkey
  FOREIGN KEY (expediente_id, organization_id)
  REFERENCES pravia_os.expedientes(id, organization_id)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_exp_actividad_idempotency
  ON pravia_os.expediente_actividades(organization_id, expediente_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_exp_actividad_tenant_timeline
  ON pravia_os.expediente_actividades(organization_id, expediente_id, created_at);
CREATE INDEX IF NOT EXISTS idx_exp_actividad_tenant_category
  ON pravia_os.expediente_actividades(organization_id, expediente_id, categoria, created_at);

-- Reversión segura: se puede retirar el contrato extendido sólo si no existen
-- notas manuales. Los eventos históricos base permanecen en la tabla original.
COMMENT ON TABLE pravia_os.expediente_actividades IS
  'EXP-009 operational timeline projection. Separate from technical AuditLog; manual notes are immutable.';
