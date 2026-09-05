import { PrismaClient } from '@prisma/client';
import { canonicalDatabaseFingerprint, canonicalJson } from '../src/domain/complianceH6';

const raw = process.env.DATABASE_URL || '';
const url = new URL(raw);
if (
  process.env.H10_DB_CONFIRMATION !== 'READ_ISOLATED_H10_POSTGRESQL'
  || raw !== process.env.DIRECT_URL
  || url.hostname !== '127.0.0.1'
  || !['55474', '55475', '55476'].includes(url.port)
  || !/^\/pravia_h10_[abc]$/.test(url.pathname)
) throw new Error('H10 fingerprint requires an explicitly named isolated local A/B/C database.');

async function inspect(targetUrl: string) {
  const targetDb = new PrismaClient({ datasources: { db: { url: targetUrl } } });
  try {
  const columns = await targetDb.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'pravia_os'
    ORDER BY table_name, column_name
  `);
  const constraints = await targetDb.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT t.relname AS table_name, c.conname AS name, c.contype AS type,
      pg_get_constraintdef(c.oid, true) AS definition
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE n.nspname = 'pravia_os' AND c.contype <> 'u'
    ORDER BY t.relname, c.conname
  `);
  const indexes = await targetDb.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'pravia_os'
    ORDER BY tablename, indexname
  `);
  const enums = await targetDb.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT t.typname AS enum_name, e.enumlabel AS enum_value, e.enumsortorder::text AS enum_order
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pravia_os'
    ORDER BY t.typname, e.enumsortorder
  `);
  const functions = await targetDb.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS arguments,
      pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pravia_os'
    ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
  `);
  const triggers = await targetDb.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT t.relname AS table_name, g.tgname AS trigger_name,
      pg_get_triggerdef(g.oid, true) AS definition
    FROM pg_trigger g
    JOIN pg_class t ON t.oid = g.tgrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'pravia_os' AND NOT g.tgisinternal
    ORDER BY t.relname, g.tgname
  `);
  return { columns, constraints, indexes, enums, functions, triggers };
  } finally {
    await targetDb.$disconnect();
  }
}

function validateComparisonUrl(value: string) {
  const candidate = new URL(value);
  if (candidate.hostname !== '127.0.0.1' || !['55474', '55475', '55476'].includes(candidate.port) || !/^\/pravia_h10_[abc]$/.test(candidate.pathname)) {
    throw new Error('H10 comparison target is not an isolated local A/B/C database.');
  }
}

async function main() {
  const sections = await inspect(raw);
  console.log(JSON.stringify({
    algorithm: 'h10-global-logical-schema-v1',
    database: url.pathname.slice(1),
    fingerprint: canonicalDatabaseFingerprint(sections),
    counts: Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, value.length])),
  }));
  const compareUrl = process.env.H10_COMPARE_URL;
  if (compareUrl) {
    validateComparisonUrl(compareUrl);
    const compared = await inspect(compareUrl);
    for (const key of Object.keys(sections) as Array<keyof typeof sections>) {
      const left = new Set(sections[key].map((item) => canonicalJson(item)));
      const right = new Set(compared[key].map((item) => canonicalJson(item)));
      const onlyPrimary = [...left].filter((item) => !right.has(item));
      const onlyCompared = [...right].filter((item) => !left.has(item));
      if (onlyPrimary.length || onlyCompared.length) console.log(JSON.stringify({ section: key, onlyPrimary, onlyCompared }));
    }
  }
}

main();
