import { describe, expect, it } from 'vitest';
import { resolveRuntimeConfig } from '../config/runtime';
import { assertStagingRuntime, assertStagingWriteTarget, databaseIdentity } from './stagingGuard';

const base = {
  PRAVIA_ENV: 'staging',
  STAGING_DATABASE_URL: 'postgresql://staging:secret@127.0.0.1:55433/pravia_staging?schema=pravia_os',
  EXPECTED_STAGING_DATABASE_HOST: '127.0.0.1',
  EXPECTED_STAGING_DATABASE_PORT: '55433',
  EXPECTED_STAGING_DATABASE_NAME: 'pravia_staging',
  EXPECTED_STAGING_DATABASE_SCHEMA: 'pravia_os',
  STAGING_STORAGE_MODE: 'local',
  STAGING_LOCAL_STORAGE_PATH: '/private/tmp/pravia-staging-storage',
};

const runtimeEnv = {
  ...base,
  NODE_ENV: 'production',
  PRAVIA_DATABASE_MODE: 'local',
  LOCAL_DATABASE_URL: base.STAGING_DATABASE_URL,
  LOCAL_DIRECT_URL: base.STAGING_DATABASE_URL,
  STAGING_DIRECT_URL: base.STAGING_DATABASE_URL,
  STORAGE_MODE: 'local',
  LOCAL_STORAGE_PATH: base.STAGING_LOCAL_STORAGE_PATH,
  LOCAL_STORAGE_SIGNING_SECRET: 'local-staging-signing-secret-with-32-characters',
  PRODUCTION_DATABASE_URL: 'postgresql://prod:secret@db.production.supabase.co:5432/postgres?schema=pravia_os',
  PRODUCTION_SUPABASE_URL: 'https://production.supabase.co',
};

describe('stagingGuard', () => {
  it('extrae una identidad sin exponer credenciales', () => {
    expect(databaseIdentity(base.STAGING_DATABASE_URL)).toEqual({
      host: '127.0.0.1', port: '55433', database: 'pravia_staging', schema: 'pravia_os', projectRef: undefined,
    });
  });

  it('acepta una base y Storage staging aislados', () => {
    expect(assertStagingWriteTarget(base)).toMatchObject({ storageMode: 'local' });
  });

  it('rechaza si no se declara staging', () => {
    expect(() => assertStagingWriteTarget({ ...base, PRAVIA_ENV: 'production' })).toThrow(/^REFUSED_PRODUCTION_WRITE:/);
  });

  it('rechaza la identidad exacta de producción', () => {
    expect(() => assertStagingWriteTarget({ ...base, PRODUCTION_DATABASE_URL: base.STAGING_DATABASE_URL })).toThrow(/REFUSED_PRODUCTION_WRITE: la base objetivo coincide/);
  });

  it('rechaza una mezcla de project refs cloud', () => {
    const env = {
      ...base,
      STAGING_DATABASE_URL: 'postgresql://postgres.stagingref:secret@aws-0-us.pooler.supabase.com:6543/postgres?schema=pravia_os',
      EXPECTED_STAGING_DATABASE_HOST: 'aws-0-us.pooler.supabase.com',
      EXPECTED_STAGING_DATABASE_PORT: '6543',
      EXPECTED_STAGING_DATABASE_NAME: 'postgres',
      STAGING_STORAGE_MODE: 'cloud',
      STAGING_SUPABASE_URL: 'https://productionref.supabase.co',
      EXPECTED_STAGING_SUPABASE_PROJECT_REF: 'stagingref',
    };
    expect(() => assertStagingWriteTarget(env)).toThrow(/REFUSED_PRODUCTION_WRITE: DB y Storage staging/);
  });

  it('permite iniciar el backend únicamente con las conexiones staging declaradas', () => {
    expect(() => assertStagingRuntime(resolveRuntimeConfig(runtimeEnv), runtimeEnv)).not.toThrow();
  });

  it('rechaza staging sin fingerprint productivo explícito', () => {
    const env = { ...runtimeEnv, PRODUCTION_DATABASE_URL: '' };
    expect(() => assertStagingRuntime(resolveRuntimeConfig(env), env)).toThrow(/falta PRODUCTION_DATABASE_URL/);
  });

  it('rechaza una DB activa distinta de la declarada para staging', () => {
    const env = { ...runtimeEnv, LOCAL_DATABASE_URL: runtimeEnv.PRODUCTION_DATABASE_URL };
    expect(() => assertStagingRuntime(resolveRuntimeConfig(env), env)).toThrow(/conexión DB activa/);
  });

  it('rechaza la conexión directa productiva aun con la conexión principal staging', () => {
    const env = { ...runtimeEnv, LOCAL_DIRECT_URL: runtimeEnv.PRODUCTION_DATABASE_URL, STAGING_DIRECT_URL: runtimeEnv.PRODUCTION_DATABASE_URL };
    expect(() => assertStagingRuntime(resolveRuntimeConfig(env), env)).toThrow(/conexión DB directa de staging coincide con producción/);
  });

  it('rechaza Storage activo distinto del path staging declarado', () => {
    const env = { ...runtimeEnv, LOCAL_STORAGE_PATH: '/private/tmp/other-storage' };
    expect(() => assertStagingRuntime(resolveRuntimeConfig(env), env)).toThrow(/path Storage activo/);
  });
});
