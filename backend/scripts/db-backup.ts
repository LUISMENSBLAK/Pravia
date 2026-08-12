import 'dotenv/config';
import { existsSync } from 'fs';
import { connectionArgs, requiredBackupPath, run, selectedDatabaseUrl } from './database-tooling';

async function main() {
  const url = selectedDatabaseUrl();
  const backup = requiredBackupPath();
  if (existsSync(backup) && process.env.ALLOW_BACKUP_OVERWRITE !== 'true') {
    throw new Error('El respaldo ya existe. Elige otra ruta o confirma ALLOW_BACKUP_OVERWRITE=true.');
  }
  await run('pg_dump', [
    ...connectionArgs(url), '--format=custom', '--compress=6', '--schema=pravia_os',
    '--no-owner', '--no-privileges', '--file', backup,
  ], url);
  console.log(`Respaldo creado: ${backup}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
