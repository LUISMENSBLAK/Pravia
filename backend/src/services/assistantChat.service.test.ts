import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantChatError, createAssistantChatService } from './assistantChat.service';

const basePermissions = ['ai.use', 'ai.work.read', 'mi_dia.read', 'ai.expedientes.read', 'expedientes.read'];
const user = {
  id: '11111111-1111-4111-8111-111111111111', email: 'ana@example.test', nombre: 'Ana', apellido: 'Prueba',
  rol: 'ABOGADO', sessionId: 'session-1', permissions: basePermissions, requiresPasswordChange: false,
} as any;
const executiveUser = {
  ...user,
  rol: 'DIRECCION',
  permissions: [
    ...basePermissions,
    'ai.prospectos.read', 'prospectos.read',
    'ai.agenda.read', 'agenda.read',
    'ai.finanzas.read', 'finanzas.read',
    'ai.reportes.read', 'reportes.read',
  ],
} as any;

const providerResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const textResponse = (text: string) => providerResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const planResponse = (
  toolCalls: Array<{ tool: string; arguments?: Record<string, unknown> }>,
  options: { intents?: string[]; exclusions?: string[]; excludedTools?: string[]; mode?: 'DIRECT' | 'EXECUTIVE'; requiresData?: boolean } = {},
) => providerResponse({
  status: 'completed',
  output: [{
    type: 'function_call', name: 'plan_pravia_query', call_id: 'plan-call',
    arguments: JSON.stringify({
      requires_data: options.requiresData ?? toolCalls.length > 0,
      intents: options.intents ?? ['consulta'],
      exclusions: options.exclusions ?? [],
      excluded_tools: options.excludedTools ?? [],
      tool_calls: toolCalls.map((call) => ({ tool: call.tool, arguments: call.arguments ?? {} })),
      response_mode: options.mode ?? 'DIRECT',
    }),
  }],
});
const toolResult = (tool: string, data: unknown = []) => ({
  data,
  provenance: [{ entity: tool, id: `${tool}-source`, label: `Fuente ${tool}`, path: '/mi-dia' }],
  truncated: false,
});
const requestBodies = (fetchImpl: ReturnType<typeof vi.fn>) => fetchImpl.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));

