import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../services/api/client', () => ({
  apiRequest: vi.fn(),
  tokenStore: { get: () => 'qa-token' },
}));

vi.mock('../services/api/config', () => ({
  apiUrl: (path: string) => `https://api.staging.example/api${path}`,
}));

import { complianceService } from '../features/compliance/compliance.service';

afterEach(() => vi.unstubAllGlobals());

it('descarga evidencia del backend configurado con autorización, no del redirect productivo', async () => {
  const content = new Blob(['evidencia QA'], { type: 'application/pdf' });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => content });
  vi.stubGlobal('fetch', fetchMock);

  expect(await complianceService.evidenceBlob('revision/qa', 'archivo qa')).toBe(content);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.staging.example/api/cumplimiento/revisiones/revision%2Fqa/evidencias/archivo%20qa/archivo',
    { credentials: 'include', headers: { Authorization: 'Bearer qa-token' } },
  );
});
