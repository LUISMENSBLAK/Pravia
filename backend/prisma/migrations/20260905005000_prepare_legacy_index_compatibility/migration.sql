-- The production rebaseline preserves the original physical index name while
-- the clean bootstrap chain uses Prisma's relation-derived name. H6 removes
-- that superseded uniqueness rule, so normalize only the known equivalent
-- index immediately before H6 executes.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'pravia_os'
      AND t.relname = 'compliance_obligations'
      AND c.conname = 'compliance_obligations_review_type_key'
      AND c.contype = 'u'
  ) THEN
    ALTER TABLE pravia_os.compliance_obligations
      DROP CONSTRAINT compliance_obligations_review_type_key;
    CREATE UNIQUE INDEX compliance_obligations_review_id_type_key
      ON pravia_os.compliance_obligations(review_id, type);
  ELSIF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'pravia_os'
      AND t.relname = 'compliance_obligations'
      AND c.conname = 'compliance_obligations_review_id_type_key'
      AND c.contype = 'u'
  ) THEN
    ALTER TABLE pravia_os.compliance_obligations
      DROP CONSTRAINT compliance_obligations_review_id_type_key;
    CREATE UNIQUE INDEX compliance_obligations_review_id_type_key
      ON pravia_os.compliance_obligations(review_id, type);
  ELSIF to_regclass('pravia_os.compliance_obligations_review_id_type_key') IS NULL
        AND to_regclass('pravia_os.compliance_obligations_review_type_key') IS NOT NULL THEN
    ALTER INDEX pravia_os.compliance_obligations_review_type_key
      RENAME TO compliance_obligations_review_id_type_key;
  END IF;
END
$migration$;
