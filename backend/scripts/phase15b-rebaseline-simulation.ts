import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const mode = process.argv[2];
const rawUrl = String(process.env.SIM_DATABASE_URL || '').trim();
const expectedFingerprint = String(process.env.EXPECTED_SCHEMA_FINGERPRINT || '').trim();
const inventoryPath = path.resolve(process.env.LEGACY_INVENTORY_PATH || '../docs/release/phase-15a/artifacts/production-readonly.json');
if (!['seed', 'cutover', 'rollback'].includes(mode)) throw new Error('Modo requerido: seed, cutover o rollback.');
if (process.env.PRAVIA_ENV !== 'staging' || !rawUrl) throw new Error('REFUSED_PRODUCTION_WRITE: simulación requiere PRAVIA_ENV=staging y SIM_DATABASE_URL.');

const identity = new URL(rawUrl);
if (identity.hostname !== '127.0.0.1' || identity.port !== '55434'
  || identity.pathname !== '/pravia_rebaseline_sim' || identity.searchParams.get('schema') !== 'pravia_os') {
  throw new Error('REFUSED_PRODUCTION_WRITE: destino no es la simulación local exacta de Fase 15B.');
}
const prisma = new PrismaClient({ datasources: { db: { url: rawUrl } } });
const legacyName = '_prisma_migrations_legacy_20260814';
const archiveSchema = 'pravia_migration_archive';

async function tableExists(name: string, schema = 'pravia_os') {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`, `${schema}.${name}`,
  );
  return rows[0]?.exists === true;
}

async function seed() {
  if (await tableExists('_prisma_migrations') || await tableExists(legacyName, archiveSchema)) {
    throw new Error('La simulación ya contiene metadata Prisma; seed rechazado.');
  }
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  if (!Array.isArray(inventory.migrations) || inventory.migrations.length !== 17) {
    throw new Error('El inventario legacy debe contener exactamente 17 migraciones.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE TABLE pravia_os."_prisma_migrations" (
      id varchar(36) PRIMARY KEY NOT NULL,
      checksum varchar(64) NOT NULL,
      finished_at timestamptz,
      migration_name varchar(255) NOT NULL,
      logs text,
      rolled_back_at timestamptz,
      started_at timestamptz NOT NULL DEFAULT now(),
      applied_steps_count integer NOT NULL DEFAULT 0
    )`);
    for (const row of inventory.migrations) {
      await tx.$executeRawUnsafe(
        `INSERT INTO pravia_os."_prisma_migrations"
          (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES ($1,$2,$3::timestamptz,$4,$5,$6::timestamptz,$7::timestamptz,$8)`,
        row.id, row.checksum, row.finished_at, row.migration_name, row.logs,
        row.rolled_back_at, row.started_at, row.applied_steps_count,
      );
    }
  });
  console.log(JSON.stringify({ ok: true, mode, legacy_rows: 17 }));
}

function verifyFingerprint() {
  if (!expectedFingerprint) throw new Error('EXPECTED_SCHEMA_FINGERPRINT es obligatorio.');
  const temporaryOutput = `/private/tmp/pravia-phase15b-cutover-fingerprint-${process.pid}.json`;
  const result = spawnSync(process.execPath, ['-r', 'ts-node/register', path.resolve(__dirname, 'phase15b-schema-fingerprint.ts')], {
    cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
    env: { ...process.env, AUDIT_DATABASE_URL: rawUrl, AUDIT_LABEL: 'rebaseline-simulation-preflight', AUDIT_OUTPUT_PATH: temporaryOutput },
  });
  try { fs.rmSync(temporaryOutput, { force: true }); } catch { /* no-op */ }
  if (result.status !== 0) throw new Error('REFUSED_SCHEMA_MISMATCH: el preflight estructural falló.');
}

async function cutover() {
  verifyFingerprint();
  if (!await tableExists('_prisma_migrations') || await tableExists(legacyName, archiveSchema)) {
    throw new Error('Metadata legacy no está en el estado previo esperado.');
  }
  const expected = JSON.parse(fs.readFileSync(inventoryPath, 'utf8')).migrations
    .map((row: any) => `${row.migration_name}:${row.checksum}`).sort();
  const actual = (await prisma.$queryRawUnsafe<Array<{ migration_name: string; checksum: string }>>(
    `SELECT migration_name, checksum FROM pravia_os."_prisma_migrations" ORDER BY migration_name`,
  )).map((row) => `${row.migration_name}:${row.checksum}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('REFUSED_SCHEMA_MISMATCH: lineage legacy no coincide con el inventario productivo aprobado.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`LOCK TABLE pravia_os."_prisma_migrations" IN ACCESS EXCLUSIVE MODE`);
    await tx.$executeRawUnsafe(`ALTER TABLE pravia_os."_prisma_migrations" RENAME TO "${legacyName}"`);
    await tx.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${archiveSchema}"`);
    await tx.$executeRawUnsafe(`ALTER TABLE pravia_os."${legacyName}" SET SCHEMA "${archiveSchema}"`);
    await tx.$executeRawUnsafe(`ALTER TABLE "${archiveSchema}"."${legacyName}"
      ADD COLUMN archived_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN archive_reason text NOT NULL DEFAULT 'Canonical rebaseline after exact S0 fingerprint verification',
      ADD COLUMN canonical_baseline_name text NOT NULL DEFAULT '20260812000000_canonical_production_baseline'`);
    await tx.$executeRawUnsafe(`COMMENT ON TABLE "${archiveSchema}"."${legacyName}" IS 'Immutable legacy Prisma lineage preserved during controlled Phase 15C rebaseline simulation V2'`);
  });
  console.log(JSON.stringify({ ok: true, mode, archived_schema: archiveSchema, archived_table: legacyName, legacy_rows: actual.length }));
}

async function rollback() {
  if (await tableExists('_prisma_migrations') || !await tableExists(legacyName, archiveSchema)) {
    throw new Error('Rollback rechazado: existe metadata canónica o falta la tabla legacy archivada.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`ALTER TABLE "${archiveSchema}"."${legacyName}" SET SCHEMA pravia_os`);
    await tx.$executeRawUnsafe(`ALTER TABLE pravia_os."${legacyName}" RENAME TO "_prisma_migrations"`);
    await tx.$executeRawUnsafe(`DROP SCHEMA "${archiveSchema}"`);
  });
  console.log(JSON.stringify({ ok: true, mode, restored: '_prisma_migrations' }));
}

const action = mode === 'seed' ? seed : mode === 'cutover' ? cutover : rollback;
action().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
