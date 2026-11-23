import { describe, expect, it } from 'vitest';
import { configuredCfdiProvider, sandboxRuntimeAllowed } from './cfdiRuntimeProvider';
const local = { CFDI_PROVIDER: 'FACTURAMA_SANDBOX', NODE_ENV: 'test', PRAVIA_DATABASE_MODE: 'local', STORAGE_MODE: 'local',
  DATABASE_URL: 'postgresql://synthetic:qa@127.0.0.1:55521/pravia_client_qa', LOCAL_STORAGE_PATH: '/tmp/pravia-synthetic',
  FACTURAMA_SANDBOX_USERNAME: 'synthetic', FACTURAMA_SANDBOX_PASSWORD: 'not-a-real-key' };
describe('PAC runtime local opt-in', () => {
  it('selects sandbox only with isolated local DB and Storage', () => { expect(sandboxRuntimeAllowed(local)).toBe(true); expect(configuredCfdiProvider(local).id).toBe('FACTURAMA_SANDBOX'); });
  it.each([{NODE_ENV:'production'}, {DATABASE_URL:'postgresql://invalid.example/db'}, {DIRECT_URL:'postgresql://invalid.example/db'}, {LOCAL_DATABASE_URL:'postgresql://invalid.example/db'}, {LOCAL_DIRECT_URL:'postgresql://invalid.example/db'}, {DATABASE_URL:'https://localhost/db'}, {STORAGE_MODE:'supabase'}, {SUPABASE_URL:'https://invalid.example'}, {SUPABASE_SERVICE_ROLE_KEY:'not-real'}, {CFDI_PROVIDER:'FACTURAMA_PRODUCTION'}, {LOCAL_STORAGE_PATH:''}, {FACTURAMA_SANDBOX_PASSWORD:''}])('fails closed for %j', (patch) => {
    expect(configuredCfdiProvider({...local,...patch}).configured).toBe(false);
  });
});
