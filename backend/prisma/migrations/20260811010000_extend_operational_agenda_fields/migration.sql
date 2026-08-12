-- Additive operational fields for Agenda. Existing events and linked records are preserved.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pravia_os' AND t.typname = 'EventoAgendaEstatus'
  ) THEN
    CREATE TYPE pravia_os."EventoAgendaEstatus" AS ENUM ('ACTIVO', 'COMPLETADO', 'CANCELADO');
  END IF;
END $$;

ALTER TABLE pravia_os.eventos_agenda
  ADD COLUMN IF NOT EXISTS estatus pravia_os."EventoAgendaEstatus" NOT NULL DEFAULT 'ACTIVO',
  ADD COLUMN IF NOT EXISTS compareciente_id UUID,
  ADD COLUMN IF NOT EXISTS recordatorios JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cancelado_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS cancelado_por_id UUID,
  ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'eventos_agenda_compareciente_id_fkey'
      AND conrelid = 'pravia_os.eventos_agenda'::regclass
  ) THEN
    ALTER TABLE pravia_os.eventos_agenda
      ADD CONSTRAINT eventos_agenda_compareciente_id_fkey
      FOREIGN KEY (compareciente_id)
      REFERENCES pravia_os.comparecientes(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'eventos_agenda_cancelado_por_id_fkey'
      AND conrelid = 'pravia_os.eventos_agenda'::regclass
  ) THEN
    ALTER TABLE pravia_os.eventos_agenda
      ADD CONSTRAINT eventos_agenda_cancelado_por_id_fkey
      FOREIGN KEY (cancelado_por_id)
      REFERENCES pravia_os.users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS eventos_agenda_estatus_idx
  ON pravia_os.eventos_agenda(estatus);

CREATE INDEX IF NOT EXISTS eventos_agenda_user_fecha_idx
  ON pravia_os.eventos_agenda(user_id, fecha_inicio);

CREATE INDEX IF NOT EXISTS eventos_agenda_fecha_inicio_idx
  ON pravia_os.eventos_agenda(fecha_inicio);

CREATE INDEX IF NOT EXISTS eventos_agenda_expediente_idx
  ON pravia_os.eventos_agenda(expediente_id);
