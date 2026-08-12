import 'dotenv/config';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { postgresEnv } from './database-tooling';

const confirmation = 'INITIALIZE_EMPTY_PRAVIA_TARGET';

function explicitTargetUrl() {
  const raw = String(process.env.INIT_DATABASE_URL || '').trim();
  if (!raw) throw new Error('INIT_DATABASE_URL es obligatoria y debe apuntar a una base nueva.');
  const url = new URL(raw);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('INIT_DATABASE_URL debe usar PostgreSQL.');
  }
  if (url.searchParams.get('schema') !== 'pravia_os') {
    throw new Error('INIT_DATABASE_URL debe incluir schema=pravia_os.');
  }
  return url;
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

async function main() {
  if (process.env.INIT_CONFIRMATION !== confirmation) {
    throw new Error(`INIT_CONFIRMATION debe ser ${confirmation}.`);
  }
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
