import type { ActorContext } from '../auth/actorContext';
import { aiGateway, type AiGatewayExecutor } from '../platform/aiGateway.runtime';
import { AI_OPERATION_CODES } from '../platform/aiBillingPolicy';
import { PlatformDomainError } from '../platform/platform.errors';

export class AssistantTranscriptionError extends Error {
  constructor(message: string, readonly code: string, readonly status = 502) {
    super(message);
    this.name = 'AssistantTranscriptionError';
  }
}

type TranscriptionResult = {
  text: string;
};

const ALLOWED_MODELS = new Set([
  'gpt-transcribe',
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  'gpt-4o-mini-transcribe-2025-12-15',
  'whisper-1',
]);

export function getAssistantTranscriptionModelName() {
  const value = String(process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe').trim();
  return ALLOWED_MODELS.has(value) ? value : 'gpt-4o-mini-transcribe';
}

export function createAssistantTranscriptionService(gateway: AiGatewayExecutor = aiGateway) {
  return async function transcribe(input: { buffer: Buffer; mimeType: string; filename: string;
    actor: ActorContext; idempotencyKey: string; traceId: string }): Promise<TranscriptionResult> {
    if (!input.idempotencyKey || !input.traceId) throw new AssistantTranscriptionError('La transcripción requiere trazabilidad e idempotencia.', 'AI_IDEMPOTENCY_CONTEXT_REQUIRED', 400);
    try {
      const payload: any = await gateway.execute<any>({
        actor: input.actor,
        operationCode: AI_OPERATION_CODES.assistantTranscription,
        billingClass: 'CUSTOMER_WALLET',
        idempotencyKey: input.idempotencyKey,
        traceId: input.traceId,
        timeoutMs: 60_000,
        payload: { kind: 'transcription', buffer: input.buffer, mimeType: input.mimeType,
          filename: input.filename, language: 'es', retryHttp: 3 },
      });
      const text = String(payload?.text || '').trim();
      if (!text) throw new AssistantTranscriptionError('No se detectó voz comprensible en la grabación.', 'AI_TRANSCRIPTION_EMPTY', 422);
      return { text: text.slice(0, 8_000) };
    } catch (error) {
      if (error instanceof AssistantTranscriptionError) throw error;
      if (error instanceof PlatformDomainError) throw new AssistantTranscriptionError(error.message, error.code, error.status);
      throw new AssistantTranscriptionError('No fue posible transcribir el audio. Intenta de nuevo.', 'AI_TRANSCRIPTION_FAILED', 502);
    }
  };
}

export const transcribeAssistantAudio = createAssistantTranscriptionService();
