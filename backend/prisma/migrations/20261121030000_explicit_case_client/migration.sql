-- Client update 5. The client is independent of appearances/roles in an act.
ALTER TABLE pravia_os.expedientes ADD COLUMN cliente_compareciente_id UUID;
ALTER TABLE pravia_os.expedientes ADD CONSTRAINT expediente_cliente_tenant_required
  CHECK (cliente_compareciente_id IS NULL OR organization_id IS NOT NULL);
ALTER TABLE pravia_os.expedientes ADD CONSTRAINT expediente_cliente_tenant_fkey
  FOREIGN KEY (cliente_compareciente_id, organization_id)
  REFERENCES pravia_os.comparecientes (id, organization_id) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX idx_expediente_cliente ON pravia_os.expedientes (cliente_compareciente_id, organization_id);
-- Backfill only proven quote origins in the same tenant. Keep every historical alias.
UPDATE pravia_os.expedientes e SET cliente_compareciente_id = c.id
FROM pravia_os.cotizaciones q, pravia_os.comparecientes c
WHERE e.cotizacion_id = q.id AND e.organization_id = q.organization_id
  AND q.solicitante_formal_id = c.id AND c.organization_id = e.organization_id;
