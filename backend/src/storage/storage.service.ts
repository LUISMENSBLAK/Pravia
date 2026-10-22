import { resolveRuntimeConfig } from '../config/runtime';
import { CloudStorageProvider } from './cloudStorage.provider';
import { LocalStorageProvider } from './localStorage.provider';
import type { StorageProvider } from './storage.types';
import { TrackedStorageService } from '../platform/trackedStorage.service';

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

const tracked = () => new TrackedStorageService(getStorageProvider());

export const uploadFile = (buffer: Buffer, key: string, mimeType: string) => tracked().upload(buffer, key, mimeType);
export const downloadFile = (key: string) => getStorageProvider().download(key);
export const deleteFile = (key: string) => tracked().delete(key);
export const linkStorageReference = (input: { key: string; ownerType: string; ownerId: string; documentVersionId?: string }) => tracked().linkReference(input);
export const getSignedUrl = (key: string, expiresInSeconds = 600) => getStorageProvider().signedUrl(key, Math.max(60, Math.min(3600, Math.floor(expiresInSeconds))));
export const fileExists = (key: string) => getStorageProvider().exists(key);
export const headFile = (key: string) => getStorageProvider().head(key);
export const copyFile = (sourceKey: string, destinationKey: string) => getStorageProvider().copy(sourceKey, destinationKey);
export const listFiles = (prefix: string, cursor?: string, limit?: number) => getStorageProvider().list(prefix, cursor, limit);
export const checkStorageHealth = () => getStorageProvider().health();
