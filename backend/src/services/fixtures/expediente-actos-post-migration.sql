\pset tuples_only on
\pset format unaligned

SELECT 'legacy_expedientes=' || count(*) FROM "pravia_os"."expedientes";
SELECT 'legacy_fields_preserved=' || count(*) FROM "pravia_os"."expedientes" WHERE "tipo_acto_id" IS NOT NULL;
SELECT 'initial_links=' || count(*) FROM "pravia_os"."expediente_actos" WHERE "idempotency_key" LIKE 'MIGRATION:LEGACY:%';
SELECT 'orphans=' || count(*) FROM "pravia_os"."expediente_actos" ea LEFT JOIN "pravia_os"."expedientes" e ON e."id"=ea."expediente_id" WHERE e."id" IS NULL;
SELECT 'tenant_mismatch=' || count(*) FROM "pravia_os"."expediente_actos" ea JOIN "pravia_os"."expedientes" e ON e."id"=ea."expediente_id" WHERE e."organization_id" IS DISTINCT FROM ea."organization_id";
SELECT 'duplicate_migration_rows=' || count(*) FROM (SELECT 1 FROM "pravia_os"."expediente_actos" WHERE "idempotency_key" LIKE 'MIGRATION:LEGACY:%' GROUP BY "organization_id","expediente_id","idempotency_key" HAVING count(*) > 1) duplicate_rows;
SELECT 'historical_folios_changed=' || count(*) FROM "pravia_os"."expedientes" WHERE "numero_pravia" <> 'EXP-' || lpad(substring("numero_pravia" from 5 for 4),4,'0') || '-2026';

BEGIN;
INSERT INTO "pravia_os"."expediente_actos" ("organization_id","expediente_id","tipo_acto_id","origen","idempotency_key","created_by") VALUES
('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','ADICIONAL','TEST:ADD:1','20000000-0000-0000-0000-000000000001'),
('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','ADICIONAL','TEST:ADD:2','20000000-0000-0000-0000-000000000001');
INSERT INTO "pravia_os"."expediente_actos" ("organization_id","expediente_id","tipo_acto_id","origen","idempotency_key","created_by") VALUES
('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','ADICIONAL','TEST:ADD:1','20000000-0000-0000-0000-000000000001')
ON CONFLICT ("organization_id","expediente_id","idempotency_key") DO NOTHING;
SELECT 'same_type_instances=' || count(*) FROM "pravia_os"."expediente_actos" WHERE "expediente_id"='50000000-0000-0000-0000-000000000001' AND "tipo_acto_id"='30000000-0000-0000-0000-000000000001';
SELECT 'same_request_instances=' || count(*) FROM "pravia_os"."expediente_actos" WHERE "idempotency_key"='TEST:ADD:1';
ROLLBACK;
