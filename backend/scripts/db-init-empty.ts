import 'dotenv/config';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { postgresEnv } from './database-tooling';
import {
  assertEmptyBootstrapConfirmation,
  buildHistoricalArtifactPlan,
  HistoricalArtifact,
  HistoricalArtifactPlan,
  isObsoleteHistoricalArtifactError,
  planFromHistoricalArtifacts,
  validateEmptyBootstrapTarget,
} from './db-init-empty-artifacts';

function explicitTargetUrl() {
  return validateEmptyBootstrapTarget(process.env.INIT_DATABASE_URL);
}

function prisma(args: string[], url: URL) {
  const result = spawnSync('npx', ['prisma', ...args], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    stdio: 'inherit',
    env: {
      ...postgresEnv(url),
      DATABASE_URL: url.toString(),
      DIRECT_URL: url.toString(),
    },
  });
  if (result.error) throw new Error(`No fue posible ejecutar Prisma: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Prisma terminó con código ${result.status}.`);
}

async function countApplicationTables(url: URL) {
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    const result = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
      "select count(*)::bigint as count from information_schema.tables where table_schema in ('pravia_os', 'public')",
    );
    return Number(result[0]?.count || 0);
  } finally {
    await client.$disconnect();
  }
}

async function verifyHistoricalArtifacts(url: URL, plan: HistoricalArtifactPlan) {
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    const rows = await client.$queryRawUnsafe<Array<{ kind: string; name: string }>>(`
      SELECT 'FUNCTION' AS kind, p.proname AS name
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'pravia_os'
      UNION ALL
      SELECT 'TRIGGER', t.tgname
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'pravia_os' AND NOT t.tgisinternal
      UNION ALL
      SELECT 'CHECK', c.conname
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'pravia_os' AND c.contype = 'c'
      UNION ALL
      SELECT 'INDEX', indexname FROM pg_indexes WHERE schemaname = 'pravia_os'
      UNION ALL
      SELECT 'SEQUENCE', c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'pravia_os' AND c.relkind = 'S'
      UNION ALL
      SELECT 'EXTENSION', e.extname FROM pg_extension e
      UNION ALL
      SELECT 'RLS', c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'pravia_os' AND c.relrowsecurity
      UNION ALL
      SELECT 'POLICY', p.policyname
      FROM pg_policies p
      WHERE p.schemaname = 'pravia_os'
    `);
    const present = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!present.has(row.kind)) present.set(row.kind, new Set());
      present.get(row.kind)!.add(row.name);
    }
    const expected = [
      ['EXTENSION', plan.expected.extensions],
      ['FUNCTION', plan.expected.functions],
      ['TRIGGER', plan.expected.triggers],
      ['CHECK', plan.expected.checks],
      ['INDEX', plan.expected.indexes],
      ['SEQUENCE', plan.expected.sequences],
      ['RLS', plan.expected.rlsTables],
      ['POLICY', plan.expected.policies],
    ] as const;
    const missing = expected.flatMap(([kind, names]) => names.filter((name) => !present.get(kind)?.has(name)).map((name) => `${kind}:${name}`));
    if (missing.length) throw new Error(`Artefactos históricos ausentes: ${missing.join(', ')}.`);
    if (!present.get('FUNCTION')?.has('enforce_same_organization')) {
      throw new Error('La función multitenant enforce_same_organization no quedó restaurada.');
    }
  } finally {
    await client.$disconnect();
  }
}

async function restoreHistoricalArtifacts(url: URL, plan: HistoricalArtifactPlan) {
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const restored: HistoricalArtifact[] = [];
  const obsolete: HistoricalArtifact[] = [];
  try {
    await client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe('SET LOCAL search_path TO pravia_os, public');
      for (const [index, artifact] of plan.artifacts.entries()) {
        const savepoint = `historical_artifact_${index}`;
        await transaction.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
        try {
          await transaction.$executeRawUnsafe(artifact.sql);
          restored.push(artifact);
          await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (error) {
          await transaction.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          if (!isObsoleteHistoricalArtifactError(error)) throw error;
          obsolete.push(artifact);
          await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
        }
      }
    }, { maxWait: 30_000, timeout: 300_000 });
  } finally {
    await client.$disconnect();
  }
  if (!restored.some((artifact) => artifact.kind === 'FUNCTION' && /\benforce_same_organization\b/i.test(artifact.sql))) {
    throw new Error('La restauración aplicable no contiene enforce_same_organization.');
  }
  for (const artifact of obsolete) {
    console.warn(`Artefacto histórico obsoleto omitido: ${artifact.migration} · ${artifact.kind}.`);
  }
  return planFromHistoricalArtifacts(restored);
}

async function main() {
  assertEmptyBootstrapConfirmation(process.env.INIT_CONFIRMATION);
  const url = explicitTargetUrl();
  if (await countApplicationTables(url) !== 0) {
    throw new Error('Inicialización rechazada: el destino ya contiene tablas en public o pravia_os.');
  }

  const backendRoot = path.resolve(__dirname, '..');
  const migrationsRoot = path.join(backendRoot, 'prisma', 'migrations');
  const migrationNames = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (migrationNames.length === 0) throw new Error('No se encontraron migraciones para registrar en la línea base.');

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'pravia-baseline-'));
  const baselineFile = path.join(temporaryDirectory, 'baseline.sql');
  try {
    prisma([
      'migrate', 'diff',
      '--from-empty',
      '--to-schema-datamodel', 'prisma/schema.prisma',
      '--script',
      '--output', baselineFile,
    ], url);
    const baselineSql = await readFile(baselineFile, 'utf8');
    await writeFile(baselineFile, `BEGIN;\n${baselineSql}\nCOMMIT;\n`, { mode: 0o600 });
    prisma(['db', 'execute', '--file', baselineFile, '--schema', 'prisma/schema.prisma'], url);

    const historicalPlan = await buildHistoricalArtifactPlan(migrationsRoot, migrationNames);
    const restoredPlan = await restoreHistoricalArtifacts(url, historicalPlan);
    const missingFkIndexes = `DO $$
      DECLARE fk record;
      BEGIN
        FOR fk IN
          SELECT
            c.conname,
            t.relname AS table_name,
            string_agg(quote_ident(a.attname), ', ' ORDER BY keys.ordinality) AS columns_sql
          FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN unnest(c.conkey) WITH ORDINALITY AS keys(attnum, ordinality) ON true
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = keys.attnum
          WHERE c.contype = 'f'
            AND n.nspname = 'pravia_os'
            AND NOT EXISTS (
              SELECT 1 FROM pg_index i
              WHERE i.indrelid = c.conrelid
                AND i.indisvalid
                AND i.indisready
                AND c.conkey <@ i.indkey::smallint[]
            )
          GROUP BY c.conname, t.relname
        LOOP
          EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON pravia_os.%I (%s)',
            left('idx_fk_' || fk.table_name || '_' || substr(md5(fk.conname), 1, 8), 63),
            fk.table_name,
            fk.columns_sql
          );
        END LOOP;
      END $$;`;
    const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    try {
      await client.$executeRawUnsafe(missingFkIndexes);
    } finally {
      await client.$disconnect();
    }
    await verifyHistoricalArtifacts(url, restoredPlan);
    for (const migrationName of migrationNames) {
      prisma(['migrate', 'resolve', '--applied', migrationName, '--schema', 'prisma/schema.prisma'], url);
    }
    prisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], url);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  console.log(`Base PRAVIA inicializada y ${migrationNames.length} migraciones registradas en un destino vacío.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
