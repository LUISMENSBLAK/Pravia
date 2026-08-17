-- Fase 8 Riesgos/UIF: evolución aditiva del motor de cumplimiento existente.
-- No elimina ni reescribe revisiones, snapshots, expedientes, comparecientes o evidencia histórica.

ALTER TABLE pravia_os.compliance_rule_sets
  ADD COLUMN IF NOT EXISTS fundamento TEXT,
  ADD COLUMN IF NOT EXISTS articulo TEXT,
  ADD COLUMN IF NOT EXISTS fraccion TEXT,
  ADD COLUMN IF NOT EXISTS inciso TEXT,
  ADD COLUMN IF NOT EXISTS fecha_entrada_vigor TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS checksum TEXT,
  ADD COLUMN IF NOT EXISTS notas_transicion TEXT;

ALTER TABLE pravia_os.compliance_evidence
  ADD COLUMN IF NOT EXISTS retention_until TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS retired_by_id UUID,
  ADD COLUMN IF NOT EXISTS retirement_reason TEXT;

CREATE TABLE IF NOT EXISTS pravia_os.uma_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  daily_value_mxn DECIMAL(12,2) NOT NULL CHECK (daily_value_mxn > 0),
  effective_from TIMESTAMP(3) NOT NULL,
  effective_to TIMESTAMP(3),
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  published_at TIMESTAMP(3),
  checksum TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uma_values_year_effective_from_key UNIQUE (year, effective_from),
  CONSTRAINT uma_values_period_check CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- Catálogo normativo, no datos de negocio ni fixtures productivos.
INSERT INTO pravia_os.uma_values
  (year, daily_value_mxn, effective_from, effective_to, source_name, source_url, published_at)
VALUES
  (2025, 113.14, TIMESTAMP '2025-02-01 00:00:00', TIMESTAMP '2026-01-31 23:59:59.999', 'INEGI — UMA 2025', 'https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2025/uma/uma2025.pdf', TIMESTAMP '2025-01-09 00:00:00'),
  (2026, 117.31, TIMESTAMP '2026-02-01 00:00:00', TIMESTAMP '2027-01-31 23:59:59.999', 'INEGI — UMA 2026', 'https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/uma/uma2026.pdf', TIMESTAMP '2026-01-09 00:00:00')
ON CONFLICT (year, effective_from) DO NOTHING;

CREATE TABLE IF NOT EXISTS pravia_os.compliance_party_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL,
  compareciente_id UUID NOT NULL,
  role TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  snapshot_version INTEGER NOT NULL DEFAULT 1,
  captured_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT compliance_party_snapshots_review_party_role_key UNIQUE (review_id, compareciente_id, role)
);

CREATE TABLE IF NOT EXISTS pravia_os.compliance_beneficial_owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL,
  compareciente_id UUID,
  status TEXT NOT NULL DEFAULT 'PENDIENTE_DE_CONFIRMAR',
  control_type TEXT,
  documented_percentage DECIMAL(7,4),
  declaration TEXT,
  support_document_id UUID,
  source TEXT,
  confirmed_by_id UUID,
  confirmed_at TIMESTAMP(3),
  snapshot JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT compliance_beneficial_owner_percentage_check CHECK (documented_percentage IS NULL OR (documented_percentage >= 0 AND documented_percentage <= 100))
);

CREATE TABLE IF NOT EXISTS pravia_os.compliance_pep_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL,
  compareciente_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'NO_EVALUADO',
  declaration TEXT,
  official_source TEXT,
  official_query_at TIMESTAMP(3),
  evidence_document_id UUID,
  human_reviewed_by_id UUID,
  human_reviewed_at TIMESTAMP(3),
  notes TEXT,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT compliance_pep_reviews_review_party_key UNIQUE (review_id, compareciente_id)
);

