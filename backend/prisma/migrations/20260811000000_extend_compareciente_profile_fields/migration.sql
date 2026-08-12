-- Additive profile fields required by the compareciente master.
-- Safe for existing rows: no table, row, or document is removed or renamed.

ALTER TABLE pravia_os.personas_fisicas
  ADD COLUMN IF NOT EXISTS pais_nacimiento VARCHAR,
  ADD COLUMN IF NOT EXISTS escolaridad VARCHAR,
  ADD COLUMN IF NOT EXISTS giro VARCHAR;

ALTER TABLE pravia_os.compareciente_domicilios
  ADD COLUMN IF NOT EXISTS comprobado BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS documento_comprobante_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'compareciente_domicilios_documento_comprobante_id_fkey'
      AND conrelid = 'pravia_os.compareciente_domicilios'::regclass
  ) THEN
    ALTER TABLE pravia_os.compareciente_domicilios
      ADD CONSTRAINT compareciente_domicilios_documento_comprobante_id_fkey
      FOREIGN KEY (documento_comprobante_id)
      REFERENCES pravia_os.documentos(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS compareciente_domicilios_documento_comprobante_id_idx
  ON pravia_os.compareciente_domicilios(documento_comprobante_id);
