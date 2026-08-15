import type { Request } from 'express';
import { getOpenAIModelName } from './openaiDocument.service';
import {
  AssistantToolError,
  assistantToolCatalog,
  executeAssistantTool,
  type AssistantContextInput,
  type AssistantToolName,
} from './assistantTools.service';

type AuthUser = NonNullable<Request['user']>;

export type AssistantMessageContext = {
  route?: string;
  module?: string;
  label?: string;
  entityType?: string;
  entityId?: string;
  subview?: string;
};

export type AssistantMessageInput = {
  message: string;
  context?: AssistantMessageContext;
  suggestionId?: string;
};

export type AssistantSource = {
  id: string;
  type?: string;
  label: string;
  reference?: string;
};

export type AssistantMessageReply = {
  status: 'success';
  message: string;
  sources?: AssistantSource[];
};

export class AssistantChatError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'AssistantChatError';
  }
}

type ProviderResponse = {
  id?: string;
  status?: string;
  incomplete_details?: { reason?: string };
  output?: Array<Record<string, any>>;
};

type ChatDependencies = {
  fetchImpl?: typeof fetch;
  executeTool?: typeof executeAssistantTool;
};

const READ_TOOL_NAMES = new Set<AssistantToolName>([
  'searchExpedientes',
  'getExpedienteSummary',
  'getExpedientePendingItems',
  'searchComparecientes',
  'getComparecienteSummary',
  'getExpedienteDocuments',
  'getAgenda',
  'getUpcomingEvents',
  'getFinancialSummary',
  'getOutstandingBalances',
  'getReportingSummary',
  'getComplianceSummary',
  'getCurrentUserWork',
  'globalSearch',
]);

const TOOL_DESCRIPTIONS: Record<string, string> = {
  searchExpedientes: 'Busca expedientes reales dentro del alcance del usuario. Sin query devuelve los expedientes accesibles actualizados recientemente.',
  getExpedienteSummary: 'Obtiene el resumen real de un expediente autorizado. Usa el expediente del contexto cuando exista.',
  getExpedientePendingItems: 'Obtiene requisitos documentales, tareas y gestiones pendientes de un expediente autorizado.',
  searchComparecientes: 'Busca comparecientes reales dentro del alcance del usuario por nombre, RFC o CURP.',
  getComparecienteSummary: 'Obtiene el resumen real de un compareciente autorizado.',
  getExpedienteDocuments: 'Obtiene los documentos reales y vigencias de un expediente autorizado.',
  getAgenda: 'Consulta eventos reales de agenda en un rango de fechas dentro del alcance del usuario.',
  getUpcomingEvents: 'Consulta los próximos eventos reales del usuario o del equipo, según su rol.',
  getFinancialSummary: 'Obtiene el resumen financiero real de un expediente autorizado.',
  getOutstandingBalances: 'Obtiene saldos reales por cobrar dentro del alcance autorizado.',
  getReportingSummary: 'Obtiene indicadores canónicos reales de Reportes para el periodo solicitado.',
  getComplianceSummary: 'Obtiene revisiones y evidencia de cumplimiento persistidas para un expediente autorizado.',
  getCurrentUserWork: 'Obtiene las tareas pendientes del usuario autenticado y sus próximos eventos. Úsala para Mi Día, pendientes de hoy y expedientes que requieren atención.',
  globalSearch: 'Busca una referencia textual en expedientes, comparecientes y notarías respetando permisos.',
};

const TOOL_PROPERTIES: Record<string, Record<string, unknown>> = {
  searchExpedientes: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 25 } },
  getExpedienteSummary: { expediente_id: { type: 'string' } },
  getExpedientePendingItems: { expediente_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 25 } },
  searchComparecientes: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 25 } },
  getComparecienteSummary: { compareciente_id: { type: 'string' } },
  getExpedienteDocuments: { expediente_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 25 } },
  getAgenda: { from: { type: 'string', description: 'Fecha ISO inicial.' }, to: { type: 'string', description: 'Fecha ISO final.' }, expediente_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 25 } },
  getUpcomingEvents: { from: { type: 'string', description: 'Fecha ISO inicial.' }, to: { type: 'string', description: 'Fecha ISO final.' }, expediente_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 25 } },
  getFinancialSummary: { expediente_id: { type: 'string' } },
  getOutstandingBalances: { limit: { type: 'integer', minimum: 1, maximum: 25 } },
  getReportingSummary: { periodo: { type: 'string' }, fecha_desde: { type: 'string' }, fecha_hasta: { type: 'string' }, abogado_id: { type: 'string' }, notaria_id: { type: 'string' } },
  getComplianceSummary: { expediente_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 25 } },
  getCurrentUserWork: { limit: { type: 'integer', minimum: 1, maximum: 25 } },
  globalSearch: { query: { type: 'string', minLength: 2 }, limit: { type: 'integer', minimum: 1, maximum: 25 } },
};

function providerModel() {
  const configured = String(process.env.OPENAI_ASSISTANT_MODEL || '').trim();
  return /^gpt-5\.4-(?:nano|mini)(?:-|$)/.test(configured) ? configured : getOpenAIModelName();
}

