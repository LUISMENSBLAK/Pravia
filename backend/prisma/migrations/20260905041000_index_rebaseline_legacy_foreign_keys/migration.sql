-- The canonical production rebaseline preserves stronger tenant-aware foreign
-- keys that are not representable in the Prisma bootstrap schema. Add a
-- deterministic covering index only when one of those physical foreign keys
-- still lacks one. This is additive, idempotent and never changes application
-- data or the constraint itself.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $migration$
DECLARE
  foreign_key record;
  index_name text;
  index_columns text;
BEGIN
  FOR foreign_key IN
    SELECT
      n.nspname AS schema_name,
      t.relname AS table_name,
      c.conname AS constraint_name,
      array_agg(a.attname ORDER BY key_column.ordinality) AS column_names
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN unnest(c.conkey) WITH ORDINALITY AS key_column(attnum, ordinality) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key_column.attnum
    WHERE c.contype = 'f'
      AND n.nspname = 'pravia_os'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND i.indisvalid
          AND i.indisready
          AND c.conkey <@ i.indkey::smallint[]
      )
    GROUP BY n.nspname, t.relname, c.conname, c.conrelid, c.conkey
    ORDER BY t.relname, c.conname
  LOOP
    index_name := 'idx_fk_release_' || substr(md5(
      foreign_key.schema_name || '.' || foreign_key.table_name || ':' || foreign_key.constraint_name
    ), 1, 16);
    SELECT string_agg(format('%I', column_name), ', ')
      INTO index_columns
      FROM unnest(foreign_key.column_names) AS column_name;
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)',
      index_name,
      foreign_key.schema_name,
      foreign_key.table_name,
      index_columns
    );
  END LOOP;
END
$migration$;

COMMIT;