CREATE TABLE IF NOT EXISTS pravia_os.compliance_screening_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL,
  compareciente_id UUID NOT NULL,
  provider TEXT NOT NULL,
  provider_version TEXT,
  status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  queried_at TIMESTAMP(3),
  query_snapshot JSONB,
  match_evidence JSONB,
  reviewed_by_id UUID,
  reviewed_at TIMESTAMP(3),
  human_decision TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pravia_os.compliance_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL,
  amount_mxn DECIMAL(18,2) NOT NULL CHECK (amount_mxn >= 0),
  method TEXT NOT NULL,
  payment_date TIMESTAMP(3) NOT NULL,
  instrument TEXT,
  institution TEXT,
  reference TEXT,
  masked_account TEXT,
  evidence_document_id UUID,
  source TEXT,
  created_by_id UUID NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS pravia_os.compliance_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL,
  type TEXT NOT NULL,
  legal_basis TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  rule_status TEXT NOT NULL,
  origin_date TIMESTAMP(3) NOT NULL,
  due_at TIMESTAMP(3),
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'POR_DETERMINAR',
  responsible_id UUID,
  checklist JSONB NOT NULL,
  external_filed_at TIMESTAMP(3),
  external_folio TEXT,
  external_receipt_id UUID,
  external_confirmed_by UUID,
  notes TEXT,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT compliance_obligation_external_confirmation_check CHECK (
    status <> 'PRESENTADO_EXTERNAMENTE'
    OR (external_filed_at IS NOT NULL AND external_folio IS NOT NULL AND external_receipt_id IS NOT NULL AND external_confirmed_by IS NOT NULL)
  ),
  CONSTRAINT compliance_obligations_review_type_key UNIQUE (review_id, type)
);