function reasoningEffort(): 'none' | 'low' | 'medium' | 'high' | 'xhigh' {
  const value = String(process.env.OPENAI_REASONING_EFFORT || 'high').trim().toLowerCase();
  return ['none', 'low', 'medium', 'high', 'xhigh'].includes(value)
    ? value as 'none' | 'low' | 'medium' | 'high' | 'xhigh'
    : 'high';
}

function normalizeContext(context?: AssistantMessageContext): AssistantContextInput | undefined {
  if (!context) return undefined;
  const supported = ['expediente', 'compareciente', 'cotizacion', 'notaria', 'complianceReview'];
  const entityType = supported.includes(String(context.entityType))
    ? context.entityType as AssistantContextInput['entity_type']
    : undefined;
  return {
    route: String(context.route || '').slice(0, 180) || undefined,
    module: String(context.module || '').slice(0, 60) || undefined,
    entity_type: entityType,
    entity_id: entityType ? String(context.entityId || '').slice(0, 80) || undefined : undefined,
  };
}

function buildTools(user: AuthUser) {
  return assistantToolCatalog(user)
    .filter((item) => item.mode === 'READ' && READ_TOOL_NAMES.has(item.name as AssistantToolName))
    .map((item) => ({
      type: 'function',
      name: item.name,
      description: TOOL_DESCRIPTIONS[item.name] || 'Consulta datos reales de PRAVIA dentro del alcance autorizado.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: TOOL_PROPERTIES[item.name] || {},
      },
    }));
}

function systemInstructions(user: AuthUser, input: AssistantMessageInput) {
  const now = new Date().toISOString();
  const context = input.context || {};
  return [
    'Eres PRAVIA IA, asistente operativo de una plataforma notarial mexicana.',
    'Responde siempre en español claro, breve y profesional.',
    'Para cualquier pregunta sobre datos, pendientes, agenda, expedientes, personas, finanzas, reportes o cumplimiento de PRAVIA, debes consultar una herramienta antes de responder.',
    'No inventes registros, cifras, estados, fechas ni fuentes. Si una herramienta no devuelve datos, dilo explícitamente.',
    'Las herramientas ya aplican RBAC y alcance por objeto. Nunca intentes ampliar ese alcance ni trates el contexto visual como autorización.',
    'No incluyas UUID, correlation IDs, nombres internos de permisos, trazas ni detalles técnicos en la respuesta al usuario.',
    'No puedes ejecutar acciones de escritura. Si te piden crear, modificar, enviar, confirmar o eliminar algo, explica que requiere el flujo explícito de confirmación de PRAVIA.',
    `Fecha y hora del servidor: ${now}.`,
    `Usuario autenticado: ${user.nombre} ${user.apellido}; función: ${user.rol}.`,
    `Contexto visual: módulo=${String(context.module || 'desconocido').slice(0, 60)}, ruta=${String(context.route || '/').slice(0, 180)}, etiqueta=${String(context.label || '').slice(0, 80)}.`,
  ].join('\n');
}

function extractText(response: ProviderResponse) {
  const content = (response.output || []).flatMap((item) => Array.isArray(item.content) ? item.content : []);
  const refusal = content.find((item: any) => item.type === 'refusal')?.refusal;
  if (refusal) throw new AssistantChatError('El proveedor de IA no pudo responder esta consulta.', 'AI_PROVIDER_REFUSAL', 422);
  return content
    .filter((item: any) => item.type === 'output_text')
    .map((item: any) => String(item.text || ''))
    .join('')
    .trim();
}

function safeProviderCode(status: number) {
  if (status === 401 || status === 403) return 'AI_PROVIDER_AUTH_FAILED';
  if (status === 429) return 'AI_PROVIDER_RATE_LIMITED';
  return 'AI_PROVIDER_REQUEST_FAILED';
}

function sourceFromProvenance(item: any): AssistantSource | null {
  const id = String(item?.id || '').slice(0, 100);
  const label = String(item?.label || '').slice(0, 180);
  if (!id || !label) return null;
  return {
    id: `${String(item?.entity || 'Fuente').slice(0, 50)}:${id}`,
    type: String(item?.entity || 'Fuente').slice(0, 50),
    label,
    reference: String(item?.path || '').slice(0, 180) || undefined,
  };
}

