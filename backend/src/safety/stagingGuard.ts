import { supabaseProjectRefFromDatabaseUrl, supabaseProjectRefFromStorageUrl } from '../config/runtime';

type Environment = Record<string, string | undefined>;

export interface DatabaseIdentity {
  host: string;
  port: string;
  database: string;
  schema: string;
  projectRef?: string;
}

export class ProductionWriteRefusedError extends Error {
  readonly code = 'REFUSED_PRODUCTION_WRITE';

  constructor(reason: string) {
    super(`REFUSED_PRODUCTION_WRITE: ${reason}`);
    this.name = 'ProductionWriteRefusedError';
  }
}

export function databaseIdentity(rawUrl: string): DatabaseIdentity {
  const url = new URL(rawUrl);
  if (!/^postgres(?:ql)?:$/i.test(url.protocol)) throw new ProductionWriteRefusedError('la conexión objetivo no es PostgreSQL.');
  return {
    host: url.hostname.toLowerCase(),
    port: url.port || '5432',
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    schema: url.searchParams.get('schema') || 'public',
    projectRef: supabaseProjectRefFromDatabaseUrl(rawUrl),
  };
}

const sameDatabase = (left: DatabaseIdentity, right: DatabaseIdentity) => (
  left.host === right.host
  && left.port === right.port
  && left.database === right.database
  && left.schema === right.schema
);

const required = (env: Environment, name: string) => {
  const value = env[name]?.trim();
  if (!value) throw new ProductionWriteRefusedError(`falta ${name}.`);
  return value;
};

export function assertStagingWriteTarget(env: Environment = process.env) {
  if (env.PRAVIA_ENV !== 'staging') throw new ProductionWriteRefusedError('PRAVIA_ENV debe ser staging.');

  const stagingUrl = required(env, 'STAGING_DATABASE_URL');
  const staging = databaseIdentity(stagingUrl);
  const expected = {
    host: required(env, 'EXPECTED_STAGING_DATABASE_HOST').toLowerCase(),
    port: env.EXPECTED_STAGING_DATABASE_PORT?.trim() || '5432',
    database: required(env, 'EXPECTED_STAGING_DATABASE_NAME'),
    schema: required(env, 'EXPECTED_STAGING_DATABASE_SCHEMA'),
  };
  if (staging.host !== expected.host || staging.port !== expected.port || staging.database !== expected.database || staging.schema !== expected.schema) {
    throw new ProductionWriteRefusedError('host, puerto, base o schema no coincide con la identidad de staging esperada.');
  }
  if (staging.schema !== 'pravia_os') throw new ProductionWriteRefusedError('el schema de staging debe ser pravia_os.');

  const productionUrls = [env.PRODUCTION_DATABASE_URL, env.CLOUD_DATABASE_URL]
    .filter((value): value is string => Boolean(value?.trim()));
  for (const productionUrl of productionUrls) {
    const production = databaseIdentity(productionUrl);
    if (sameDatabase(staging, production)) throw new ProductionWriteRefusedError('la base objetivo coincide con producción.');
    if (staging.projectRef && production.projectRef && staging.projectRef === production.projectRef) {
      throw new ProductionWriteRefusedError('el project ref objetivo coincide con producción.');
    }
  }

  const storageMode = required(env, 'STAGING_STORAGE_MODE').toLowerCase();
  if (storageMode === 'cloud') {
    const storageRef = supabaseProjectRefFromStorageUrl(required(env, 'STAGING_SUPABASE_URL'));
    const expectedRef = required(env, 'EXPECTED_STAGING_SUPABASE_PROJECT_REF');
    if (!staging.projectRef || staging.projectRef !== expectedRef || storageRef !== expectedRef) {
      throw new ProductionWriteRefusedError('DB y Storage staging no comparten el project ref esperado.');
    }
    const productionRef = supabaseProjectRefFromStorageUrl(env.PRODUCTION_SUPABASE_URL || env.SUPABASE_URL);
    if (productionRef && productionRef === expectedRef) throw new ProductionWriteRefusedError('Storage staging coincide con producción.');
  } else if (storageMode === 'local') {
    const path = required(env, 'STAGING_LOCAL_STORAGE_PATH');
    if (!path.includes('staging')) throw new ProductionWriteRefusedError('el path local debe identificar staging explícitamente.');
    if (env.PRODUCTION_LOCAL_STORAGE_PATH && path === env.PRODUCTION_LOCAL_STORAGE_PATH) {
      throw new ProductionWriteRefusedError('Storage local staging coincide con producción.');
    }
  } else {
    throw new ProductionWriteRefusedError('STAGING_STORAGE_MODE debe ser cloud o local.');
  }

  return { database: staging, storageMode };
}
