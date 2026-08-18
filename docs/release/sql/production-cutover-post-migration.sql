-- Validación final de esquema, tenant, relaciones e índices.
-- READ-ONLY. Requiere BOOTSTRAP_ORGANIZATION_ID como variable psql.

\set ON_ERROR_STOP on
\if :{?BOOTSTRAP_ORGANIZATION_ID}
\else
  \echo 'Falta BOOTSTRAP_ORGANIZATION_ID'
  \quit 3
\endif

BEGIN TRANSACTION READ ONLY;

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
    ('20260814010000_align_future_schema_and_indexes', '30ab822be29d2d0bdb1c5f10dc14dcb060034a2df746aaa25e82d405b7728568'),
    ('20260816010000_prospect_client_catalogs', '2b733331136e3eadd6aac0099159659a4bd52d264dfef5a758fcd5855b5c8182'),
    ('20260816020000_notaria_client_requirements', '4127803f089c982ba2062505d0c486330bcc85310025c1477cb7fc4c2f471091'),
    ('20260817010000_compareciente_workspace', '0d5577d5d2be154ea51906b2c5bbae1dbdfc1048c7af4992421fe54d4345f1cc'),
    ('20260817020000_enforce_finance_distribution_ceiling', '2ce4f321d97eb523aa25ccdef28b584ea13559406a2d1bd74663622a75c19b40'),
    ('20260817030000_create_isr_calculation_module', 'c43e142833219ddfee875403384c52610aff61ba80006c1606c6914f14856223'),
    ('20260817040000_expand_compliance_uif_module', 'ecde466079197ac3cb59d366777abe6efbba0b5fcd02b407c8d950e316ae6f80'),
    ('20260817045000_create_multitenancy_foundation', '4e1969dd0160ef6fdef09c6ebbc59957c1be6d20622ffe7724d24bfaf5710efa'),
    ('20260817050000_create_assistant_conversations', '607c074a033f1333de3a3993bd6ef212c2d69ea319b4cf73f3c617d04825c1f4'),
    ('20260817060000_add_missing_operational_fk_indexes', '74e06d6d228cd365e3ac8fccd8b30310032c029dcabad41892eaed6c1d8ec39e')
), actual AS (
  SELECT migration_name, checksum, finished_at, rolled_back_at
  FROM pravia_os._prisma_migrations
), differences AS (
  SELECT
    COALESCE(expected.migration_name, actual.migration_name) AS migration_name,
    CASE
      WHEN expected.migration_name IS NULL THEN 'UNEXPECTED'
      WHEN actual.migration_name IS NULL THEN 'MISSING'
      WHEN expected.checksum <> actual.checksum THEN 'CHECKSUM_MISMATCH'
      WHEN actual.finished_at IS NULL THEN 'NOT_FINISHED'
      WHEN actual.rolled_back_at IS NOT NULL THEN 'ROLLED_BACK'
      ELSE 'MATCH'
    END AS state
  FROM expected FULL OUTER JOIN actual USING (migration_name)
)
SELECT count(*) FILTER (WHERE state <> 'MATCH') AS migration_differences,
       count(*) FILTER (WHERE state = 'MATCH') AS migration_matches
FROM differences;

SELECT
  count(*) AS organizations_total,
  count(*) FILTER (WHERE id = :'BOOTSTRAP_ORGANIZATION_ID'::uuid AND status = 'ACTIVE') AS expected_bootstrap_active
FROM pravia_os.organizations;

SELECT
  (SELECT count(*) FROM pravia_os.users) AS users,
  count(*) FILTER (WHERE organization_id = :'BOOTSTRAP_ORGANIZATION_ID'::uuid) AS bootstrap_memberships,
  count(*) FILTER (
    WHERE organization_id = :'BOOTSTRAP_ORGANIZATION_ID'::uuid
      AND ((status = 'ACTIVE' AND NOT user_active) OR (status = 'SUSPENDED' AND user_active))
  ) AS membership_status_mismatches,
  count(*) FILTER (
    WHERE organization_id = :'BOOTSTRAP_ORGANIZATION_ID'::uuid AND membership_role <> user_role
  ) AS role_mismatches
FROM (
  SELECT membership.organization_id, membership.status, membership.rol::text AS membership_role,
         app_user.activo AS user_active, app_user.rol::text AS user_role
  FROM pravia_os.organization_memberships AS membership
  JOIN pravia_os.users AS app_user ON app_user.id = membership.user_id
) AS membership_state;

