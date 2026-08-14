import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

type Row = Record<string, unknown>;
const rawUrl = String(process.env.AUDIT_DATABASE_URL || process.env.DATABASE_URL || '').trim();
const outputPath = String(process.env.AUDIT_OUTPUT_PATH || '').trim();
const label = String(process.env.AUDIT_LABEL || 'unknown').trim();
if (!rawUrl || !outputPath) throw new Error('AUDIT_DATABASE_URL y AUDIT_OUTPUT_PATH son obligatorios.');

const parsed = new URL(rawUrl);
parsed.searchParams.set('schema', 'pravia_os');
const currentOptions = parsed.searchParams.get('options') || '';
parsed.searchParams.set('options', `${currentOptions} -c default_transaction_read_only=on`.trim());
const prisma = new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
const select = async (query: string) => prisma.$queryRawUnsafe<Row[]>(query);
const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sql = (value: unknown) => value == null ? null : String(value)
  .replace(/"pravia_os"\./g, '')
  .replace(/\bpravia_os\./g, '')
  .replace(/CURRENT_TIMESTAMP/g, 'now()')
  .replace(/\s+/g, ' ')
  .trim();
const stable = (row: Row) => Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key]]));
const sorted = (rows: Row[], key: (row: Row) => string, map: (row: Row) => Row) => rows
  .map((row) => ({ key: key(row), ...stable(map(row)) }))
  .sort((left, right) => String(left.key).localeCompare(String(right.key)));

async function main() {
  const identity = (await select(`SELECT current_database() AS database, current_schema() AS current_schema,
    current_setting('server_version') AS postgres_version,
    current_setting('transaction_read_only') AS transaction_read_only`))[0];
  if (identity.transaction_read_only !== 'on') throw new Error('REFUSED_PRODUCTION_WRITE: fingerprint requiere una sesión read-only.');

  const tables = await select(`SELECT table_name, table_type FROM information_schema.tables
    WHERE table_schema = 'pravia_os' AND table_name <> '_prisma_migrations' ORDER BY table_name`);
  const columns = await select(`SELECT table_name, ordinal_position, column_name, data_type, udt_schema, udt_name,
    is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale,
    is_identity, identity_generation, is_generated, generation_expression
    FROM information_schema.columns WHERE table_schema = 'pravia_os' AND table_name <> '_prisma_migrations'
    ORDER BY table_name, ordinal_position`);
  const constraints = await select(`SELECT c.relname AS table_name, con.conname AS constraint_name,
    con.contype AS constraint_type, con.condeferrable AS deferrable,
    con.condeferred AS initially_deferred, con.convalidated AS validated,
    pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pravia_os' AND c.relname <> '_prisma_migrations'
    ORDER BY c.relname, con.conname`);
  const indexes = await select(`SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
    FROM pg_indexes WHERE schemaname = 'pravia_os' AND tablename <> '_prisma_migrations'
    ORDER BY tablename, indexname`);
  const enums = await select(`SELECT t.typname AS enum_name, e.enumsortorder, e.enumlabel
    FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pravia_os' ORDER BY t.typname, e.enumsortorder`);
  const sequences = await select(`SELECT sequence_name, data_type, start_value, minimum_value, maximum_value,
    increment, cycle_option FROM information_schema.sequences
    WHERE sequence_schema = 'pravia_os' ORDER BY sequence_name`);
  const functions = await select(`SELECT p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS result_type, p.provolatile AS volatility,
    pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pravia_os' ORDER BY p.proname, arguments`);
  const triggers = await select(`SELECT c.relname AS table_name, t.tgname AS trigger_name,
    t.tgenabled AS enabled, pg_get_triggerdef(t.oid, true) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pravia_os' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname`);
  const views = await select(`SELECT c.relname AS view_name, c.relkind AS kind, pg_get_viewdef(c.oid, true) AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pravia_os' AND c.relkind IN ('v','m') ORDER BY c.relname`);
  const policies = await select(`SELECT tablename AS table_name, policyname AS policy_name,
    permissive, roles, cmd, qual, with_check FROM pg_policies
    WHERE schemaname = 'pravia_os' ORDER BY tablename, policyname`);
  const rowSecurity = await select(`SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pravia_os' AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations'
    ORDER BY c.relname`);

  const manifest = {
    tables: sorted(tables, (r) => String(r.table_name), (r) => ({ table_type: r.table_type })),
    columns: sorted(columns, (r) => `${r.table_name}.${r.column_name}`, (r) => ({
      data_type: r.data_type, udt_schema: r.udt_schema,
      udt_name: r.udt_name, is_nullable: r.is_nullable, column_default: sql(r.column_default),
      character_maximum_length: r.character_maximum_length == null ? null : String(r.character_maximum_length),
      numeric_precision: r.numeric_precision == null ? null : String(r.numeric_precision),
      numeric_scale: r.numeric_scale == null ? null : String(r.numeric_scale), is_identity: r.is_identity,
      identity_generation: r.identity_generation, is_generated: r.is_generated,
      generation_expression: sql(r.generation_expression),
    })),
    constraints: sorted(constraints, (r) => `${r.table_name}.${r.constraint_name}`, (r) => ({
      constraint_type: r.constraint_type, deferrable: r.deferrable, initially_deferred: r.initially_deferred,
      validated: r.validated, definition: sql(r.definition),
    })),
    indexes: sorted(indexes, (r) => `${r.table_name}.${r.index_name}`, (r) => ({ definition: sql(r.definition) })),
    enums: sorted(enums, (r) => `${r.enum_name}.${String(r.enumsortorder).padStart(8, '0')}`, (r) => ({ enumlabel: r.enumlabel })),
    sequences: sorted(sequences, (r) => String(r.sequence_name), (r) => ({ ...r, sequence_name: undefined })),
    functions: sorted(functions, (r) => `${r.function_name}(${r.arguments})`, (r) => ({
      result_type: r.result_type, volatility: r.volatility, definition: sql(r.definition),
    })),
    triggers: sorted(triggers, (r) => `${r.table_name}.${r.trigger_name}`, (r) => ({
      enabled: r.enabled, definition: sql(r.definition),
    })),
    views: sorted(views, (r) => String(r.view_name), (r) => ({ kind: r.kind, definition: sql(r.definition) })),
    policies: sorted(policies, (r) => `${r.table_name}.${r.policy_name}`, (r) => ({
      permissive: r.permissive, roles: r.roles, cmd: r.cmd, qual: sql(r.qual), with_check: sql(r.with_check),
    })),
    row_security: sorted(rowSecurity, (r) => String(r.table_name), (r) => ({
      rls_enabled: r.rls_enabled, rls_forced: r.rls_forced,
    })),
  };
  const section_hashes = Object.fromEntries(Object.entries(manifest).map(([name, value]) => [name, hash(value)]));
  const fingerprint = hash(section_hashes);
  const expected = String(process.env.EXPECTED_SCHEMA_FINGERPRINT || '').trim();
  if (expected && fingerprint !== expected) {
    throw new Error(`REFUSED_SCHEMA_MISMATCH: esperado ${expected}, obtenido ${fingerprint}.`);
  }
  const report = { generated_at: new Date().toISOString(), label, identity, fingerprint, section_hashes, manifest };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, label, fingerprint, counts: Object.fromEntries(Object.entries(manifest).map(([name, value]) => [name, value.length])) }));
}

main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
