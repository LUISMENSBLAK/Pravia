import { spawnSync } from 'node:child_process';
import { assertStagingWriteTarget } from '../safety/stagingGuard';

export function runPrismaOnStaging(args = process.argv.slice(2)) {
  if (!args.length) throw new Error('Indica el comando Prisma para staging.');
  const target = assertStagingWriteTarget();
  const operation = args.join(' ');
  if (operation === 'migrate deploy' && process.env.MIGRATION_CONFIRMATION !== 'APPLY_VERIFIED_MIGRATIONS') {
    throw new Error('MIGRATION_CONFIRMATION=APPLY_VERIFIED_MIGRATIONS es obligatorio para migrate deploy en staging.');
  }
  const prismaCli = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: process.env.STAGING_DATABASE_URL, DIRECT_URL: process.env.STAGING_DIRECT_URL || process.env.STAGING_DATABASE_URL },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
  return target;
}

if (require.main === module) {
  try {
    runPrismaOnStaging();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'No fue posible ejecutar Prisma en staging.');
    process.exitCode = 1;
  }
}
