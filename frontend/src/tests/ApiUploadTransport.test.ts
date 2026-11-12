import { describe, expect, it, vi } from 'vitest';
import { apiRequest, apiUploadWithProgress, tokenStore } from '../services/api/client';
import { apiConfig } from '../services/api/config';

const MiB = 1024 * 1024;
const policy = { standard_file_max_bytes: 50 * MiB, fiscal_file_max_bytes: 50 * MiB,
  catalog_import_file_max_bytes: 50 * MiB, archive_file_max_bytes: 50 * MiB, batch_total_max_bytes: 200 * MiB };
const form = (size: number) => {
  const file = new File(['synthetic'], 'qa.pdf', { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  const body = new FormData(); body.set('archivo', file); return body;
};

describe('transporte multipart al backend existente', () => {
  it('usa Bearer sin trasladar cookies; JSON y renovación conservan la ruta original', async () => {
    const previous = apiConfig.uploadBaseUrl; apiConfig.uploadBaseUrl = 'https://api.example.test/api';
    tokenStore.set('synthetic-upload-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(policy), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    try {
      await apiRequest('/documentos', { method: 'POST', body: form(50 * MiB) });
      const upload = fetchMock.mock.calls.find(([url]) => String(url) === 'https://api.example.test/api/documentos');
      expect(upload).toBeDefined(); expect(upload![1]?.credentials).toBe('omit');
      expect(new Headers(upload![1]?.headers).get('Authorization')).toBe('Bearer synthetic-upload-token');
      expect(new Headers(upload![1]?.headers).has('Content-Type')).toBe(false);
      await apiRequest('/prospectos', { method: 'POST', body: '{}' });
      const ordinary = fetchMock.mock.calls.find(([url]) => String(url) === '/api/prospectos');
      expect(ordinary![1]?.credentials).toBe('include');
      const calls = fetchMock.mock.calls.length;
      await expect(apiRequest('/documentos', { method: 'POST', body: form(50 * MiB + 1) })).rejects.toMatchObject({ status: 413 });
      expect(fetchMock).toHaveBeenCalledTimes(calls);
    } finally { apiConfig.uploadBaseUrl = previous; tokenStore.clear(); fetchMock.mockRestore(); }
  });

  it('conserva progreso XHR y el mismo destino y autorización sin cookies', async () => {
    const previous = apiConfig.uploadBaseUrl; apiConfig.uploadBaseUrl = 'https://api.example.test/api'; tokenStore.set('synthetic-upload-token');
    const xhr = { open: vi.fn(), setRequestHeader: vi.fn(), withCredentials: true, upload: {} as any,
      status: 201, responseText: '{"saved":true}', onload: () => {}, onerror: () => {},
      send: vi.fn(function (this: any) { this.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 }); this.onload(); }) };
    vi.stubGlobal('XMLHttpRequest', vi.fn(function () { return xhr; }));
    const progress = vi.fn();
    try {
      await expect(apiUploadWithProgress('/documentos', form(50 * MiB), progress)).resolves.toEqual({ saved: true });
      expect(xhr.open).toHaveBeenCalledWith('POST', 'https://api.example.test/api/documentos');
      expect(xhr.withCredentials).toBe(false); expect(xhr.setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer synthetic-upload-token');
      expect(progress).toHaveBeenCalledWith(50, 100);
    } finally { apiConfig.uploadBaseUrl = previous; tokenStore.clear(); vi.unstubAllGlobals(); }
  });

  it('renueva por el proxy una autorización vencida y repite la carga directa una sola vez', async () => {
    const previous = apiConfig.uploadBaseUrl; apiConfig.uploadBaseUrl = 'https://api.example.test/api'; tokenStore.set('expired-qa');
    let uploads = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/upload-policy')) return new Response(JSON.stringify(policy), { headers: { 'Content-Type': 'application/json' } });
      if (String(url) === '/api/auth/refresh') return new Response('{"access_token":"renewed-qa"}', { headers: { 'Content-Type': 'application/json' } });
      uploads += 1;
      return new Response(uploads === 1 ? '{"error":"expired"}' : '{"saved":true}', { status: uploads === 1 ? 401 : 201, headers: { 'Content-Type': 'application/json' } });
    });
    try {
      await expect(apiRequest('/documentos', { method: 'POST', body: form(1000) })).resolves.toEqual({ saved: true });
      expect(uploads).toBe(2);
      const renewal = fetchMock.mock.calls.find(([url]) => String(url) === '/api/auth/refresh');
      expect(renewal![1]?.credentials).toBe('include');
      const last = fetchMock.mock.calls.at(-1)!;
      expect(last[0]).toBe('https://api.example.test/api/documentos'); expect(last[1]?.credentials).toBe('omit');
      expect(new Headers(last[1]?.headers).get('Authorization')).toBe('Bearer renewed-qa');
    } finally { apiConfig.uploadBaseUrl = previous; tokenStore.clear(); fetchMock.mockRestore(); }
  });
});
