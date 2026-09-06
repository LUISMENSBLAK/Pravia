-- Remove only the compatibility wrapper created for the historical migrations. Never touch a
-- provider- or extension-owned digest implementation.
DO $migration$
DECLARE
  marker text;
BEGIN
  SELECT obj_description(to_regprocedure('public.digest(text,text)'), 'pg_proc')
  INTO marker;

  IF marker = 'PRAVIA_H5_TEMPORARY_PGCRYPTO_COMPATIBILITY' THEN
    DROP FUNCTION public.digest(text,text);
  END IF;
END
$migration$;
