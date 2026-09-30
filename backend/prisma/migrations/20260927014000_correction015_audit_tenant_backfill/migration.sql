-- Corrección 015: toda auditoría operativa pertenece a la Notaría/Organization
-- que la produjo. El histórico anterior al tenant foundation sólo se migra
-- cuando la membresía del actor determina exactamente una organización; si
-- existe ambigüedad, el despliegue se detiene en vez de inventar ownership.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pravia_os.audit_logs AS audit
    WHERE audit.organization_id IS NULL
      AND (
        SELECT count(DISTINCT membership.organization_id)
        FROM pravia_os.organization_memberships AS membership
        WHERE membership.user_id = audit.user_id
      ) <> 1
  ) THEN
    RAISE EXCEPTION 'CORRECTION015_AUDIT_TENANT_BACKFILL_AMBIGUOUS';
  END IF;
END $$;

UPDATE pravia_os.audit_logs AS audit
SET organization_id = (
  SELECT min(membership.organization_id::text)::uuid
  FROM pravia_os.organization_memberships AS membership
  WHERE membership.user_id = audit.user_id
)
WHERE audit.organization_id IS NULL;

ALTER TABLE pravia_os.audit_logs
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_action_created
  ON pravia_os.audit_logs(organization_id, accion, created_at DESC);
