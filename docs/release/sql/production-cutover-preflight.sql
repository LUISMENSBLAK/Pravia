-- PRAVIA OS production cutover preflight.
-- READ-ONLY: no crea ni modifica objetos. Ejecutar con psql y ON_ERROR_STOP.

\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

SELECT
  current_database() AS database_name,
  current_setting('transaction_read_only') AS transaction_read_only,
  current_setting('server_version') AS server_version,
  to_regnamespace('pravia_os') IS NOT NULL AS pravia_schema_exists,
  to_regclass('pravia_os._prisma_migrations') IS NOT NULL AS canonical_history_exists,
  to_regclass('public._prisma_migrations') IS NOT NULL AS public_history_exists;

WITH expected(migration_name, checksum) AS (
  VALUES
    ('20260812000000_canonical_production_baseline', '51526bb12228a0c5f4fd02f9baec77ae696f601c2c6f5ff70c2fa9b9cf5f7b49'),
    ('20260812010000_add_granular_delivery_postfirma', 'ced3561b11cd56647b701a5b3c75c39910e6a5cfb8bdd106348e9b5e249afabe'),
    ('20260812020000_persist_project_templates', 'd423eb7b5a09f5f543dfd550ddc57808e91a60aee78eaa44f9e3347536025ea4'),
    ('20260812030000_create_canonical_finance_ledger', '15ba00cfb150ce41ce9b5aaef664b4ac03fd92bff8b9c3c2f927f4f00b84c99a'),
    ('20260813010000_immutable_compliance_snapshots', '2d9c0eae0c2b4973567b102e5539845b8c3fc9668983315727c4db2811c96d30'),
    ('20260813020000_create_reporting_targets', 'a6fb0cdb2116eb1f31f7b6707cd30625dfc332bf14013b6f37217c7229081140'),
    ('20260813030000_settings_and_access', '62af5db6f6fac0c2e8cf8d3d8397cbaf0907bbd4e8f0698492d30960387c0ffa'),
    ('20260813040000_harden_session_persistence', '1de3506cad5bc3b70ab64b2a673a73b1348c1a7cb31ec2950e4c73ae1ac23b17'),
    ('20260814010000_align_future_schema_and_indexes', '30ab822be29d2d0bdb1c5f10dc14dcb060034a2df746aaa25e82d405b7728568')
), actual AS (
  SELECT migration_name, checksum, finished_at, rolled_back_at
  FROM pravia_os._prisma_migrations
)
SELECT
  COALESCE(expected.migration_name, actual.migration_name) AS migration_name,
  CASE
    WHEN expected.migration_name IS NULL THEN 'UNEXPECTED_IN_DATABASE'
    WHEN actual.migration_name IS NULL THEN 'MISSING_IN_DATABASE'
    WHEN expected.checksum <> actual.checksum THEN 'CHECKSUM_MISMATCH'
    WHEN actual.finished_at IS NULL THEN 'NOT_FINISHED'
    WHEN actual.rolled_back_at IS NOT NULL THEN 'ROLLED_BACK'
    ELSE 'MATCH'
  END AS state
FROM expected
FULL OUTER JOIN actual USING (migration_name)
ORDER BY migration_name;

SELECT
  count(*) AS migration_rows,
  count(*) FILTER (WHERE finished_at IS NULL) AS unfinished,
  count(*) FILTER (WHERE rolled_back_at IS NOT NULL) AS rolled_back
FROM pravia_os._prisma_migrations;

SELECT rol::text, activo, count(*) AS users
FROM pravia_os.users
GROUP BY rol, activo
ORDER BY rol, activo;

SELECT
  count(*) AS sessions_total,
  count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now()) AS sessions_active,
  count(*) FILTER (WHERE revoked_at IS NOT NULL) AS sessions_revoked
FROM pravia_os.auth_sessions;

SELECT
  count(*) FILTER (WHERE pid <> pg_backend_pid() AND state <> 'idle') AS other_non_idle_connections,
  count(*) FILTER (
    WHERE pid <> pg_backend_pid()
      AND xact_start IS NOT NULL
      AND now() - xact_start > interval '5 minutes'
  ) AS transactions_over_five_minutes
FROM pg_stat_activity
WHERE datname = current_database();

SELECT count(*) AS ungranted_locks
FROM pg_locks
WHERE NOT granted;

SELECT
  pg_database_size(current_database()) AS database_bytes,
  pg_total_relation_size('pravia_os.documentos'::regclass) AS documentos_relation_bytes,
  pg_total_relation_size('pravia_os.movimientos_financieros'::regclass) AS finance_relation_bytes;

ROLLBACK;
