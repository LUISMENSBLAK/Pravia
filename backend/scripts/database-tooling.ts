import { spawn } from 'child_process';
import path from 'path';
import { existsSync } from 'fs';
import { resolveRuntimeConfig } from '../src/config/runtime';

export function selectedDatabaseUrl() {
  const url = resolveRuntimeConfig().database.url;
  if (!url) throw new Error('No hay URL configurada para la base primaria seleccionada.');
  return new URL(url);
}

export function explicitRestoreUrl() {
  const raw = String(process.env.RESTORE_DATABASE_URL || '').trim();
  if (!raw) throw new Error('RESTORE_DATABASE_URL es obligatoria y debe apuntar a un destino vacío verificado.');
  return new URL(raw);
}

export const connectionArgs = (url: URL) => [
  '--host', url.hostname,
  '--port', url.port || '5432',
  '--username', decodeURIComponent(url.username),
  '--dbname', decodeURIComponent(url.pathname.replace(/^\//, '')),
];

export const postgresEnv = (url: URL) => ({ ...process.env, PGPASSWORD: decodeURIComponent(url.password) });

export async function run(command: string, args: string[], url: URL) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: postgresEnv(url) });
    child.on('error', (error: any) => reject(new Error(`${command} no está disponible: ${error.message}`)));
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} terminó con código ${code}.`)));
  });
}

export function requiredBackupPath() {
  const backup = String(process.env.BACKUP_FILE || '').trim();
  if (!backup || !path.isAbsolute(backup)) throw new Error('BACKUP_FILE debe ser una ruta absoluta y acotada.');
  if (path.resolve(backup) === path.parse(backup).root) throw new Error('BACKUP_FILE no puede apuntar a la raíz del sistema.');
  return path.resolve(backup);
}

export function existingBackupPath() {
  const backup = requiredBackupPath();
  if (!existsSync(backup)) throw new Error('El archivo BACKUP_FILE no existe.');
  return backup;
}
