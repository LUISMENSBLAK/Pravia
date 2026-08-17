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
      history: [{ role: 'assistant', content: '¿En qué puedo ayudarte?' }],
    })).resolves.toMatchObject({ status: 'success', message: 'Tienes un pendiente real.' });

    expect(fetchMock).toHaveBeenCalledWith('/api/ia/assistant/messages', expect.objectContaining({ method: 'POST' }));
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer access-token-for-test');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      history: [{ role: 'assistant', content: '¿En qué puedo ayudarte?' }],
    });
  });

  it('consulta el historial persistente y conserva el estado solicitado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{
      id: 'conversation-1', title: 'Consulta', status: 'TRASHED', last_message_at: '2026-08-17T10:00:00Z',
      message_count: 2, created_at: '2026-08-17T10:00:00Z', updated_at: '2026-08-17T10:00:00Z',
    }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(assistantService.listConversations('TRASHED')).resolves.toEqual([expect.objectContaining({ id: 'conversation-1', status: 'TRASHED' })]);
    expect(fetchMock).toHaveBeenCalledWith('/api/ia/assistant/conversations?status=TRASHED', expect.any(Object));
  });

  it('sube adjuntos temporales como multipart sin forzar Content-Type JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      id: 'attachment-1', source: 'TEMPORARY_UPLOAD', original_name: 'archivo.pdf', mime_type: 'application/pdf', size_bytes: 7,
      status: 'AVAILABLE', created_at: '2026-08-17T10:00:00Z',
    } }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await assistantService.uploadAttachment('conversation-1', new File(['archivo'], 'archivo.pdf', { type: 'application/pdf' }));
    const options = fetchMock.mock.calls[0][1];
    expect(options.body).toBeInstanceOf(FormData);
    expect((options.headers as Headers).has('Content-Type')).toBe(false);
  });
});
