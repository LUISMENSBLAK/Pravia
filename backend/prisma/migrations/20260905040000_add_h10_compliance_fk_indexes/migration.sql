-- H10 certification correction: make post-H1 compliance FK indexes identical
-- for fresh bootstrap and incremental upgrade paths. No data is changed.
BEGIN;
SET LOCAL search_path TO pravia_os, public;

CREATE INDEX IF NOT EXISTS "idx_fk_compliance_alert_lead_revisions_b0295d69" ON "compliance_alert_lead_revisions"("organization_id", "created_by_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_alerts_6618ff71" ON "compliance_alerts"("state_id", "organization_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_alerts_7c4aa18c" ON "compliance_alerts"("lead_revision_id", "organization_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_alerts_865f3a6b" ON "compliance_alerts"("rule_revision_id", "organization_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_alerts_94d15180" ON "compliance_alerts"("requirement_id", "organization_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_alerts_9db01836" ON "compliance_alerts"("organization_id", "resolved_by_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_alerts_e51c7f9b" ON "compliance_alerts"("organization_id", "responsible_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_legal_rule_revisions_30815683" ON "compliance_legal_rule_revisions"("organization_id", "verified_by_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_legal_rule_revisions_40041716" ON "compliance_legal_rule_revisions"("organization_id", "created_by_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_legal_rule_revisions_b61092f8" ON "compliance_legal_rule_revisions"("supersedes_revision_id", "organization_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_legal_rule_revisions_d84b615d" ON "compliance_legal_rule_revisions"("organization_id", "activated_by_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_legal_rules_a2237f3c" ON "compliance_legal_rules"("organization_id", "created_by_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_obligations_27ebd2fd" ON "compliance_obligations"("rule_result_id", "organization_id", "review_id", "rule_revision_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_obligations_7cdf816d" ON "compliance_obligations"("rule_revision_id", "organization_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_operation_payment_parties_a2a7c291" ON "compliance_operation_payment_parties"("expediente_compareciente_id", "organization_id", "expediente_id", "compareciente_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_requirements_27b63538" ON "compliance_requirements"("state_id", "organization_id");
CREATE INDEX IF NOT EXISTS "idx_fk_compliance_requirements_aa6b5d11" ON "compliance_requirements"("rule_result_id", "organization_id");
CREATE INDEX IF NOT EXISTS "idx_fk_expediente_compliance_states_70cd5500" ON "expediente_compliance_states"("current_review_id");
CREATE INDEX IF NOT EXISTS "idx_fk_expediente_compliance_states_85c74ece" ON "expediente_compliance_states"("organization_id", "updated_by_id");

COMMIT;