describe('PRAVIA IA multi-intent planner', () => {
  const previousKey = process.env.OPENAI_API_KEY;

  beforeEach(() => { process.env.OPENAI_API_KEY = 'test-key-never-sent'; });
  afterEach(() => {
    vi.restoreAllMocks();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });

  it('TEST 1 conserva la consulta simple de pendientes de hoy', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(planResponse([{ tool: 'getCurrentUserWork', arguments: { period: 'TODAY', limit: 10 } }], { intents: ['pending_items'] }))
      .mockResolvedValueOnce(textResponse('Tienes una tarea pendiente hoy.'));
    const executeTool = vi.fn().mockResolvedValue(toolResult('getCurrentUserWork', { tareas_del_periodo: [{ titulo: 'Revisar escritura' }] }));
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any, executeTool: executeTool as any });

    await expect(send({ message: 'Muéstrame mis pendientes de hoy.', timezone: 'America/Mexico_City' }, user, 'corr-1'))
      .resolves.toMatchObject({ status: 'success', message: 'Tienes una tarea pendiente hoy.' });
    expect(executeTool).toHaveBeenCalledWith(expect.objectContaining({ tool: 'getCurrentUserWork', args: { period: 'TODAY', limit: 10 }, user }));
    expect(requestBodies(fetchImpl)[0]).toMatchObject({ tool_choice: { type: 'function', name: 'plan_pravia_query' }, parallel_tool_calls: false });
  });

  it('TEST 2 conserva la consulta de expedientes que requieren atención', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(planResponse([{ tool: 'getExpedientesRequiringAttention', arguments: { limit: 10 } }], { intents: ['attention_required'] }))
      .mockResolvedValueOnce(textResponse('EXP-2026-0099 requiere atención por una tarea vencida.'));
    const executeTool = vi.fn().mockResolvedValue(toolResult('getExpedientesRequiringAttention', [{ folio: 'EXP-2026-0099', reasons: [{ type: 'TAREA_VENCIDA' }] }]));
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any, executeTool: executeTool as any });

    const result = await send({ message: '¿Qué expedientes requieren mi atención?', context: { module: 'mi-dia' } }, user, 'corr-2');
    expect(executeTool).toHaveBeenCalledWith(expect.objectContaining({ tool: 'getExpedientesRequiringAttention' }));
    expect(result).toMatchObject({ message: expect.stringContaining('EXP-2026-0099'), sources: [expect.objectContaining({ label: 'Fuente getExpedientesRequiringAttention' })] });
  });

  it('TEST 3 combina varias fuentes para “¿Cómo va todo esta semana?”', async () => {
    const calls = [
      { tool: 'getCurrentUserWork', arguments: { period: 'THIS_WEEK' } },
      { tool: 'getExpedientesRequiringAttention', arguments: { limit: 10 } },
      { tool: 'getUpcomingEvents', arguments: { period: 'THIS_WEEK' } },
      { tool: 'getProspectFollowUps', arguments: { period: 'THIS_WEEK' } },
      { tool: 'getReportingSummary', arguments: { periodo: 'PERSONALIZADO', fecha_desde: '2026-08-10', fecha_hasta: '2026-08-16' } },
    ];
    const fetchImpl = vi.fn().mockResolvedValueOnce(planResponse(calls, { intents: ['weekly_status', 'pending_items', 'attention_required', 'financial_summary'], mode: 'EXECUTIVE' })).mockResolvedValueOnce(textResponse('# Resumen de la semana\n\nEstado general basado en cuatro fuentes.'));
    const executeTool = vi.fn(async ({ tool }: any) => toolResult(tool, { tool, records: [] }));
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any, executeTool: executeTool as any });

    const result = await send({ message: '¿Cómo va todo esta semana?', timezone: 'America/Mexico_City' }, executiveUser, 'corr-3');
    expect(executeTool).toHaveBeenCalledTimes(5);
    expect(result.sources).toHaveLength(5);
    expect(requestBodies(fetchImpl)[1].input.at(-1).output).toContain('getReportingSummary');
  });

  it('TEST 4 resuelve pendientes, incompletos y finanzas en un turno', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(planResponse([
        { tool: 'getCurrentUserWork', arguments: { period: 'NEXT_7_DAYS' } },
        { tool: 'getExpedientesRequiringAttention', arguments: { limit: 15 } },
        { tool: 'getReportingSummary', arguments: { periodo: 'ESTE_MES' } },
      ], { intents: ['pending_items', 'incomplete_items', 'financial_summary'], mode: 'EXECUTIVE' }))
      .mockResolvedValueOnce(textResponse('Resumen completo con tres categorías.'));
    const executeTool = vi.fn(async ({ tool }: any) => toolResult(tool));
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any, executeTool: executeTool as any });

    await send({ message: 'Dime qué está pendiente, qué está incompleto y dame un resumen financiero.' }, executiveUser, 'corr-4');
    expect(executeTool.mock.calls.map((call) => call[0].tool)).toEqual(expect.arrayContaining(['getCurrentUserWork', 'getExpedientesRequiringAttention', 'getReportingSummary']));
  });

  it('TEST 5 respeta exclusiones y no ejecuta finanzas', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(planResponse([
        { tool: 'getExpedientesRequiringAttention' },
        { tool: 'getReportingSummary', arguments: { periodo: 'ESTE_MES' } },
      ], { intents: ['missing_items'], exclusions: ['finanzas'], excludedTools: ['getReportingSummary'], mode: 'EXECUTIVE' }))
      .mockResolvedValueOnce(textResponse('Solo pendientes operativos.'));
    const executeTool = vi.fn(async ({ tool }: any) => toolResult(tool));
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any, executeTool: executeTool as any });

    await send({ message: 'Dime qué falta pero no me enseñes finanzas.' }, executiveUser, 'corr-5');
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith(expect.objectContaining({ tool: 'getExpedientesRequiringAttention' }));
    expect(requestBodies(fetchImpl)[1].input.at(-1).output).not.toContain('getReportingSummary');
  });

  it('TEST 6 conserva las otras fuentes cuando una no tiene datos', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(planResponse([{ tool: 'getCurrentUserWork' }, { tool: 'getUpcomingEvents' }], { mode: 'EXECUTIVE' }))
      .mockResolvedValueOnce(textResponse('No hay eventos; sí hay una tarea pendiente.'));
    const executeTool = vi.fn(async ({ tool }: any) => toolResult(tool, tool === 'getUpcomingEvents' ? [] : [{ titulo: 'Pendiente real' }]));
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any, executeTool: executeTool as any });
    await expect(send({ message: 'Dame pendientes y agenda.' }, executiveUser, 'corr-6')).resolves.toMatchObject({ message: expect.stringContaining('una tarea') });
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  it('TEST 7 degrada solo la sección cuya tool falla', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(planResponse([{ tool: 'getCurrentUserWork' }, { tool: 'getExpedientesRequiringAttention' }], { mode: 'EXECUTIVE' }))
      .mockResolvedValueOnce(textResponse('Pude consultar tareas; expedientes no estuvo disponible.'));
    const executeTool = vi.fn(async ({ tool }: any) => {
      if (tool === 'getExpedientesRequiringAttention') throw new Error('database detail');
      return toolResult(tool, [{ titulo: 'Tarea real' }]);
    });
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any, executeTool: executeTool as any });
    await expect(send({ message: 'Dame un resumen general.' }, user, 'corr-7')).resolves.toMatchObject({ status: 'success' });
    const synthesis = requestBodies(fetchImpl)[1].input.at(-1).output;
    expect(synthesis).toContain('"success":false');
    expect(synthesis).not.toContain('database detail');
  });

  it('TEST 8 no expone ni ejecuta finanzas sin permisos', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(planResponse([{ tool: 'getCurrentUserWork' }, { tool: 'getReportingSummary' }], { mode: 'EXECUTIVE' }))
      .mockResolvedValueOnce(textResponse('Resumen operativo sin finanzas.'));
    const executeTool = vi.fn(async ({ tool }: any) => toolResult(tool));
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any, executeTool: executeTool as any });

    await send({ message: 'Dame un resumen global.' }, user, 'corr-8');
    const plannerSchema = requestBodies(fetchImpl)[0].tools[0].parameters.properties.tool_calls.items.properties.tool.enum;
    expect(plannerSchema).not.toContain('getReportingSummary');
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).not.toHaveBeenCalledWith(expect.objectContaining({ tool: 'getReportingSummary' }));
  });

  it('TEST 11 incorpora historial limitado para follow-ups contextuales', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(planResponse([{ tool: 'getExpedientesRequiringAttention' }], { intents: ['urgent_follow_up'] })).mockResolvedValueOnce(textResponse('Estos son los urgentes.'));
    const executeTool = vi.fn().mockResolvedValue(toolResult('getExpedientesRequiringAttention'));
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any, executeTool: executeTool as any });
    await send({
      message: 'Solo enséñame los urgentes.',
      history: [{ role: 'user', content: '¿Qué expedientes requieren atención?' }, { role: 'assistant', content: 'EXP-1 y EXP-2 requieren atención.' }],
    }, user, 'corr-11');
    expect(requestBodies(fetchImpl)[0].input.slice(0, 2)).toEqual([
      expect.objectContaining({ role: 'user' }), expect.objectContaining({ role: 'assistant' }),
    ]);
  });

  it('TEST 12 exige evidencia objetiva antes de llamar algo incompleto', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(planResponse([{ tool: 'getExpedientesRequiringAttention' }], { intents: ['incomplete_items'], mode: 'EXECUTIVE' })).mockResolvedValueOnce(textResponse('No hay expedientes incompletos con evidencia registrada.'));
    const executeTool = vi.fn().mockResolvedValue(toolResult('getExpedientesRequiringAttention', []));
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any, executeTool: executeTool as any });
    const result = await send({ message: '¿Qué está incompleto?' }, user, 'corr-12');
    expect(result.message).toContain('No hay');
    expect(requestBodies(fetchImpl)[1].instructions).toContain('Solo llama incompleto a algo con evidencia objetiva');
  });

  it('limita y deduplica el plan a seis consultas', async () => {
    const planned = Array.from({ length: 8 }, (_value, index) => ({ tool: index % 2 ? 'getCurrentUserWork' : 'getExpedientesRequiringAttention', arguments: { limit: index + 1 } }));
    const fetchImpl = vi.fn().mockResolvedValueOnce(planResponse(planned, { mode: 'EXECUTIVE' })).mockResolvedValueOnce(textResponse('Resumen limitado.'));
    const executeTool = vi.fn(async ({ tool }: any) => toolResult(tool));
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any, executeTool: executeTool as any });
    await send({ message: 'Resumen completo.' }, user, 'corr-limit');
    expect(executeTool).toHaveBeenCalledTimes(6);
  });

  it('controla un rechazo del proveedor sin filtrar su cuerpo técnico', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('invalid_api_key: secret detail', { status: 401 }));
    const send = createAssistantChatService({ fetchImpl: fetchImpl as any });
    await expect(send({ message: 'Consulta mis pendientes' }, user, 'corr-auth'))
      .rejects.toMatchObject<Partial<AssistantChatError>>({ code: 'AI_PROVIDER_AUTH_FAILED', status: 502 });
  });
});
