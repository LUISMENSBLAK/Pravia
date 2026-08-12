-- Extend the existing Agenda event taxonomy without renaming or removing values.

ALTER TYPE pravia_os."TipoEvento" ADD VALUE IF NOT EXISTS 'CITA';
ALTER TYPE pravia_os."TipoEvento" ADD VALUE IF NOT EXISTS 'NOTARIA';
ALTER TYPE pravia_os."TipoEvento" ADD VALUE IF NOT EXISTS 'SEGUIMIENTO';
ALTER TYPE pravia_os."TipoEvento" ADD VALUE IF NOT EXISTS 'OTRO';
