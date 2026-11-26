-- Manual applicability is not a master rule. Preserve every historical row,
-- FK and existing rule; allow a new explicit selection to have no master rule.
ALTER TABLE "pravia_os"."expediente_artefactos_pendientes"
  ALTER COLUMN "regla_id" DROP NOT NULL;
