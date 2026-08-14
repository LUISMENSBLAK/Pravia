-- Fase 12: snapshots completos e historial humano inmutable. Cambio exclusivamente aditivo.
ALTER TABLE pravia_os.compliance_reviews
  ADD COLUMN IF NOT EXISTS rule_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS master_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS snapshot_captured_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS supersedes_review_id UUID;

-- Las filas históricas conservan su versión y se marcan explícitamente como snapshot legado.
UPDATE pravia_os.compliance_reviews r
SET rule_snapshot = jsonb_build_object(
      'id', rs.id,
      'tipo', rs.tipo,
      'clave', rs.clave,
      'version', r.rule_version_snapshot,
      'nombre', rs.nombre,
      'vigencia_desde', rs.vigencia_desde,
      'vigencia_hasta', rs.vigencia_hasta,
      'fuente_nombre', rs.fuente_nombre,
      'fuente_url', rs.fuente_url,
      'fuente_publicada_at', rs.fuente_publicada_at,
      'parametros', rs.parametros,
      'cuestionario', rs.cuestionario,
      'legacy_backfill', true
    )
FROM pravia_os.compliance_rule_sets rs
WHERE r.rule_set_id = rs.id AND r.rule_snapshot IS NULL;

UPDATE pravia_os.compliance_reviews
SET master_snapshot = jsonb_build_object(
  'legacy_backfill', true,
  'captured_at', created_at,
  'warning', 'El esquema anterior no conservaba un snapshot completo de master data.'
)
WHERE master_snapshot IS NULL;

ALTER TABLE pravia_os.compliance_reviews
  ALTER COLUMN rule_snapshot SET NOT NULL,
  ALTER COLUMN master_snapshot SET NOT NULL;

CREATE TABLE IF NOT EXISTS pravia_os.compliance_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL,
  decision TEXT NOT NULL,
  observaciones TEXT,
  resultado_snapshot JSONB NOT NULL,
  rule_snapshot JSONB NOT NULL,
  master_snapshot JSONB NOT NULL,
  decidido_por_id UUID NOT NULL,
  decidido_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_reviews_supersedes_review_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_reviews ADD CONSTRAINT compliance_reviews_supersedes_review_id_fkey FOREIGN KEY (supersedes_review_id) REFERENCES pravia_os.compliance_reviews(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_decisions_review_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_decisions ADD CONSTRAINT compliance_decisions_review_id_fkey FOREIGN KEY (review_id) REFERENCES pravia_os.compliance_reviews(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_decisions_decidido_por_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_decisions ADD CONSTRAINT compliance_decisions_decidido_por_id_fkey FOREIGN KEY (decidido_por_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS compliance_reviews_supersedes_review_id_idx ON pravia_os.compliance_reviews(supersedes_review_id);
CREATE INDEX IF NOT EXISTS compliance_decisions_review_id_decidido_at_idx ON pravia_os.compliance_decisions(review_id, decidido_at);
