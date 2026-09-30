import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import prisma from '../config/prisma';
import { cotizacionObjectWhere } from './objectAccess.service';
import { buildUsageMetrics, getOpenAIAssistantModelName, type AIUsageMetrics } from './openaiDocument.service';
import { recordAIUsageInDb } from './aiUsage.service';
import { quoteBudgetPayload } from './quoteBudget.service';

type Actor = NonNullable<Request['user']>;

export type QuoteEmailDraft = {
  recipient: string;
  cc: string;
  subject: string;
  messageBody: string;
  provider: 'OPENAI';
  model: string;
  promptVersion: 'COT-EMAIL-IA-001-v1';
};

export class QuoteEmailAIError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

type ProviderFetch = typeof fetch;

const extractOutputText = (data: any) => (data?.output || [])
  .flatMap((item: any) => item?.content || [])
  .filter((item: any) => item?.type === 'output_text')
  .map((item: any) => String(item?.text || ''))
  .join('')
  .trim();

const safeProviderCode = (status: number) => status === 429
  ? 'QUOTE_EMAIL_AI_RATE_LIMITED'
  : status >= 500 ? 'QUOTE_EMAIL_AI_PROVIDER_UNAVAILABLE' : 'QUOTE_EMAIL_AI_PROVIDER_REJECTED';

