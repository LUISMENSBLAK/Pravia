import { afterEach, describe, expect, it, vi } from 'vitest';
import { assistantService } from '../features/assistant/assistant.service';
import { tokenStore } from '../services/api/client';

describe('assistant service adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    tokenStore.clear();
  });

  it('envía la consulta real al endpoint estable con Authorization y contexto', async () => {
    tokenStore.set('access-token-for-test');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'success', message: 'Tienes un pendiente real.', sources: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(assistantService.sendMessage({
      message: 'Muéstrame mis pendientes de hoy.',
      context: { route: '/mi-dia', module: 'mi-dia', label: 'Mi Día' },
    })).resolves.toMatchObject({ status: 'success', message: 'Tienes un pendiente real.' });

    expect(fetchMock).toHaveBeenCalledWith('/api/ia/assistant/messages', expect.objectContaining({ method: 'POST' }));
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer access-token-for-test');
  });
});
