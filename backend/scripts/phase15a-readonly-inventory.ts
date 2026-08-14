import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { supabaseProjectRefFromDatabaseUrl } from '../src/config/runtime';

const rawUrl = process.env.AUDIT_DATABASE_URL || process.env.DATABASE_URL;
const environment = String(process.env.AUDIT_ENVIRONMENT || '').trim().toLowerCase();
const output = process.env.AUDIT_OUTPUT_PATH;
if (!rawUrl || !output || !['local', 'staging', 'production'].includes(environment)) {
  throw new Error('AUDIT_DATABASE_URL, AUDIT_ENVIRONMENT y AUDIT_OUTPUT_PATH son obligatorios.');
}
const databaseUrl = rawUrl as string;
const outputPath = output as string;

const parsed = new URL(databaseUrl);
const schema = parsed.searchParams.get('schema') || 'pravia_os';
const existingOptions = parsed.searchParams.get('options') || '';
parsed.searchParams.set('options', `${existingOptions} -c default_transaction_read_only=on`.trim());
const prisma = new PrismaClient({ datasources: { db: { url: parsed.toString() } } });

const select = async <T>(query: string) => prisma.$queryRawUnsafe<T>(query);
const quoteIdent = (value: string) => `"${value.replace(/"/g, '""')}"`;

async function main() {
  const identity = (await select<Array<Record<string, unknown>>>(`
    SELECT current_database() AS database, current_schema() AS current_schema,
      current_setting('server_version') AS postgres_version,
      current_setting('transaction_read_only') AS transaction_read_only,
      inet_server_addr()::text AS server_address, inet_server_port() AS server_port
  `))[0];

  const migrationSchemas = await select<Array<{ table_schema: string }>>(`
    SELECT table_schema FROM information_schema.tables
    WHERE table_name = '_prisma_migrations' ORDER BY table_schema
  `);
  const migrations: Array<Record<string, unknown> & { table_schema: string }> = [];
  for (const row of migrationSchemas) {
    const records = await select<Array<Record<string, unknown>>>(`
      SELECT id, migration_name, checksum, started_at, finished_at, rolled_back_at,
        applied_steps_count, logs
      FROM ${quoteIdent(row.table_schema)}."_prisma_migrations"
      ORDER BY started_at, migration_name
    `);
    migrations.push(...records.map((record) => ({ table_schema: row.table_schema, ...record })));
  }

  const tables = await select(`
    SELECT table_schema, table_name, table_type
    FROM information_schema.tables
    WHERE table_schema IN ('pravia_os', 'public')
      AND table_name <> '_prisma_migrations'
    ORDER BY table_schema, table_name
  `);
  const columns = await select(`
    SELECT table_schema, table_name, ordinal_position, column_name, data_type, udt_schema, udt_name,
      is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'pravia_os'
    ORDER BY table_name, ordinal_position
  `);
  const constraints = await select(`
    SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname AS constraint_name,
      con.contype AS constraint_type, pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pravia_os'
    ORDER BY c.relname, con.conname
  `);
  const indexes = await select(`
    SELECT schemaname AS schema_name, tablename AS table_name, indexname AS index_name, indexdef AS definition
    FROM pg_indexes WHERE schemaname = 'pravia_os'
    ORDER BY tablename, indexname
  `);
  const enums = await select(`
    SELECT n.nspname AS schema_name, t.typname AS enum_name, e.enumsortorder, e.enumlabel
    FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pravia_os' ORDER BY t.typname, e.enumsortorder
  `);
  const sequences = await select(`
    SELECT sequence_schema, sequence_name, data_type, start_value, minimum_value, maximum_value, increment
    FROM information_schema.sequences WHERE sequence_schema = 'pravia_os'
    ORDER BY sequence_name
  `);
  const triggers = await select(`
    SELECT trigger_schema, event_object_table AS table_name, trigger_name, event_manipulation,
      action_timing, action_statement
    FROM information_schema.triggers WHERE trigger_schema = 'pravia_os'
    ORDER BY event_object_table, trigger_name, event_manipulation
  `);
  const functions = await select(`
    SELECT n.nspname AS schema_name, p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS arguments,
      pg_get_function_result(p.oid) AS result_type,
      p.provolatile AS volatility
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pravia_os'
    ORDER BY p.proname, arguments
  `);

  const report = {
    generated_at: new Date().toISOString(),
    environment,
    identity: {
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      schema,
      project_ref: supabaseProjectRefFromDatabaseUrl(databaseUrl) || null,
      ...identity,
    },
    queries: [
      'SELECT current_database/current_schema/server_version/transaction_read_only/server address',
      "SELECT migration table schemas FROM information_schema.tables WHERE table_name = '_prisma_migrations'",
      'SELECT migration metadata FROM each discovered _prisma_migrations table',
      "SELECT tables FROM information_schema.tables WHERE schema IN ('pravia_os','public')",
      "SELECT columns FROM information_schema.columns WHERE schema = 'pravia_os'",
      "SELECT constraints FROM pg_constraint WHERE schema = 'pravia_os'",
      "SELECT indexes FROM pg_indexes WHERE schema = 'pravia_os'",
      "SELECT enums FROM pg_type/pg_enum WHERE schema = 'pravia_os'",
      "SELECT sequences FROM information_schema.sequences WHERE schema = 'pravia_os'",
      "SELECT triggers FROM information_schema.triggers WHERE schema = 'pravia_os'",
      "SELECT function signatures FROM pg_proc WHERE schema = 'pravia_os'",
    ],
    migrations,
    structure: { tables, columns, constraints, indexes, enums, sequences, triggers, functions },
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2)}\n`);
  console.log(JSON.stringify({ ok: true, environment, read_only: identity.transaction_read_only, migration_records: migrations.length, output: outputPath }));
}

main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
