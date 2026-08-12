import { access, mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { createHmac, timingSafeEqual } from 'crypto';
import path from 'path';
import type { StorageProvider } from './storage.types';

const localRoot = () => {
  const configured = String(process.env.LOCAL_STORAGE_PATH || '').trim();
  if (!configured || !path.isAbsolute(configured) || path.resolve(configured) === path.parse(configured).root) {
    throw new Error('LOCAL_STORAGE_PATH debe ser una ruta absoluta y acotada.');
  }
  return path.resolve(configured);
};

export function resolveLocalStoragePath(key: string) {
  const root = localRoot();
  const normalized = String(key || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..') || normalized.includes('\0')) {
    throw new Error('storage_key local no es válido.');
  }
  const target = path.resolve(root, normalized);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('storage_key fuera del directorio permitido.');
  return target;
}

const signingSecret = () => {
  const secret = process.env.LOCAL_STORAGE_SIGNING_SECRET || '';
  if (secret.length < 32) throw new Error('LOCAL_STORAGE_SIGNING_SECRET debe tener al menos 32 caracteres.');
  return secret;
};

const signatureFor = (key: string, expires: number) => createHmac('sha256', signingSecret()).update(`${expires}:${key}`).digest('hex');

export function verifyLocalStorageSignature(key: string, expires: number, signature: string) {
  if (!Number.isInteger(expires) || expires <= Math.floor(Date.now() / 1000) || expires > Math.floor(Date.now() / 1000) + 3600) return false;
  const expected = Buffer.from(signatureFor(key, expires));
  const received = Buffer.from(String(signature || ''));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export class LocalStorageProvider implements StorageProvider {
  readonly id = 'filesystem-local';
  async upload(buffer: Buffer, key: string) {
    const target = resolveLocalStoragePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer, { flag: 'wx', mode: 0o600 });
    return key;
  }
  async download(key: string) { return readFile(resolveLocalStoragePath(key)); }
  async delete(key: string) {
    try { await unlink(resolveLocalStoragePath(key)); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  async signedUrl(key: string, expiresInSeconds: number) {
    resolveLocalStoragePath(key);
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const base = String(process.env.PUBLIC_API_URL || '').replace(/\/$/, '');
    return `${base}/api/storage/local?key=${encodeURIComponent(key)}&expires=${expires}&signature=${signatureFor(key, expires)}`;
  }
  async health() {
    try { await access(localRoot(), constants.R_OK | constants.W_OK); return 'ok' as const; }
    catch { return process.env.LOCAL_STORAGE_PATH ? 'error' as const : 'not_configured' as const; }
  }
}