SELECT
  count(*) FILTER (WHERE session.organization_id IS NULL OR session.membership_id IS NULL) AS session_tenant_orphans,
  count(*) FILTER (
    WHERE membership.id IS NULL
       OR session.organization_id IS DISTINCT FROM membership.organization_id
       OR session.user_id IS DISTINCT FROM membership.user_id
  ) AS session_membership_mismatches
FROM pravia_os.auth_sessions AS session
LEFT JOIN pravia_os.organization_memberships AS membership ON membership.id = session.membership_id;

-- Devuelve una fila por tabla. Cada orphan_count debe ser 0.
SELECT format(
  'SELECT %L AS table_name, count(*) AS orphan_count FROM pravia_os.%I WHERE organization_id IS NULL;',
  table_name, table_name
)
FROM information_schema.columns
WHERE table_schema = 'pravia_os' AND column_name = 'organization_id'
ORDER BY table_name
\gexec

-- Recorre FKs simples cuyos dos extremos son tenant-owned. Cada invalid_count debe ser 0.
SELECT format(
  'SELECT %L AS relationship, count(*) AS invalid_count FROM pravia_os.%I child JOIN pravia_os.%I parent ON child.%I = parent.%I WHERE child.organization_id IS DISTINCT FROM parent.organization_id;',
  child.relname || '.' || child_column.attname || '->' || parent.relname || '.' || parent_column.attname,
  child.relname, parent.relname, child_column.attname, parent_column.attname
)
FROM pg_constraint AS constraint_row
JOIN pg_class AS child ON child.oid = constraint_row.conrelid
JOIN pg_namespace AS child_namespace ON child_namespace.oid = child.relnamespace
JOIN pg_class AS parent ON parent.oid = constraint_row.confrelid
JOIN pg_namespace AS parent_namespace ON parent_namespace.oid = parent.relnamespace
JOIN pg_attribute AS child_column ON child_column.attrelid = child.oid AND child_column.attnum = constraint_row.conkey[1]
JOIN pg_attribute AS parent_column ON parent_column.attrelid = parent.oid AND parent_column.attnum = constraint_row.confkey[1]
WHERE constraint_row.contype = 'f'
  AND cardinality(constraint_row.conkey) = 1
  AND child_namespace.nspname = 'pravia_os'
  AND parent_namespace.nspname = 'pravia_os'
  AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = child.oid AND attname = 'organization_id' AND NOT attisdropped)
  AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = parent.oid AND attname = 'organization_id' AND NOT attisdropped)
ORDER BY child.relname, constraint_row.conname
\gexec

SELECT count(*) AS missing_fk_indexes
FROM pg_constraint AS constraint_row
JOIN pg_namespace AS namespace ON namespace.oid = constraint_row.connamespace
WHERE constraint_row.contype = 'f'
  AND namespace.nspname = 'pravia_os'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index AS index_row
    WHERE index_row.indrelid = constraint_row.conrelid
      AND index_row.indisvalid
      AND index_row.indisready
      AND constraint_row.conkey <@ index_row.indkey::smallint[]
  );

WITH index_signatures AS (
  SELECT
    index_row.indrelid,
    index_row.indkey::text AS key_columns,
    index_row.indclass::text AS operator_classes,
    index_row.indcollation::text AS collations,
    index_row.indoption::text AS options,
    index_row.indisunique,
    index_row.indisprimary,
    pg_get_expr(index_row.indexprs, index_row.indrelid) AS expressions,
    pg_get_expr(index_row.indpred, index_row.indrelid) AS predicate,
    count(*) AS copies
  FROM pg_index AS index_row
  JOIN pg_class AS table_row ON table_row.oid = index_row.indrelid
  JOIN pg_namespace AS namespace ON namespace.oid = table_row.relnamespace
  WHERE namespace.nspname = 'pravia_os' AND index_row.indisvalid
  GROUP BY index_row.indrelid, index_row.indkey::text, index_row.indclass::text,
           index_row.indcollation::text, index_row.indoption::text,
           index_row.indisunique, index_row.indisprimary,
           pg_get_expr(index_row.indexprs, index_row.indrelid),
           pg_get_expr(index_row.indpred, index_row.indrelid)
)
SELECT count(*) AS duplicate_index_groups
FROM index_signatures
WHERE copies > 1;

ROLLBACK;
