import { PrismaClient } from '@prisma/client';
import { resolveRuntimeConfig } from './runtime';

// Prevent multiple instances of Prisma Client in development
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const DEFAULT_DATABASE_SCHEMA = 'pravia_os';

/**
 * PRAVIA mantiene su modelo operativo en un esquema PostgreSQL dedicado.
 * Prisma usa `public` cuando la URL no incluye `?schema=...`, por lo que una
 * configuración incompleta puede conectar al servidor correcto y aun así
 * consultar las tablas equivocadas. Normalizamos solo la URL usada por el
 * runtime; nunca imprimimos ni persistimos credenciales.
 */
export function buildPrismaDatasourceUrl(rawUrl = resolveRuntimeConfig().database.url): string | undefined {
  if (!rawUrl) return undefined;

  try {
    const parsed = new URL(rawUrl);
    if (!parsed.searchParams.get('schema')) {
      parsed.searchParams.set(
        'schema',
        resolveRuntimeConfig().database.schema || DEFAULT_DATABASE_SCHEMA
      );
    }
    return parsed.toString();
  } catch {
    throw new Error('DATABASE_URL no tiene un formato PostgreSQL válido.');
  }
}

export const configuredDatabaseSchema = (() => {
  const datasourceUrl = buildPrismaDatasourceUrl();
  if (!datasourceUrl) return process.env.PRAVIA_DATABASE_SCHEMA || DEFAULT_DATABASE_SCHEMA;
  return new URL(datasourceUrl).searchParams.get('schema') || DEFAULT_DATABASE_SCHEMA;
})();

export const configuredDatabaseMode = resolveRuntimeConfig().database.mode;
export const configuredDatabasePrimary = resolveRuntimeConfig().database.primary;

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasourceUrl: buildPrismaDatasourceUrl(),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
