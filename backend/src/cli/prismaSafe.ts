import { spawnSync } from 'node:child_process';
import { resolveRuntimeConfig, validateRuntimeConfig } from '../config/runtime';

export function urlWithSchema(rawUrl: string | undefined, schema: string) {
  if (!rawUrl) throw new Error('Falta una URL PostgreSQL para ejecutar Prisma.');
  const parsed = new URL(rawUrl);
  if (!/^postgres(?:ql)?:$/i.test(parsed.protocol)) throw new Error('La URL de Prisma debe ser PostgreSQL.');
  parsed.searchParams.set('schema', schema);
  return parsed.toString();
}

export function runPrismaSafely(args = process.argv.slice(2)) {
  const config = resolveRuntimeConfig();
  const errors = validateRuntimeConfig(config);
  if (errors.length) throw new Error(`Configuración Prisma inválida: ${errors.join(' ')}`);
  const operation = args.join(' ');
  if (operation === 'migrate deploy' && process.env.MIGRATION_CONFIRMATION !== 'APPLY_VERIFIED_MIGRATIONS') {
    throw new Error('MIGRATION_CONFIRMATION=APPLY_VERIFIED_MIGRATIONS es obligatorio para migrate deploy.');
  }
  if (!args.length) throw new Error('Indica el comando Prisma que deseas ejecutar.');
  const prismaCli = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: urlWithSchema(config.database.url, config.database.schema),
      DIRECT_URL: urlWithSchema(config.database.directUrl, config.database.schema),
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
}

if (require.main === module) {
  try {
    runPrismaSafely();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'No fue posible ejecutar Prisma de forma segura.');
    process.exitCode = 1;
  }
}
