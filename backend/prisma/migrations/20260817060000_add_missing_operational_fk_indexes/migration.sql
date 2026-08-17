-- Add only the operational indexes required by existing foreign keys.
-- No data, column, constraint, or business-rule changes are performed here.

CREATE INDEX IF NOT EXISTS "idx_auth_sessions_membership_fk"
  ON "pravia_os"."auth_sessions" ("membership_id");

CREATE INDEX IF NOT EXISTS "idx_isr_created_by_fk"
  ON "pravia_os"."calculos_isr" ("creado_por_id");
CREATE INDEX IF NOT EXISTS "idx_isr_updated_by_fk"
  ON "pravia_os"."calculos_isr" ("actualizado_por_id");
CREATE INDEX IF NOT EXISTS "idx_isr_versions_calculated_by_fk"
  ON "pravia_os"."calculos_isr_versiones" ("calculado_por_id");
CREATE INDEX IF NOT EXISTS "idx_isr_documents_created_by_fk"
  ON "pravia_os"."calculos_isr_documentos" ("creado_por_id");
CREATE INDEX IF NOT EXISTS "idx_isr_proposals_reviewed_by_fk"
  ON "pravia_os"."calculos_isr_propuestas" ("reviewed_by_id");

CREATE INDEX IF NOT EXISTS "idx_compliance_evidence_retired_by_fk"
  ON "pravia_os"."compliance_evidence" ("retired_by_id");
CREATE INDEX IF NOT EXISTS "idx_uif_beneficial_owners_party_fk"
  ON "pravia_os"."compliance_beneficial_owners" ("compareciente_id");
CREATE INDEX IF NOT EXISTS "idx_uif_beneficial_owners_confirmed_by_fk"
  ON "pravia_os"."compliance_beneficial_owners" ("confirmed_by_id");
CREATE INDEX IF NOT EXISTS "idx_uif_beneficial_owners_support_doc_fk"
  ON "pravia_os"."compliance_beneficial_owners" ("support_document_id");
CREATE INDEX IF NOT EXISTS "idx_uif_pep_evidence_doc_fk"
  ON "pravia_os"."compliance_pep_reviews" ("evidence_document_id");
CREATE INDEX IF NOT EXISTS "idx_uif_pep_human_reviewer_fk"
  ON "pravia_os"."compliance_pep_reviews" ("human_reviewed_by_id");
CREATE INDEX IF NOT EXISTS "idx_uif_screening_party_fk"
  ON "pravia_os"."compliance_screening_results" ("compareciente_id");
CREATE INDEX IF NOT EXISTS "idx_uif_screening_reviewer_fk"
  ON "pravia_os"."compliance_screening_results" ("reviewed_by_id");
CREATE INDEX IF NOT EXISTS "idx_uif_payments_created_by_fk"
  ON "pravia_os"."compliance_payments" ("created_by_id");
CREATE INDEX IF NOT EXISTS "idx_uif_payments_evidence_doc_fk"
  ON "pravia_os"."compliance_payments" ("evidence_document_id");
CREATE INDEX IF NOT EXISTS "idx_uif_obligations_external_confirmer_fk"
  ON "pravia_os"."compliance_obligations" ("external_confirmed_by");
CREATE INDEX IF NOT EXISTS "idx_uif_obligations_external_receipt_fk"
  ON "pravia_os"."compliance_obligations" ("external_receipt_id");
CREATE INDEX IF NOT EXISTS "idx_uif_obligations_responsible_fk"
  ON "pravia_os"."compliance_obligations" ("responsible_id");
CREATE INDEX IF NOT EXISTS "idx_uif_events_actor_fk"
  ON "pravia_os"."compliance_events" ("actor_id");
CREATE INDEX IF NOT EXISTS "idx_uif_ai_proposals_decider_fk"
  ON "pravia_os"."compliance_ai_proposals" ("decided_by_id");
CREATE INDEX IF NOT EXISTS "idx_uif_ai_proposals_requester_fk"
  ON "pravia_os"."compliance_ai_proposals" ("requested_by_id");
CREATE INDEX IF NOT EXISTS "idx_uif_ai_proposals_source_doc_fk"
  ON "pravia_os"."compliance_ai_proposals" ("source_document_id");

CREATE INDEX IF NOT EXISTS "idx_assistant_attachments_message_fk"
  ON "pravia_os"."assistant_attachments" ("message_id");
CREATE INDEX IF NOT EXISTS "idx_assistant_attachments_uploader_fk"
  ON "pravia_os"."assistant_attachments" ("uploaded_by_id");
