import 'dotenv/config';
import { spawnSync } from 'child_process';
import { connectionArgs, existingBackupPath, explicitRestoreUrl, postgresEnv, run } from './database-tooling';

async function main() {
  if (process.env.RESTORE_CONFIRMATION !== 'RESTORE_INTO_EMPTY_VERIFIED_TARGET') {
    throw new Error('RESTORE_CONFIRMATION debe ser RESTORE_INTO_EMPTY_VERIFIED_TARGET.');
  }
  const backup = existingBackupPath();
  const url = explicitRestoreUrl();
  const check = spawnSync('psql', [
    ...connectionArgs(url), '--tuples-only', '--no-align', '--command',
    "select count(*) from information_schema.tables where table_schema='pravia_os';",
  ], { encoding: 'utf8', env: postgresEnv(url) });
  if (check.error) throw new Error(`psql no está disponible: ${check.error.message}`);
  if (check.status !== 0) throw new Error('No fue posible verificar que el destino esté vacío.');
  if (Number(check.stdout.trim()) !== 0) throw new Error('Restauración rechazada: el destino pravia_os no está vacío.');
  await run('pg_restore', [
    ...connectionArgs(url), '--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', backup,
  ], url);
  console.log('Restauración completada en el destino vacío verificado.');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
