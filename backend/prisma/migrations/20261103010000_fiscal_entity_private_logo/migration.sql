ALTER TABLE pravia_os.entidades_fiscales_cfdi
  ADD COLUMN logo_documento_id uuid;

ALTER TABLE pravia_os.entidades_fiscales_cfdi
  ADD CONSTRAINT cfdi_entidad_logo_documento_fkey
  FOREIGN KEY (logo_documento_id, organization_id)
  REFERENCES pravia_os.documentos (id, organization_id)
  ON DELETE RESTRICT ON UPDATE NO ACTION;