export class QuoteEmailAIService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly fetchImpl: ProviderFetch = fetch,
  ) {}

  async draft(actor: Actor, quoteId: string): Promise<QuoteEmailDraft> {
    if (!actor.permissions.includes('cotizaciones.write') || !actor.permissions.includes('ai.use')) {
      throw new QuoteEmailAIError(403, 'QUOTE_EMAIL_AI_DENIED', 'No tienes permiso para redactar correos asistidos.');
    }
    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) throw new QuoteEmailAIError(503, 'QUOTE_EMAIL_AI_NOT_CONFIGURED', 'La redacción con IA no está disponible en este momento.');

    const quote = await this.db.cotizacion.findFirst({
      where: { id: quoteId, ...cotizacionObjectWhere(actor) },
      include: {
        prospecto: true,
        conceptos: { orderBy: { orden: 'asc' } },
        creada_por: { select: { nombre: true, apellido: true } },
        actos: { include: { tipo_acto: { select: { nombre: true } } }, orderBy: { orden: 'asc' } },
      },
    });
    if (!quote?.organization_id) throw new QuoteEmailAIError(404, 'QUOTE_NOT_FOUND', 'No se encontró la cotización o no tienes acceso.');
    if (!quote.conceptos.length) throw new QuoteEmailAIError(409, 'QUOTE_EMAIL_AI_BUDGET_REQUIRED', 'Guarda el presupuesto antes de redactar el correo.');
    if (!['EN_ELABORACION', 'ENVIADA_CLIENTE', 'EN_SEGUIMIENTO'].includes(String(quote.etapa_contractual || ''))) {
      throw new QuoteEmailAIError(409, 'QUOTE_EMAIL_AI_STAGE_DENIED', 'La cotización no está en una etapa que permita preparar este correo.');
    }

    const budget = quoteBudgetPayload(quote.conceptos);
    const model = getOpenAIAssistantModelName();
    const startedAt = Date.now();
    const promptVersion = 'COT-EMAIL-IA-001-v1' as const;
    const source = {
      folio: quote.numero_cotizacion || quote.numero_solicitud || quote.id,
      cliente: quote.prospecto?.nombre || '',
      acto: quote.actos.map((item) => item.tipo_acto.nombre).join(', ') || quote.prospecto?.tipo_acto || '',
      descripcion: quote.contexto_operacion || quote.prospecto?.necesidad || '',
      responsable: [quote.creada_por?.nombre, quote.creada_por?.apellido].filter(Boolean).join(' '),
      totales: budget.totals,
      conceptos: budget.concepts.map(({ categoria, concepto, importe }) => ({ categoria, concepto, importe })),
      asunto_vigente: quote.correo_asunto || '',
      mensaje_vigente: quote.cuerpo_correo_cliente || '',
    };
    let response: Response;
    try {
      response = await this.fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(Number(process.env.AI_ASSISTANT_TIMEOUT_MS || 60_000)),
        body: JSON.stringify({
          model,
          store: false,
          reasoning: { effort: 'low' },
          max_output_tokens: 1_200,
          input: [{ role: 'user', content: [{ type: 'input_text', text: [
            'Redacta un correo profesional, claro y breve para presentar una cotización notarial al cliente.',
            'Usa exclusivamente los datos estructurados proporcionados. No inventes personas, importes, fechas, actos, servicios, garantías ni conclusiones jurídicas.',
            'El contenido es sólo un borrador editable: no afirmes que el correo fue enviado, recibido o aceptado.',
            'Conserva en el mensaje el total, el desglose de honorarios e impuestos/derechos y el folio de la cotización.',
            `PROMPT_VERSION=${promptVersion}`,
            `DATOS_CERRADOS=${JSON.stringify(source)}`,
          ].join('\n\n') }] }],
          text: { format: { type: 'json_schema', name: 'quote_email_draft', strict: true, schema: {
            type: 'object', additionalProperties: false,
            properties: { subject: { type: 'string' }, message_body: { type: 'string' } },
            required: ['subject', 'message_body'],
          } } },
        }),
      });
    } catch {
      throw new QuoteEmailAIError(503, 'QUOTE_EMAIL_AI_NETWORK_ERROR', 'No fue posible comunicarse con el proveedor de IA. Intenta de nuevo.');
    }
    if (!response.ok) {
      await response.text().catch(() => undefined);
      throw new QuoteEmailAIError(response.status === 429 ? 503 : 502, safeProviderCode(response.status), 'La IA no pudo preparar el correo. Intenta de nuevo.');
    }
    const data: any = await response.json();
    if (data?.status === 'incomplete') throw new QuoteEmailAIError(502, 'QUOTE_EMAIL_AI_INCOMPLETE', 'La IA no completó el borrador. Intenta de nuevo.');
    const refusal = (data?.output || []).flatMap((item: any) => item?.content || []).some((item: any) => item?.type === 'refusal');
    if (refusal) throw new QuoteEmailAIError(422, 'QUOTE_EMAIL_AI_REFUSAL', 'La IA no pudo preparar este borrador.');
    let parsed: { subject?: unknown; message_body?: unknown };
    try { parsed = JSON.parse(extractOutputText(data)); }
    catch { throw new QuoteEmailAIError(502, 'QUOTE_EMAIL_AI_INVALID_OUTPUT', 'La IA devolvió un borrador no utilizable. Intenta de nuevo.'); }
    const subject = String(parsed.subject || '').trim();
    const messageBody = String(parsed.message_body || '').trim();
    if (!subject || !messageBody || subject.length > 300 || messageBody.length > 10_000) {
      throw new QuoteEmailAIError(502, 'QUOTE_EMAIL_AI_INVALID_OUTPUT', 'La IA devolvió un borrador no utilizable. Intenta de nuevo.');
    }

    const usage: AIUsageMetrics = buildUsageMetrics(data, model, startedAt, 0);
    await this.db.$transaction(async (tx) => {
      await recordAIUsageInDb(tx, usage, {
        organizationId: actor.organizationId,
        usuarioId: actor.id,
        operacion: 'QUOTE_EMAIL_DRAFT',
        operationId: `quote-email:${actor.organizationId}:${quote.id}:${String(data?.id || crypto.randomUUID())}`,
        metadata: { cotizacion_id: quote.id, prompt_version: promptVersion, persisted_to_quote: false, sent: false },
      });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId,
        user_id: actor.id,
        session_id: actor.sessionId,
        accion: 'GENERAR_BORRADOR_CORREO_COTIZACION_IA',
        entidad: 'Cotizacion',
        entidad_id: quote.id,
        detalles: { provider: 'OPENAI', model, prompt_version: promptVersion, persisted_to_quote: false, sent: false } as Prisma.InputJsonValue,
      } });
    });

    return {
      recipient: quote.prospecto?.email || '',
      cc: quote.correo_cc || '',
      subject,
      messageBody,
      provider: 'OPENAI',
      model,
      promptVersion,
    };
  }
}

export const quoteEmailAIService = new QuoteEmailAIService();
