import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { openAiProviderFetch } from './openaiProvider.adapter';
import type { AiProviderAdapter, AiProviderResult } from './aiGateway.service';
import { PlatformDomainError } from './platform.errors';

type ResponsesPayload = { body: Record<string, unknown>; retryIncomplete?: boolean; retryHttp?: number };
type TranscriptionPayload = { kind: 'transcription'; buffer: Buffer; mimeType: string; filename: string;
  language?: string; retryHttp?: number };
type RateMetadata = { output_per_million?: unknown; cached_input_per_million?: unknown;
  fx_rate?: unknown; fx_source?: unknown; fx_as_of?: unknown };

const positiveRate = (value: unknown, label: string) => {
  try {
    const rate = new Prisma.Decimal(String(value));
    if (!rate.isFinite() || rate.isNegative()) throw new Error('invalid');
    return rate;
  } catch {
    throw new PlatformDomainError('AI_PROVIDER_RATE_INVALID', `La tarifa de ${label} no está configurada correctamente.`, 503);
  }
};

/** A real provider adapter, used only behind AiGateway. No domain service may invoke it directly. */
export class OpenAiResponsesGatewayAdapter implements AiProviderAdapter {
  readonly providerCode = 'OPENAI';

  constructor(private readonly db: PrismaClient = prisma, private readonly fetchImpl: typeof fetch = fetch,
    private readonly apiKey = process.env.OPENAI_API_KEY || '') {}

