import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiConfig, apiOperationUrl } from '../services/api/config';
import { apiRequest, tokenStore } from '../services/api/client';
const previous = apiConfig.uploadBaseUrl;
afterEach(() => { apiConfig.uploadBaseUrl = previous; tokenStore.clear(); vi.restoreAllMocks(); });
describe('Operaciones largas reutilizan Render y no el proxy de 26 segundos', () => {
  it.each(['/comparecientes/altas/source/extraer', '/comparecientes/party/extraer-ia', '/predios/property/extracciones/preview',
    '/ia/assistant/messages', '/isr/case/extract', '/isr/case/interpret-operation', '/expedientes/case/proyecto/generar',
    '/expedientes/case/proyecto/aplicar-indicaciones', '/expedientes/case/proyecto/analizar-ia',
    '/expedientes/case/finanzas/ia/proponer', '/cotizaciones/quote/propuestas-ia',
    '/finanzas/facturacion/entidades/csf/source/extraer'])('%s selecciona el backend existente', path => {
    apiConfig.uploadBaseUrl = 'https://backend.example.test/api';
    expect(apiOperationUrl(path, 'POST')).toBe('https://backend.example.test/api' + path);
    expect(apiOperationUrl(path, 'GET')).toBe('/api' + path);
  });
  it('no cambia sesión ni escrituras normales; sin destino directo conserva el proxy local', () => {
    apiConfig.uploadBaseUrl = 'https://backend.example.test/api';
    for (const path of ['/auth/login', '/auth/refresh', '/auth/logout', '/prospectos', '/comparecientes/persona-fisica', '/finanzas/movimientos']) expect(apiOperationUrl(path, 'POST')).toBe('/api' + path);
    apiConfig.uploadBaseUrl = ''; expect(apiOperationUrl('/ia/assistant/messages', 'POST')).toBe('/api/ia/assistant/messages');
  });
  it('renueva por same-origin y reintenta sólo una vez con Bearer sin enviar cookies a Render', async () => {
    apiConfig.uploadBaseUrl = 'https://backend.example.test/api'; tokenStore.set('expired-synthetic');
    let executions = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      if (url === '/api/auth/refresh') return new Response('{"access_token":"renewed-synthetic"}', { headers: { 'Content-Type': 'application/json' } });
      executions++; return new Response(executions === 1 ? '{"error":"expired"}' : '{"ok":true}', { status: executions === 1 ? 401 : 200, headers: { 'Content-Type': 'application/json' } });
    });
    await expect(apiRequest('/ia/assistant/messages', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true });
    expect(executions).toBe(2);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh'); expect(fetchMock.mock.calls[1][1]?.credentials).toBe('include');
    const last = fetchMock.mock.calls.at(-1)!; expect(last[0]).toBe('https://backend.example.test/api/ia/assistant/messages');
    expect(last[1]?.credentials).toBe('omit'); expect(new Headers(last[1]?.headers).get('Authorization')).toBe('Bearer renewed-synthetic');
  });
});