CREATE TABLE IF NOT EXISTS pravia_os.compliance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  actor_id UUID NOT NULL,
  summary TEXT NOT NULL,
  detail JSONB,
  correlation_id TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pravia_os.compliance_ai_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL,
  proposal_type TEXT NOT NULL,
  content JSONB NOT NULL,
  source_document_id UUID,
  source_page INTEGER,
  confidence DECIMAL(7,6),
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  requested_by_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROPUESTA_REQUIERE_CONFIRMACION',
  decided_by_id UUID,
  decided_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT compliance_ai_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_evidence_retired_by_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_evidence ADD CONSTRAINT compliance_evidence_retired_by_id_fkey FOREIGN KEY (retired_by_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_party_snapshots_review_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_party_snapshots ADD CONSTRAINT compliance_party_snapshots_review_id_fkey FOREIGN KEY (review_id) REFERENCES pravia_os.compliance_reviews(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_party_snapshots ADD CONSTRAINT compliance_party_snapshots_compareciente_id_fkey FOREIGN KEY (compareciente_id) REFERENCES pravia_os.comparecientes(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_beneficial_owners_review_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_beneficial_owners ADD CONSTRAINT compliance_beneficial_owners_review_id_fkey FOREIGN KEY (review_id) REFERENCES pravia_os.compliance_reviews(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_beneficial_owners ADD CONSTRAINT compliance_beneficial_owners_compareciente_id_fkey FOREIGN KEY (compareciente_id) REFERENCES pravia_os.comparecientes(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_beneficial_owners ADD CONSTRAINT compliance_beneficial_owners_support_document_id_fkey FOREIGN KEY (support_document_id) REFERENCES pravia_os.documentos(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_beneficial_owners ADD CONSTRAINT compliance_beneficial_owners_confirmed_by_id_fkey FOREIGN KEY (confirmed_by_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_pep_reviews_review_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_pep_reviews ADD CONSTRAINT compliance_pep_reviews_review_id_fkey FOREIGN KEY (review_id) REFERENCES pravia_os.compliance_reviews(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_pep_reviews ADD CONSTRAINT compliance_pep_reviews_compareciente_id_fkey FOREIGN KEY (compareciente_id) REFERENCES pravia_os.comparecientes(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_pep_reviews ADD CONSTRAINT compliance_pep_reviews_evidence_document_id_fkey FOREIGN KEY (evidence_document_id) REFERENCES pravia_os.documentos(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_pep_reviews ADD CONSTRAINT compliance_pep_reviews_human_reviewed_by_id_fkey FOREIGN KEY (human_reviewed_by_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_screening_results_review_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_screening_results ADD CONSTRAINT compliance_screening_results_review_id_fkey FOREIGN KEY (review_id) REFERENCES pravia_os.compliance_reviews(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_screening_results ADD CONSTRAINT compliance_screening_results_compareciente_id_fkey FOREIGN KEY (compareciente_id) REFERENCES pravia_os.comparecientes(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_screening_results ADD CONSTRAINT compliance_screening_results_reviewed_by_id_fkey FOREIGN KEY (reviewed_by_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_payments_review_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_payments ADD CONSTRAINT compliance_payments_review_id_fkey FOREIGN KEY (review_id) REFERENCES pravia_os.compliance_reviews(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_payments ADD CONSTRAINT compliance_payments_evidence_document_id_fkey FOREIGN KEY (evidence_document_id) REFERENCES pravia_os.documentos(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_payments ADD CONSTRAINT compliance_payments_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_obligations_review_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_obligations ADD CONSTRAINT compliance_obligations_review_id_fkey FOREIGN KEY (review_id) REFERENCES pravia_os.compliance_reviews(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_obligations ADD CONSTRAINT compliance_obligations_responsible_id_fkey FOREIGN KEY (responsible_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_obligations ADD CONSTRAINT compliance_obligations_external_receipt_id_fkey FOREIGN KEY (external_receipt_id) REFERENCES pravia_os.documentos(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_obligations ADD CONSTRAINT compliance_obligations_external_confirmed_by_fkey FOREIGN KEY (external_confirmed_by) REFERENCES pravia_os.users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_events_review_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_events ADD CONSTRAINT compliance_events_review_id_fkey FOREIGN KEY (review_id) REFERENCES pravia_os.compliance_reviews(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_events ADD CONSTRAINT compliance_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_ai_proposals_review_id_fkey') THEN
    ALTER TABLE pravia_os.compliance_ai_proposals ADD CONSTRAINT compliance_ai_proposals_review_id_fkey FOREIGN KEY (review_id) REFERENCES pravia_os.compliance_reviews(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_ai_proposals ADD CONSTRAINT compliance_ai_proposals_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES pravia_os.documentos(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_ai_proposals ADD CONSTRAINT compliance_ai_proposals_requested_by_id_fkey FOREIGN KEY (requested_by_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT;
    ALTER TABLE pravia_os.compliance_ai_proposals ADD CONSTRAINT compliance_ai_proposals_decided_by_id_fkey FOREIGN KEY (decided_by_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS uma_values_effective_period_idx ON pravia_os.uma_values(effective_from, effective_to);
CREATE INDEX IF NOT EXISTS compliance_party_snapshots_compareciente_id_idx ON pravia_os.compliance_party_snapshots(compareciente_id);
CREATE INDEX IF NOT EXISTS compliance_beneficial_owners_review_status_idx ON pravia_os.compliance_beneficial_owners(review_id, status);
CREATE INDEX IF NOT EXISTS compliance_pep_reviews_status_idx ON pravia_os.compliance_pep_reviews(status);
CREATE INDEX IF NOT EXISTS compliance_screening_results_review_status_idx ON pravia_os.compliance_screening_results(review_id, status);
CREATE INDEX IF NOT EXISTS compliance_payments_review_payment_date_idx ON pravia_os.compliance_payments(review_id, payment_date);
CREATE INDEX IF NOT EXISTS compliance_obligations_review_status_idx ON pravia_os.compliance_obligations(review_id, status);
CREATE INDEX IF NOT EXISTS compliance_obligations_due_status_idx ON pravia_os.compliance_obligations(due_at, status);
CREATE INDEX IF NOT EXISTS compliance_events_review_created_idx ON pravia_os.compliance_events(review_id, created_at);
CREATE INDEX IF NOT EXISTS compliance_ai_proposals_review_created_idx ON pravia_os.compliance_ai_proposals(review_id, created_at);
