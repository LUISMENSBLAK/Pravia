import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from '../services/api/client';

const MiB = 1024 * 1024;
const policy = {
  standard_file_max_bytes: 50 * MiB,
  fiscal_file_max_bytes: 50 * MiB,
  catalog_import_file_max_bytes: 50 * MiB,
  archive_file_max_bytes: 50 * MiB,
  batch_total_max_bytes: 200 * MiB,
};

function formWithSizedFile(field: string, bytes: number) {
  const file = new File(['qa'], 'synthetic.pdf', { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: bytes });
  const body = new FormData();
  body.set(field, file);
  return body;
}

describe('preflight documental con política canónica', () => {
  it('rechaza antes del POST los excesos en archivos, ZIP/RAR y lotes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/upload-policy')) return new Response(JSON.stringify(policy), { status: 200, headers: { 'Content-Type': 'application/json' } });
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });
    const path = '/expedientes/exp-1/documentos/carga-lote';

    await expect(apiRequest(path, { method: 'POST', body: formWithSizedFile('files', 51 * MiB) }))
      .rejects.toMatchObject({ status: 413, payload: { max_file_size_bytes: 50 * MiB } } satisfies Partial<ApiError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(apiRequest(path, { method: 'POST', body: formWithSizedFile('archive', 60 * MiB) }))
      .rejects.toMatchObject({ status: 413, payload: { max_file_size_bytes: 50 * MiB } } satisfies Partial<ApiError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(apiRequest('/finanzas/facturacion/manual', { method: 'POST', body: formWithSizedFile('file', 51 * MiB) }))
      .rejects.toMatchObject({ status: 413, payload: { max_file_size_bytes: 50 * MiB } } satisfies Partial<ApiError>);
    await expect(apiRequest('/settings/catalogs/artifacts/import/preview', { method: 'POST', body: formWithSizedFile('file', 51 * MiB) }))
      .rejects.toMatchObject({ status: 413, payload: { max_file_size_bytes: 50 * MiB } } satisfies Partial<ApiError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const batch = new FormData();
    for (let index = 0; index < 5; index += 1) batch.append('files', formWithSizedFile('file', 45 * MiB).get('file') as File);
    await expect(apiRequest(path, { method: 'POST', body: batch }))
      .rejects.toMatchObject({ status: 413, payload: { code: 'UPLOAD_BATCH_TOO_LARGE', max_batch_size_bytes: 200 * MiB } } satisfies Partial<ApiError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it('distingue un corte de red de un error de almacenamiento y permite reintentar', async () => {
    let attempts = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/upload-policy')) return new Response(JSON.stringify(policy), { status: 200, headers: { 'Content-Type': 'application/json' } });
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ saved: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });
    const path = '/expedientes/exp-1/documentos/carga-lote';
    await expect(apiRequest(path, { method: 'POST', body: formWithSizedFile('files', 100 * 1024) }))
      .rejects.toMatchObject({ status: 0, payload: { code: 'NETWORK_ERROR' } } satisfies Partial<ApiError>);
    await expect(apiRequest(path, { method: 'POST', body: formWithSizedFile('files', 100 * 1024) }))
      .resolves.toEqual({ saved: true });
    expect(attempts).toBe(2);
    fetchMock.mockRestore();
  });
});
