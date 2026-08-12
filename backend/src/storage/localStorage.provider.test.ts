import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageProvider, resolveLocalStoragePath, verifyLocalStorageSignature } from './localStorage.provider';

describe('Storage local seguro', () => {
  const previousPath = process.env.LOCAL_STORAGE_PATH;
  const previousSecret = process.env.LOCAL_STORAGE_SIGNING_SECRET;
  beforeEach(() => {
    process.env.LOCAL_STORAGE_PATH = '/private/tmp/pravia-storage-test';
    process.env.LOCAL_STORAGE_SIGNING_SECRET = 'pravia-local-test-signing-secret-2026!';
  });
  afterEach(() => {
    if (previousPath === undefined) delete process.env.LOCAL_STORAGE_PATH; else process.env.LOCAL_STORAGE_PATH = previousPath;
    if (previousSecret === undefined) delete process.env.LOCAL_STORAGE_SIGNING_SECRET; else process.env.LOCAL_STORAGE_SIGNING_SECRET = previousSecret;
  });

  it('resuelve una storage_key dentro del directorio permitido', () => {
    expect(resolveLocalStoragePath('expedientes/abc/documento.pdf')).toBe('/private/tmp/pravia-storage-test/expedientes/abc/documento.pdf');
  });

  it('rechaza traversal, rutas absolutas y raíz amplia', () => {
    expect(() => resolveLocalStoragePath('../secreto')).toThrow();
    expect(() => resolveLocalStoragePath('/etc/passwd')).toThrow();
    process.env.LOCAL_STORAGE_PATH = '/';
    expect(() => resolveLocalStoragePath('archivo.pdf')).toThrow();
  });

  it('produce enlaces firmados cortos y rechaza una firma alterada', async () => {
    const url = new URL(`http://local${await new LocalStorageProvider().signedUrl('documentos/uno.pdf', 300)}`);
    const key = url.searchParams.get('key')!;
    const expires = Number(url.searchParams.get('expires'));
    const signature = url.searchParams.get('signature')!;
    expect(verifyLocalStorageSignature(key, expires, signature)).toBe(true);
    const altered = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
    expect(verifyLocalStorageSignature(key, expires, altered)).toBe(false);
  });
});
