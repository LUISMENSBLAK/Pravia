import type { AIUsageMetrics } from './openaiDocument.service';

export class AssistantTranscriptionError extends Error {
  constructor(message: string, readonly code: string, readonly status = 502) {
    super(message);
    this.name = 'AssistantTranscriptionError';
  }
}

type TranscriptionResult = {
  text: string;
  model: string;
  usage: AIUsageMetrics;
};

const ALLOWED_MODELS = new Set([
  'gpt-transcribe',
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  'gpt-4o-mini-transcribe-2025-12-15',
  'whisper-1',
]);

function configuredModel() {
  const value = String(process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe').trim();
  return ALLOWED_MODELS.has(value) ? value : 'gpt-4o-mini-transcribe';
}

export function createAssistantTranscriptionService(fetchImpl: typeof fetch = fetch) {
  return async function transcribe(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<TranscriptionResult> {
    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) throw new AssistantTranscriptionError('La transcripción de voz no está disponible en este momento.', 'AI_PROVIDER_NOT_CONFIGURED', 503);
    const model = configuredModel();
    const startedAt = Date.now();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }), input.filename);
    form.append('model', model);
    form.append('language', 'es');
    form.append('response_format', 'json');
    let response: Response;
    try {
      response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new AssistantTranscriptionError('No fue posible comunicarse con el servicio de transcripción.', 'AI_TRANSCRIPTION_NETWORK_ERROR', 503);
    }
    if (!response.ok) {
      await response.text().catch(() => undefined);
      const code = response.status === 401 || response.status === 403
        ? 'AI_TRANSCRIPTION_AUTH_FAILED'
        : response.status === 429 ? 'AI_TRANSCRIPTION_RATE_LIMITED' : 'AI_TRANSCRIPTION_FAILED';
      throw new AssistantTranscriptionError('No fue posible transcribir el audio. Intenta de nuevo.', code, response.status === 429 ? 503 : 502);
    }
    const payload = await response.json() as any;
    const text = String(payload?.text || '').trim();
    if (!text) throw new AssistantTranscriptionError('No se detectó voz comprensible en la grabación.', 'AI_TRANSCRIPTION_EMPTY', 422);
    const usage = payload?.usage || {};
    const inputTokens = Number(usage.input_tokens || 0);
    const outputTokens = Number(usage.output_tokens || 0);
    return {
      text: text.slice(0, 8_000),
      model,
      usage: {
        modelo: model,
        input_tokens: inputTokens,
        cached_input_tokens: 0,
        output_tokens: outputTokens,
        reasoning_tokens: 0,
        total_tokens: Number(usage.total_tokens || inputTokens + outputTokens),
        duracion_ms: Date.now() - startedAt,
        documentos_enviados: 0,
        costo_estimado_usd: 0,
        precios_version: 'provider-usage-only-2026-08',
        escalamiento_utilizado: false,
      },
    };
  };
}

export const transcribeAssistantAudio = createAssistantTranscriptionService();
