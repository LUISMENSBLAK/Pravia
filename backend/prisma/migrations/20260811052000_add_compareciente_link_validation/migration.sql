-- Restaura de forma aditiva la validación humana del compareciente dentro de cada expediente.
-- La ficha maestra no se altera y ningún registro existente se elimina.

ALTER TABLE pravia_os.expediente_comparecientes
  ADD COLUMN IF NOT EXISTS datos_validados BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS validado_por_id UUID,
  ADD COLUMN IF NOT EXISTS validado_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expediente_comparecientes_validado_por_id_fkey'
      AND conrelid = 'pravia_os.expediente_comparecientes'::regclass
  ) THEN
    ALTER TABLE pravia_os.expediente_comparecientes
      ADD CONSTRAINT expediente_comparecientes_validado_por_id_fkey
      FOREIGN KEY (validado_por_id) REFERENCES pravia_os.users(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_exp_comparecientes_validador_fk
  ON pravia_os.expediente_comparecientes(validado_por_id);
