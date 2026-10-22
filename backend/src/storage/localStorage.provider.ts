import { access, copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { createHmac, timingSafeEqual } from 'crypto';
import path from 'path';
import type { StorageListPage, StorageObjectMetadata, StorageProvider } from './storage.types';

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
  readonly capabilities = { head: true, copy: true, list: true, resumable: true, multipart: false } as const;
  async upload(buffer: Buffer, key: string) {
    const target = resolveLocalStoragePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer, { flag: 'wx', mode: 0o600 });
    return key;
  }
  async uploadFile(filename: string, key: string) {
    const target = resolveLocalStoragePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(filename, target, constants.COPYFILE_EXCL);
    return key;
  }
  async download(key: string) { return readFile(resolveLocalStoragePath(key)); }
  async downloadFile(key: string, filename: string) { await copyFile(resolveLocalStoragePath(key), filename, constants.COPYFILE_EXCL); }
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
  async exists(key: string) {
    try { await access(resolveLocalStoragePath(key), constants.R_OK); return true; }
    catch { return false; }
  }
  async head(key: string): Promise<StorageObjectMetadata | null> {
    try {
      const metadata = await stat(resolveLocalStoragePath(key));
      return { key, size: metadata.size, updatedAt: metadata.mtime };
    } catch (error: any) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async copy(sourceKey: string, destinationKey: string) {
    const destination = resolveLocalStoragePath(destinationKey);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(resolveLocalStoragePath(sourceKey), destination, constants.COPYFILE_EXCL);
    return destinationKey;
  }
  async list(prefix: string, cursor?: string, limit = 100): Promise<StorageListPage> {
    const normalizedPrefix = String(prefix || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const base = normalizedPrefix ? resolveLocalStoragePath(`${normalizedPrefix}/.index`) : path.join(localRoot(), '.index');
    const root = path.dirname(base);
    const collected: StorageObjectMetadata[] = [];
    const walk = async (directory: string): Promise<void> => {
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else if (entry.isFile()) {
          const metadata = await stat(absolute);
          collected.push({ key: path.relative(localRoot(), absolute).split(path.sep).join('/'), size: metadata.size, updatedAt: metadata.mtime });
        }
      }
    };
    await walk(root);
    const ordered = collected.sort((a, b) => a.key.localeCompare(b.key));
    const start = cursor ? Math.max(0, ordered.findIndex((item) => item.key === cursor) + 1) : 0;
    const items = ordered.slice(start, start + Math.max(1, Math.min(limit, 1000)));
    return { items, nextCursor: start + items.length < ordered.length ? items.at(-1)?.key : undefined };
  }
  async health() {
    try { await access(localRoot(), constants.R_OK | constants.W_OK); return 'ok' as const; }
    catch { return process.env.LOCAL_STORAGE_PATH ? 'error' as const : 'not_configured' as const; }
  }
}
