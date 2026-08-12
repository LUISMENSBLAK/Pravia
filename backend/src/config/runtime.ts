export type DatabaseMode = 'cloud' | 'local' | 'hybrid';
export type StorageMode = 'cloud' | 'local' | 'hybrid';
export type InfrastructureSide = 'cloud' | 'local';

type Environment = Record<string, string | undefined>;

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T, label: string): T => {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!allowed.includes(normalized as T)) throw new Error(`${label} no es válido: ${normalized}.`);
  return normalized as T;
};

const first = (...values: (string | undefined)[]) => values.find((value) => value?.trim())?.trim();

export interface RuntimeInfrastructureConfig {
  database: {
    mode: DatabaseMode;
    primary: InfrastructureSide;
    url?: string;
    directUrl?: string;
    schema: string;
  };
  storage: {
    mode: StorageMode;
    primary: InfrastructureSide;
    localPath?: string;
  };
}

export function resolveRuntimeConfig(env: Environment = process.env): RuntimeInfrastructureConfig {
  const databaseMode = oneOf(env.PRAVIA_DATABASE_MODE, ['cloud', 'local', 'hybrid'] as const, 'cloud', 'PRAVIA_DATABASE_MODE');
  const databasePrimary = databaseMode === 'hybrid'
    ? oneOf(env.PRAVIA_PRIMARY_DATABASE, ['cloud', 'local'] as const, 'cloud', 'PRAVIA_PRIMARY_DATABASE')
    : databaseMode;
  const storageMode = oneOf(env.STORAGE_MODE, ['cloud', 'local', 'hybrid'] as const, 'cloud', 'STORAGE_MODE');
  const storagePrimary = storageMode === 'hybrid'
    ? oneOf(env.PRAVIA_PRIMARY_STORAGE, ['cloud', 'local'] as const, 'cloud', 'PRAVIA_PRIMARY_STORAGE')
    : storageMode;

  const cloudUrl = first(env.CLOUD_DATABASE_URL, databaseMode === 'cloud' ? env.DATABASE_URL : undefined);
  const localUrl = first(env.LOCAL_DATABASE_URL, databaseMode === 'local' ? env.DATABASE_URL : undefined);
  const cloudDirectUrl = first(env.CLOUD_DIRECT_URL, databaseMode === 'cloud' ? env.DIRECT_URL : undefined, cloudUrl);
  const localDirectUrl = first(env.LOCAL_DIRECT_URL, databaseMode === 'local' ? env.DIRECT_URL : undefined, localUrl);

  return {
    database: {
      mode: databaseMode,
      primary: databasePrimary,
      url: databasePrimary === 'cloud' ? cloudUrl : localUrl,
      directUrl: databasePrimary === 'cloud' ? cloudDirectUrl : localDirectUrl,
      schema: env.PRAVIA_DATABASE_SCHEMA?.trim() || 'pravia_os',
    },
    storage: {
      mode: storageMode,
      primary: storagePrimary,
      localPath: env.LOCAL_STORAGE_PATH?.trim() || undefined,
    },
  };
}

export function validateRuntimeConfig(config: RuntimeInfrastructureConfig, env: Environment = process.env): string[] {
  const errors: string[] = [];
  if (!config.database.url) errors.push(`Falta la URL de la base ${config.database.primary}.`);
  if (!config.database.directUrl) errors.push(`Falta la URL directa de la base ${config.database.primary}.`);
  if (config.database.schema !== 'pravia_os') errors.push(`El esquema debe ser pravia_os; se configuró ${config.database.schema}.`);
  if (config.database.mode === 'hybrid' && (!env.CLOUD_DATABASE_URL?.trim() || !env.LOCAL_DATABASE_URL?.trim() || !env.CLOUD_DIRECT_URL?.trim() || !env.LOCAL_DIRECT_URL?.trim())) {
    errors.push('El modo hybrid requiere URLs normales y directas para cloud/local, aunque solo use el primario seleccionado.');
  }
  if (config.storage.primary === 'cloud' && (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim())) {
    errors.push('El almacenamiento cloud requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (config.storage.primary === 'local') {
    if (!config.storage.localPath) errors.push('El almacenamiento local requiere LOCAL_STORAGE_PATH.');
    if ((env.LOCAL_STORAGE_SIGNING_SECRET || '').length < 32) errors.push('LOCAL_STORAGE_SIGNING_SECRET debe tener al menos 32 caracteres.');
  }
  if (config.storage.mode === 'hybrid' && (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim() || !config.storage.localPath || (env.LOCAL_STORAGE_SIGNING_SECRET || '').length < 32)) {
    errors.push('El modo hybrid requiere configuración cloud y LOCAL_STORAGE_PATH; no activa replicación automática.');
  }
  return errors;
}
