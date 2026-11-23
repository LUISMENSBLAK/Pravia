import { DisabledCfdiProvider, type CfdiProvider } from './cfdiProvider';
import { FacturamaSandboxProvider } from './facturamaSandboxProvider';
import { resolveRuntimeConfig } from '../config/runtime';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';

/** Opt-in is deliberately local-only. Never selects a production PAC or uses
 * the application's production DB/Storage with test fiscal credentials. */
export function sandboxRuntimeAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const url = new URL(env.DATABASE_URL || '');
    const direct = new URL(env.DIRECT_URL || env.DATABASE_URL || '');
    const runtime = resolveRuntimeConfig(env);
    const effective = new URL(runtime.database.url || '');
    const effectiveDirect = new URL(runtime.database.directUrl || '');
    return env.CFDI_PROVIDER === 'FACTURAMA_SANDBOX' && env.NODE_ENV !== 'production'
      && env.PRAVIA_DATABASE_MODE === 'local' && env.STORAGE_MODE === 'local'
      && Boolean(env.LOCAL_STORAGE_PATH) && !env.SUPABASE_URL && !env.SUPABASE_SERVICE_ROLE_KEY
      && [url, direct, effective, effectiveDirect].every((value) => ['postgres:', 'postgresql:'].includes(value.protocol)
        && ['127.0.0.1', 'localhost', '[::1]'].includes(value.hostname));
  } catch { return false; }
}

export function configuredCfdiProvider(env: NodeJS.ProcessEnv = process.env): CfdiProvider {
  if (!sandboxRuntimeAllowed(env)) return new DisabledCfdiProvider();
  let username = env.FACTURAMA_SANDBOX_USERNAME, password = env.FACTURAMA_SANDBOX_PASSWORD;
  // Optional private local file is never loaded before the isolation guard and
  // never changes DB/Storage config. Keep it out of Git with owner-only access.
  if (env === process.env && (!username || !password)) {
    try {
      const filename = path.resolve(__dirname, '../../.env.facturama.sandbox.local');
      const stat = lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) return new DisabledCfdiProvider();
      const values = parse(readFileSync(filename));
      username = username || values.FACTURAMA_SANDBOX_USERNAME;
      password = password || values.FACTURAMA_SANDBOX_PASSWORD;
    } catch { return new DisabledCfdiProvider(); }
  }
  if (!username || !password) return new DisabledCfdiProvider();
  return new FacturamaSandboxProvider({ username, password });
}
