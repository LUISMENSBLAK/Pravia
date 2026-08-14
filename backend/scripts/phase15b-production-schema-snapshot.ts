import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { supabaseProjectRefFromDatabaseUrl } from '../src/config/runtime';

const rawUrl = String(process.env.AUDIT_DATABASE_URL || '').trim();
const outputPath = String(process.env.AUDIT_OUTPUT_PATH || '').trim();
if (!rawUrl || !outputPath) throw new Error('AUDIT_DATABASE_URL y AUDIT_OUTPUT_PATH son obligatorios.');

const parsed = new URL(rawUrl);
parsed.searchParams.set('schema', 'pravia_os');
const existingOptions = parsed.searchParams.get('options') || '';
parsed.searchParams.set('options', `${existingOptions} -c default_transaction_read_only=on`.trim());
const prisma = new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
const select = async <T>(query: string) => prisma.$queryRawUnsafe<T>(query);

const queries = {
  identity: `SELECT current_database() AS database, current_schema() AS current_schema,
    current_setting('server_version') AS postgres_version,
    current_setting('transaction_read_only') AS transaction_read_only,
    inet_server_addr()::text AS server_address, inet_server_port() AS server_port`,
  schemas: `SELECT nspname AS schema_name, obj_description(oid, 'pg_namespace') AS comment
    FROM pg_namespace WHERE nspname = 'pravia_os'`,
  tables: `SELECT table_schema, table_name, table_type
    FROM information_schema.tables WHERE table_schema = 'pravia_os' ORDER BY table_name`,
  columns: `SELECT table_schema, table_name, ordinal_position, column_name, data_type, udt_schema, udt_name,
    is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale,
    datetime_precision, interval_type, is_identity, identity_generation, is_generated, generation_expression
    FROM information_schema.columns WHERE table_schema = 'pravia_os' ORDER BY table_name, ordinal_position`,
  constraints: `SELECT c.relname AS table_name, con.conname AS constraint_name, con.contype AS constraint_type,
    con.condeferrable AS deferrable, con.condeferred AS initially_deferred,
    con.convalidated AS validated, pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pravia_os' ORDER BY c.relname, con.conname`,
  indexes: `SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
    FROM pg_indexes WHERE schemaname = 'pravia_os' ORDER BY tablename, indexname`,
  enums: `SELECT t.typname AS enum_name, e.enumsortorder, e.enumlabel
    FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pravia_os' ORDER BY t.typname, e.enumsortorder`,
  sequences: `SELECT sequence_schema, sequence_name, data_type, start_value, minimum_value, maximum_value,
    increment, cycle_option FROM information_schema.sequences
    WHERE sequence_schema = 'pravia_os' ORDER BY sequence_name`,
  functions: `SELECT p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS result_type, p.provolatile AS volatility,
    pg_get_functiondef(p.oid) AS definition, obj_description(p.oid, 'pg_proc') AS comment
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pravia_os' ORDER BY p.proname, arguments`,
  triggers: `SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled AS enabled,
    pg_get_triggerdef(t.oid, true) AS definition, obj_description(t.oid, 'pg_trigger') AS comment
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pravia_os' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname`,
  views: `SELECT c.relname AS view_name, c.relkind AS kind, pg_get_viewdef(c.oid, true) AS definition,
    obj_description(c.oid, 'pg_class') AS comment
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pravia_os' AND c.relkind IN ('v','m') ORDER BY c.relname`,
  extensions: `SELECT e.extname AS extension_name, e.extversion AS version, n.nspname AS schema_name,
    obj_description(e.oid, 'pg_extension') AS comment
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY e.extname`,
  policies: `SELECT schemaname AS schema_name, tablename AS table_name, policyname AS policy_name,
    permissive, roles, cmd, qual, with_check FROM pg_policies
    WHERE schemaname = 'pravia_os' ORDER BY tablename, policyname`,
  rowSecurity: `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pravia_os' AND c.relkind IN ('r','p') ORDER BY c.relname`,
  comments: `SELECT c.relname AS table_name, a.attname AS column_name,
    CASE WHEN a.attnum = 0 THEN obj_description(c.oid, 'pg_class') ELSE col_description(c.oid, a.attnum) END AS comment
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum >= 0
    WHERE n.nspname = 'pravia_os'
      AND (CASE WHEN a.attnum = 0 THEN obj_description(c.oid, 'pg_class') ELSE col_description(c.oid, a.attnum) END) IS NOT NULL
    ORDER BY c.relname, a.attnum`,
};

async function main() {
  const result: Record<string, unknown> = {};
  for (const [name, query] of Object.entries(queries)) result[name] = await select(query);
  const identity = (result.identity as Array<Record<string, unknown>>)[0];
  if (identity.transaction_read_only !== 'on') throw new Error('REFUSED_PRODUCTION_WRITE: la sesión no está en read-only.');
  const report = {
    generated_at: new Date().toISOString(),
    environment: 'production',
    identity: {
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      schema: 'pravia_os',
      project_ref: supabaseProjectRefFromDatabaseUrl(rawUrl) || null,
      ...identity,
    },
    query_names: Object.keys(queries),
    structure: Object.fromEntries(Object.entries(result).filter(([name]) => name !== 'identity')),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2)}\n`);
  console.log(JSON.stringify({ ok: true, read_only: identity.transaction_read_only, output: outputPath }));
}

main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