  async execute<T>(input: { modelCode: string; payload: unknown; timeoutMs: number; traceId: string }): Promise<AiProviderResult<T>> {
    const rawPayload = input.payload as ResponsesPayload | TranscriptionPayload | null;
    if (rawPayload && 'kind' in rawPayload && rawPayload.kind === 'transcription') {
      return this.executeTranscription<T>(input, rawPayload);
    }
    const payload = rawPayload as ResponsesPayload | null;
    if (!payload?.body || typeof payload.body !== 'object' || Array.isArray(payload.body)) {
      throw new PlatformDomainError('AI_PROVIDER_PAYLOAD_INVALID', 'La solicitud IA no tiene un cuerpo válido.', 400);
    }
    if (!this.apiKey.trim()) throw new PlatformDomainError('AI_PROVIDER_NOT_CONFIGURED', 'El proveedor IA no está configurado.', 503);

    const rate = await this.db.resourceCostVersion.findFirst({ where: {
      resource_code: `AI_MODEL:${input.modelCode}`, provider_code: 'OPENAI',
      effective_from: { lte: new Date() }, OR: [{ effective_to: null }, { effective_to: { gt: new Date() } }],
    }, orderBy: { version: 'desc' } });
    if (!rate || rate.unit !== 'MILLION_TOKENS') {
      throw new PlatformDomainError('AI_PROVIDER_RATE_NOT_CONFIGURED', 'Falta la tarifa versionada del modelo IA.', 503);
    }
    if (!['USD', 'MXN'].includes(rate.currency)) {
      throw new PlatformDomainError('AI_PROVIDER_CURRENCY_UNSUPPORTED', 'La moneda del costo IA no está soportada.', 503);
    }
    const metadata = rate.metadata && typeof rate.metadata === 'object' && !Array.isArray(rate.metadata)
      ? rate.metadata as RateMetadata : {};
    const inputRate = positiveRate(rate.cost_amount, 'entrada');
    const outputRate = positiveRate(metadata.output_per_million, 'salida');
    const cachedRate = positiveRate(metadata.cached_input_per_million, 'entrada en caché');
    const fxRate = rate.currency === 'MXN' ? new Prisma.Decimal(1) : positiveRate(metadata.fx_rate, 'tipo de cambio');
    if (fxRate.lessThanOrEqualTo(0) || (rate.currency !== 'MXN' && (!metadata.fx_source || !metadata.fx_as_of))) {
      throw new PlatformDomainError('AI_FX_SNAPSHOT_REQUIRED', 'Falta la fuente y vigencia del tipo de cambio IA.', 503);
    }
    const started = Date.now();
    let data: Record<string, any> = {};
    let inputTokens = 0; let outputTokens = 0; let cachedTokens = 0;
    let providerCost = new Prisma.Decimal(0);
    const failedHttpAttempts: Array<{ status: number; costVerified: false }> = [];
    const attempts = payload.retryIncomplete === true ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const httpAttempts = Math.max(1, Math.min(Number(payload.retryHttp || 1), 3));
      let response: Response | undefined;
      for (let httpAttempt = 1; httpAttempt <= httpAttempts; httpAttempt += 1) {
        response = await openAiProviderFetch('/v1/responses', { method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
          signal: AbortSignal.timeout(Math.max(1_000, Math.min(input.timeoutMs, 300_000))),
          body: JSON.stringify({ ...payload.body, model: input.modelCode, store: false }),
        }, this.fetchImpl);
        if (response.ok) break;
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        failedHttpAttempts.push({ status: response.status, costVerified: false });
        await response.text().catch(() => undefined);
        if (!retryable || httpAttempt === httpAttempts) {
          throw new PlatformDomainError('AI_PROVIDER_HTTP_ERROR', 'El proveedor IA no completó la solicitud.', response.status === 429 ? 503 : 502,
            { providerStatus: response.status, providerAttempts: httpAttempt });
        }
      }
      if (!response?.ok) throw new PlatformDomainError('AI_PROVIDER_HTTP_ERROR', 'El proveedor IA no completó la solicitud.', 502);
      data = await response.json() as Record<string, any>;
      const usage = data.usage || {};
      if (usage.input_tokens === undefined || usage.output_tokens === undefined) {
        throw new PlatformDomainError('AI_PROVIDER_USAGE_MISSING', 'El proveedor no reportó unidades facturables.', 503);
      }
      const attemptInput = Number(usage.input_tokens || 0);
      const attemptOutput = Number(usage.output_tokens || 0);
      const attemptCached = Number(usage.input_tokens_details?.cached_tokens || 0);
      if (![attemptInput, attemptOutput, attemptCached].every((value) => Number.isSafeInteger(value) && value >= 0)
        || attemptCached > attemptInput) {
        throw new PlatformDomainError('AI_PROVIDER_USAGE_INVALID', 'El uso reportado por el proveedor no es válido.', 503);
      }
      inputTokens += attemptInput; outputTokens += attemptOutput; cachedTokens += attemptCached;
      providerCost = providerCost.plus(inputRate.mul(attemptInput - attemptCached)
        .plus(cachedRate.mul(attemptCached)).plus(outputRate.mul(attemptOutput)).div(1_000_000));
      if (data.status !== 'incomplete') break;
    }
    return {
      output: data as T, inputTokens, outputTokens,
      providerCostAmount: providerCost.toFixed(8), providerCostCurrency: rate.currency,
      fxRate: fxRate.toString(),
      fxSnapshot: { rate: fxRate.toString(), source: String(metadata.fx_source || 'MXN'),
        asOf: String(metadata.fx_as_of || rate.effective_from.toISOString()),
        costVersionId: rate.id, currency: rate.currency,
        ...(failedHttpAttempts.length ? { failedHttpAttempts } : {}) },
      latencyMs: Date.now() - started,
    };
  }

  private async executeTranscription<T>(
    input: { modelCode: string; payload: unknown; timeoutMs: number; traceId: string },
    payload: TranscriptionPayload,
  ): Promise<AiProviderResult<T>> {
    if (!Buffer.isBuffer(payload.buffer) || !payload.buffer.length || !payload.mimeType || !payload.filename) {
      throw new PlatformDomainError('AI_PROVIDER_PAYLOAD_INVALID', 'La solicitud de transcripción no tiene un audio válido.', 400);
    }
    if (!this.apiKey.trim()) throw new PlatformDomainError('AI_PROVIDER_NOT_CONFIGURED', 'El proveedor IA no está configurado.', 503);
    const rate = await this.db.resourceCostVersion.findFirst({ where: {
      resource_code: `AI_MODEL:${input.modelCode}`, provider_code: 'OPENAI',
      effective_from: { lte: new Date() }, OR: [{ effective_to: null }, { effective_to: { gt: new Date() } }],
    }, orderBy: { version: 'desc' } });
    if (!rate || !['MILLION_TOKENS', 'MINUTE'].includes(rate.unit)) {
      throw new PlatformDomainError('AI_PROVIDER_RATE_NOT_CONFIGURED', 'Falta la tarifa versionada de transcripción.', 503);
    }
    if (!['USD', 'MXN'].includes(rate.currency)) {
      throw new PlatformDomainError('AI_PROVIDER_CURRENCY_UNSUPPORTED', 'La moneda del costo IA no está soportada.', 503);
    }
    const metadata = rate.metadata && typeof rate.metadata === 'object' && !Array.isArray(rate.metadata)
      ? rate.metadata as RateMetadata : {};
    const fxRate = rate.currency === 'MXN' ? new Prisma.Decimal(1) : positiveRate(metadata.fx_rate, 'tipo de cambio');
    if (fxRate.lessThanOrEqualTo(0) || (rate.currency !== 'MXN' && (!metadata.fx_source || !metadata.fx_as_of))) {
      throw new PlatformDomainError('AI_FX_SNAPSHOT_REQUIRED', 'Falta la fuente y vigencia del tipo de cambio IA.', 503);
    }
    const inputRate = positiveRate(rate.cost_amount, rate.unit === 'MINUTE' ? 'minuto de audio' : 'entrada');
    const outputRate = rate.unit === 'MILLION_TOKENS' ? positiveRate(metadata.output_per_million, 'salida') : new Prisma.Decimal(0);
    const cachedRate = rate.unit === 'MILLION_TOKENS' ? positiveRate(metadata.cached_input_per_million, 'entrada en caché') : new Prisma.Decimal(0);
    const buildForm = () => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(payload.buffer)], { type: payload.mimeType }), payload.filename);
      form.append('model', input.modelCode);
      form.append('language', payload.language || 'es');
      form.append('response_format', 'json');
      return form;
    };
    const started = Date.now();
    const attempts = Math.max(1, Math.min(Number(payload.retryHttp || 1), 3));
    const failedHttpAttempts: Array<{ status: number; costVerified: false }> = [];
    let response: Response | undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      response = await openAiProviderFetch('/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Idempotency-Key': input.traceId },
        body: buildForm(), signal: AbortSignal.timeout(Math.max(1_000, Math.min(input.timeoutMs, 300_000))),
      }, this.fetchImpl);
      if (response.ok) break;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      failedHttpAttempts.push({ status: response.status, costVerified: false });
      await response.text().catch(() => undefined);
      if (!retryable || attempt === attempts) {
        throw new PlatformDomainError('AI_PROVIDER_HTTP_ERROR', 'El proveedor IA no completó la transcripción.', response.status === 429 ? 503 : 502,
          { providerStatus: response.status, providerAttempts: attempt });
      }
    }
    if (!response?.ok) throw new PlatformDomainError('AI_PROVIDER_HTTP_ERROR', 'El proveedor IA no completó la transcripción.', 502);
    const data = await response.json() as Record<string, any>;
    const usage = data.usage || {};
    let inputTokens = 0; let outputTokens = 0; let providerCost: Prisma.Decimal; let billingUnits: Record<string, unknown>;
    if (rate.unit === 'MILLION_TOKENS') {
      inputTokens = Number(usage.input_tokens);
      outputTokens = Number(usage.output_tokens);
      const cachedTokens = Number(usage.input_token_details?.cached_tokens || usage.input_tokens_details?.cached_tokens || 0);
      if (![inputTokens, outputTokens, cachedTokens].every((value) => Number.isSafeInteger(value) && value >= 0) || cachedTokens > inputTokens) {
        throw new PlatformDomainError('AI_PROVIDER_USAGE_MISSING', 'El proveedor no reportó tokens facturables válidos para la transcripción.', 503);
      }
      providerCost = inputRate.mul(inputTokens - cachedTokens).plus(cachedRate.mul(cachedTokens)).plus(outputRate.mul(outputTokens)).div(1_000_000);
      billingUnits = { unit: rate.unit, inputTokens, outputTokens, cachedTokens };
    } else {
      const durationSeconds = Number(data.duration ?? usage.seconds ?? usage.duration);
      if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
        throw new PlatformDomainError('AI_PROVIDER_USAGE_MISSING', 'El proveedor no reportó la duración facturable de la transcripción.', 503);
      }
      providerCost = inputRate.mul(durationSeconds).div(60);
      billingUnits = { unit: rate.unit, durationSeconds };
    }
    return {
      output: data as T, inputTokens, outputTokens,
      providerCostAmount: providerCost.toFixed(8), providerCostCurrency: rate.currency,
      fxRate: fxRate.toString(),
      fxSnapshot: { rate: fxRate.toString(), source: String(metadata.fx_source || 'MXN'),
        asOf: String(metadata.fx_as_of || rate.effective_from.toISOString()), costVersionId: rate.id,
        currency: rate.currency, billingUnits,
        ...(failedHttpAttempts.length ? { failedHttpAttempts } : {}) } as Prisma.InputJsonValue,
      latencyMs: Date.now() - started,
    };
  }
}