export function createAssistantChatService(dependencies: ChatDependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const executeTool = dependencies.executeTool || executeAssistantTool;

  return async function sendAssistantMessage(
    input: AssistantMessageInput,
    user: AuthUser,
    correlationId: string,
  ): Promise<AssistantMessageReply> {
    const message = String(input.message || '').trim();
    if (message.length < 2 || message.length > 2_000) {
      throw new AssistantChatError('Escribe una consulta de entre 2 y 2,000 caracteres.', 'AI_MESSAGE_INVALID', 400);
    }

    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      throw new AssistantChatError('PRAVIA IA no está disponible en este momento.', 'AI_PROVIDER_NOT_CONFIGURED', 503);
    }

    const tools = buildTools(user);
    const context = normalizeContext(input.context);
    const conversation: Array<Record<string, unknown>> = [{
      role: 'user',
      content: [{ type: 'input_text', text: message }],
    }];
    const sources: AssistantSource[] = [];
    const seenSources = new Set<string>();

    for (let round = 0; round < 4; round += 1) {
      let response: Response;
      try {
        response = await fetchImpl('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(Number(process.env.AI_ASSISTANT_TIMEOUT_MS || process.env.AI_DOCUMENT_TIMEOUT_MS || 60_000)),
          body: JSON.stringify({
            model: providerModel(),
            store: false,
            instructions: systemInstructions(user, input),
            input: conversation,
            tools,
            tool_choice: 'auto',
            parallel_tool_calls: false,
            reasoning: { effort: reasoningEffort() },
            max_output_tokens: 2_048,
          }),
        });
      } catch (error: any) {
        console.error(JSON.stringify({
          type: 'ai_provider_error', level: 'error', code: 'AI_PROVIDER_NETWORK_ERROR',
          correlation_id: correlationId, error_name: error?.name || 'Error',
        }));
        throw new AssistantChatError('PRAVIA IA no pudo comunicarse con el proveedor. Intenta de nuevo.', 'AI_PROVIDER_NETWORK_ERROR', 503);
      }

      if (!response.ok) {
        const code = safeProviderCode(response.status);
        await response.text().catch(() => undefined);
        console.error(JSON.stringify({
          type: 'ai_provider_error', level: 'error', code, provider_status: response.status,
          correlation_id: correlationId,
        }));
        const status = response.status === 429 ? 503 : 502;
        throw new AssistantChatError('PRAVIA IA no pudo completar la consulta con el proveedor.', code, status);
      }

      const providerResponse = await response.json() as ProviderResponse;
      if (providerResponse.status === 'incomplete') {
        console.error(JSON.stringify({
          type: 'ai_provider_error', level: 'error', code: 'AI_PROVIDER_INCOMPLETE',
          reason: String(providerResponse.incomplete_details?.reason || 'unknown').slice(0, 80),
          correlation_id: correlationId,
        }));
        throw new AssistantChatError('PRAVIA IA no pudo completar la respuesta. Intenta de nuevo.', 'AI_PROVIDER_INCOMPLETE', 502);
      }

      const toolCalls = (providerResponse.output || []).filter((item: any) => item.type === 'function_call');
      if (!toolCalls.length) {
        const text = extractText(providerResponse);
        if (!text) throw new AssistantChatError('PRAVIA IA no devolvió una respuesta utilizable.', 'AI_PROVIDER_EMPTY_RESPONSE', 502);
        return { status: 'success', message: text, ...(sources.length ? { sources } : {}) };
      }

      conversation.push(...(providerResponse.output || []));
      for (const call of toolCalls.slice(0, 6)) {
        const tool = String(call.name || '') as AssistantToolName;
        if (!READ_TOOL_NAMES.has(tool) || !tools.some((item) => item.name === tool)) {
          conversation.push({
            type: 'function_call_output', call_id: String(call.call_id || ''),
            output: JSON.stringify({ success: false, code: 'AI_TOOL_NOT_AVAILABLE', error: 'La consulta no está autorizada para este usuario.' }),
          });
          continue;
        }

        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(String(call.arguments || '{}'));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
        } catch {
          conversation.push({
            type: 'function_call_output', call_id: String(call.call_id || ''),
            output: JSON.stringify({ success: false, code: 'AI_TOOL_ARGUMENTS_INVALID', error: 'Los argumentos de la consulta no son válidos.' }),
          });
          continue;
        }

        try {
          const result = await executeTool({ tool, args, context, user, correlationId });
          for (const provenance of result.provenance || []) {
            const source = sourceFromProvenance(provenance);
            if (source && !seenSources.has(source.id) && sources.length < 12) {
              seenSources.add(source.id);
              sources.push(source);
            }
          }
          conversation.push({
            type: 'function_call_output', call_id: String(call.call_id || ''),
            output: JSON.stringify({ success: true, data: result.data, truncated: result.truncated }),
          });
        } catch (error: any) {
          if (!(error instanceof AssistantToolError)) {
            console.error(JSON.stringify({
              type: 'ai_tool_error', level: 'error', code: 'AI_TOOL_EXECUTION_FAILED', tool,
              correlation_id: correlationId, error_name: error?.name || 'Error',
            }));
            throw new AssistantChatError('PRAVIA IA no pudo consultar los datos autorizados.', 'AI_TOOL_EXECUTION_FAILED', 503);
          }
          conversation.push({
            type: 'function_call_output', call_id: String(call.call_id || ''),
            output: JSON.stringify({ success: false, code: error.code, error: error.message }),
          });
        }
      }
    }

    throw new AssistantChatError('PRAVIA IA no pudo concluir la consulta. Intenta de nuevo.', 'AI_TOOL_LOOP_LIMIT', 502);
  };
}

export const sendAssistantMessage = createAssistantChatService();
