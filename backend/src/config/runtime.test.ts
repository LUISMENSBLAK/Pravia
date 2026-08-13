import { describe, expect, it } from 'vitest';
import { resolveRuntimeConfig, supabaseProjectRefFromDatabaseUrl, validateRuntimeConfig } from './runtime';

describe('infraestructura por modo', () => {
  it('mantiene nube como modo seguro predeterminado', () => {
    const env = { DATABASE_URL: 'postgres://cloud', DIRECT_URL: 'postgres://direct', SUPABASE_URL: 'https://storage', SUPABASE_SERVICE_ROLE_KEY: 'secret' };
    const config = resolveRuntimeConfig(env);
    expect(config.database).toMatchObject({ mode: 'cloud', primary: 'cloud', url: 'postgres://cloud' });
    expect(config.storage).toMatchObject({ mode: 'cloud', primary: 'cloud' });
    expect(validateRuntimeConfig(config, env)).toEqual([]);
  });

  it('selecciona infraestructura local sin condicionales de negocio', () => {
    const env = { PRAVIA_DATABASE_MODE: 'local', LOCAL_DATABASE_URL: 'postgres://local', LOCAL_DIRECT_URL: 'postgres://local-direct', STORAGE_MODE: 'local', LOCAL_STORAGE_PATH: '/srv/pravia/storage', LOCAL_STORAGE_SIGNING_SECRET: 'local-secret-with-more-than-32-characters' };
    const config = resolveRuntimeConfig(env);
    expect(config.database).toMatchObject({ primary: 'local', url: 'postgres://local' });
    expect(config.storage).toMatchObject({ primary: 'local', localPath: '/srv/pravia/storage' });
    expect(validateRuntimeConfig(config, env)).toEqual([]);
  });

  it('exige ambos lados en híbrido y no supone replicación', () => {
    const env = { PRAVIA_DATABASE_MODE: 'hybrid', PRAVIA_PRIMARY_DATABASE: 'cloud', CLOUD_DATABASE_URL: 'postgres://cloud', CLOUD_DIRECT_URL: 'postgres://direct', STORAGE_MODE: 'hybrid', PRAVIA_PRIMARY_STORAGE: 'cloud', SUPABASE_URL: 'https://storage', SUPABASE_SERVICE_ROLE_KEY: 'secret' };
    const errors = validateRuntimeConfig(resolveRuntimeConfig(env), env);
    expect(errors).toContain('El modo hybrid requiere URLs normales y directas para cloud/local, aunque solo use el primario seleccionado.');
    expect(errors.some((item) => item.includes('no activa replicación'))).toBe(true);
  });

  it('rechaza nombres de modo desconocidos', () => {
    expect(() => resolveRuntimeConfig({ PRAVIA_DATABASE_MODE: 'automatico' })).toThrow();
  });

  it('identifica referencias Supabase directas y por pooler', () => {
    expect(supabaseProjectRefFromDatabaseUrl('postgres://user:secret@db.ref-direct.supabase.co:5432/postgres')).toBe('ref-direct');
    expect(supabaseProjectRefFromDatabaseUrl('postgres://postgres.ref-pooler:secret@aws-0-region.pooler.supabase.com:6543/postgres')).toBe('ref-pooler');
  });

  it('bloquea la mezcla de base y Storage de proyectos Supabase distintos', () => {
    const env = {
      DATABASE_URL: 'postgres://user:secret@db.database-ref.supabase.co:5432/postgres',
      DIRECT_URL: 'postgres://user:secret@db.database-ref.supabase.co:5432/postgres',
      SUPABASE_URL: 'https://storage-ref.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    };
    expect(validateRuntimeConfig(resolveRuntimeConfig(env), env)).toContain(
      'La base de datos y Storage pertenecen a proyectos Supabase distintos.',
    );
  });
});
