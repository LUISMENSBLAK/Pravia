import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantChatError, createAssistantChatService } from './assistantChat.service';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ana@example.test',
  nombre: 'Ana',
  apellido: 'Prueba',
  rol: 'ABOGADO',
  sessionId: 'session-1',
  permissions: ['ai.use', 'ai.work.read', 'mi_dia.read', 'ai.expedientes.read', 'expedientes.read'],
  requiresPasswordChange: false,
} as any;

const providerResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('PRAVIA IA conversational service', () => {
  const previousKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key-never-sent';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });

  it('devuelve una respuesta simple real del proveedor', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(providerResponse({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Puedo ayudarte con tus pendientes.' }] }],
    }));
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any });

    await expect(send({ message: 'Hola', context: { module: 'mi-dia', route: '/mi-dia' } }, user, 'corr-1'))
      .resolves.toEqual({ status: 'success', message: 'Puedo ayudarte con tus pendientes.' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('consulta Mi Día con la identidad autenticada y devuelve datos reales con fuente', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(providerResponse({ status: 'completed', output: [{ type: 'function_call', name: 'getCurrentUserWork', arguments: '{"limit":10}', call_id: 'call-1' }] }))
      .mockResolvedValueOnce(providerResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Tienes una tarea pendiente hoy en EXP-2026-0042.' }] }] }));
    const executeTool = vi.fn().mockResolvedValue({
      data: { tareas: [{ titulo: 'Revisar escritura', fecha_limite: '2026-08-15', expediente: { numero_pravia: 'EXP-2026-0042' } }], proximos_eventos: [] },
      provenance: [{ entity: 'User', id: user.id, label: 'Trabajo del usuario autenticado', path: '/mi-dia' }],
      truncated: false,
    });
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any, executeTool: executeTool as any });

    const result = await send({ message: 'Muéstrame mis pendientes de hoy.', context: { module: 'mi-dia', route: '/mi-dia', label: 'Mi Día' } }, user, 'corr-2');

    expect(executeTool).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'getCurrentUserWork', user, context: expect.objectContaining({ module: 'mi-dia', route: '/mi-dia' }),
    }));
    expect(result).toMatchObject({
      status: 'success',
      message: expect.stringContaining('EXP-2026-0042'),
      sources: [{ type: 'User', label: 'Trabajo del usuario autenticado', reference: '/mi-dia' }],
    });
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    expect(secondBody.input).toContainEqual(expect.objectContaining({ type: 'function_call_output', call_id: 'call-1' }));
  });

  it('no expone herramientas que el usuario no puede usar ni herramientas de escritura', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(providerResponse({
      status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Listo.' }] }],
    }));
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any });
    await send({ message: 'Dame un resumen' }, user, 'corr-3');
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.tools.map((tool: any) => tool.name)).toContain('getCurrentUserWork');
    expect(body.tools.map((tool: any) => tool.name)).not.toContain('getFinancialSummary');
    expect(body.tools.map((tool: any) => tool.name)).not.toContain('prepareTask');
  });

  it('controla un rechazo del proveedor sin filtrar su cuerpo técnico', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('invalid_api_key: secret detail', { status: 401 }));
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any });

    await expect(send({ message: 'Consulta mis pendientes' }, user, 'corr-4'))
      .rejects.toMatchObject<Partial<AssistantChatError>>({ code: 'AI_PROVIDER_AUTH_FAILED', status: 502 });
  });
});
