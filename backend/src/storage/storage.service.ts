import { resolveRuntimeConfig } from '../config/runtime';
import { CloudStorageProvider } from './cloudStorage.provider';
import { LocalStorageProvider } from './localStorage.provider';
import type { StorageProvider } from './storage.types';

let provider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!provider) {
    const config = resolveRuntimeConfig();
    provider = config.storage.primary === 'local' ? new LocalStorageProvider() : new CloudStorageProvider();
  }
  return provider;
}

export const getStorageInfo = () => {
  const config = resolveRuntimeConfig();
  return { mode: config.storage.mode, primary: config.storage.primary, provider: getStorageProvider().id, replication_enabled: false };
};

export const uploadFile = (buffer: Buffer, key: string, mimeType: string) => getStorageProvider().upload(buffer, key, mimeType);
export const downloadFile = (key: string) => getStorageProvider().download(key);
export const deleteFile = (key: string) => getStorageProvider().delete(key);
export const getSignedUrl = (key: string, expiresInSeconds = 600) => getStorageProvider().signedUrl(key, Math.max(60, Math.min(3600, Math.floor(expiresInSeconds))));
export const checkStorageHealth = () => getStorageProvider().health();
