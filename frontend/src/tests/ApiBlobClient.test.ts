import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBlobRequest, tokenStore } from '../services/api/client';

describe('apiBlobRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    tokenStore.clear();
  });

  it('renueva una sesión vencida y repite la descarga una sola vez', async () => {
    tokenStore.set('expired-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'fresh-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(new Blob(['zip-content'], { type: 'application/zip' }), {
        status: 200,
        headers: { 'Content-Type': 'application/zip' },
      }));

    const blob = await apiBlobRequest('/expedientes/exp-1/documentos/apendice/descargar-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(blob.type).toBe('application/zip');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer expired-token');
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get('Authorization')).toBe('Bearer fresh-token');
  });
});
