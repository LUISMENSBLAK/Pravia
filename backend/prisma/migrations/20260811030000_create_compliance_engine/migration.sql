-- Additive, versioned compliance engine. Existing expedientes and documents remain unchanged.

CREATE TABLE IF NOT EXISTS pravia_os.compliance_rule_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL,
  clave TEXT NOT NULL,
  version TEXT NOT NULL,
  nombre TEXT NOT NULL,
  estatus TEXT NOT NULL DEFAULT 'BORRADOR',
  vigencia_desde TIMESTAMP(3) NOT NULL,
  vigencia_hasta TIMESTAMP(3),
  fuente_nombre TEXT NOT NULL,
  fuente_url TEXT NOT NULL,
  fuente_publicada_at TIMESTAMP(3),
  parametros JSONB NOT NULL,
  cuestionario JSONB NOT NULL,
  notas TEXT,
  creado_por_id UUID NOT NULL,
  aprobado_por_id UUID,
  aprobado_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pravia_os.compliance_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expediente_id UUID NOT NULL,
  rule_set_id UUID NOT NULL,
  tipo TEXT NOT NULL,
  estatus TEXT NOT NULL DEFAULT 'BORRADOR',
  fecha_operacion TIMESTAMP(3),
  rule_version_snapshot TEXT NOT NULL,
  cuestionario_json JSONB NOT NULL,
  resultado_json JSONB,
  explicacion TEXT,
  creado_por_id UUID NOT NULL,
  revisado_por_id UUID,
  revisado_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pravia_os.compliance_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL,
  documento_id UUID NOT NULL,
  tipo_evidencia TEXT NOT NULL,
  observaciones TEXT,
  agregado_por_id UUID NOT NULL,
  estatus TEXT NOT NULL DEFAULT 'ACTIVO',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_rule_sets_creado_por_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_rule_sets ADD CONSTRAINT compliance_rule_sets_creado_por_id_fkey FOREIGN KEY (creado_por_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_rule_sets_aprobado_por_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_rule_sets ADD CONSTRAINT compliance_rule_sets_aprobado_por_id_fkey FOREIGN KEY (aprobado_por_id) REFERENCES pravia_os.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_reviews_expediente_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_reviews ADD CONSTRAINT compliance_reviews_expediente_id_fkey FOREIGN KEY (expediente_id) REFERENCES pravia_os.expedientes(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_reviews_rule_set_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_reviews ADD CONSTRAINT compliance_reviews_rule_set_id_fkey FOREIGN KEY (rule_set_id) REFERENCES pravia_os.compliance_rule_sets(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_reviews_creado_por_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_reviews ADD CONSTRAINT compliance_reviews_creado_por_id_fkey FOREIGN KEY (creado_por_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_reviews_revisado_por_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_reviews ADD CONSTRAINT compliance_reviews_revisado_por_id_fkey FOREIGN KEY (revisado_por_id) REFERENCES pravia_os.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_evidence_review_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_evidence ADD CONSTRAINT compliance_evidence_review_id_fkey FOREIGN KEY (review_id) REFERENCES pravia_os.compliance_reviews(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_evidence_documento_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_evidence ADD CONSTRAINT compliance_evidence_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES pravia_os.documentos(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_evidence_agregado_por_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_evidence ADD CONSTRAINT compliance_evidence_agregado_por_id_fkey FOREIGN KEY (agregado_por_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_rule_sets_tipo_clave_version_key') THEN
    ALTER TABLE pravia_os.compliance_rule_sets ADD CONSTRAINT compliance_rule_sets_tipo_clave_version_key UNIQUE (tipo, clave, version);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_evidence_review_id_documento_id_tipo_evidencia_key') THEN
    ALTER TABLE pravia_os.compliance_evidence ADD CONSTRAINT compliance_evidence_review_id_documento_id_tipo_evidencia_key UNIQUE (review_id, documento_id, tipo_evidencia);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS compliance_rule_sets_tipo_estatus_vigencia_idx ON pravia_os.compliance_rule_sets(tipo, estatus, vigencia_desde);
CREATE INDEX IF NOT EXISTS compliance_reviews_expediente_tipo_idx ON pravia_os.compliance_reviews(expediente_id, tipo);
CREATE INDEX IF NOT EXISTS compliance_reviews_estatus_created_at_idx ON pravia_os.compliance_reviews(estatus, created_at);
CREATE INDEX IF NOT EXISTS compliance_evidence_documento_id_idx ON pravia_os.compliance_evidence(documento_id);
