-- Supabase installs pgcrypto in the `extensions` schema, while a plain
-- PostgreSQL bootstrap installs it in `public`. H5 intentionally fixes its
-- transaction search_path to `pravia_os, public`; expose only the text digest
-- overload long enough for that historical migration when the provider keeps
-- the extension outside that path.
DO $migration$
BEGIN
  IF to_regprocedure('public.digest(text,text)') IS NULL THEN
    IF to_regprocedure('extensions.digest(text,text)') IS NULL THEN
      RAISE EXCEPTION 'H5_PGCRYPTO_DIGEST_NOT_AVAILABLE';
    END IF;

    EXECUTE $function$
      CREATE FUNCTION public.digest(value text, algorithm text)
      RETURNS bytea
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE
      SET search_path = pg_catalog, extensions
      AS 'SELECT extensions.digest($1, $2)'
    $function$;
    EXECUTE $comment$
      COMMENT ON FUNCTION public.digest(text,text)
      IS 'PRAVIA_H5_TEMPORARY_PGCRYPTO_COMPATIBILITY'
    $comment$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.digest(text,text) FROM PUBLIC';
  END IF;
END
$migration$;
