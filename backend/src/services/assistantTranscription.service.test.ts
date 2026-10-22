import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActorContext } from '../auth/actorContext';
import { AI_OPERATION_CODES } from '../platform/aiBillingPolicy';
import { PlatformDomainError } from '../platform/platform.errors';
import { createAssistantTranscriptionService } from './assistantTranscription.service';

const actor: ActorContext = {
  userId: 'user-qa',
  organizationId: 'org-qa',
  membershipId: 'membership-qa',
  role: 'DIRECCION',
  permissions: ['ai.use'],
  scope: 'GLOBAL',
  sessionId: 'session-qa',
};

const request = {
  buffer: Buffer.from('audio'),
  mimeType: 'audio/webm',
  filename: 'voz.webm',
  actor,
  idempotencyKey: 'transcription:qa:one',
  traceId: 'trace-transcription-qa',
};

describe('transcripción de voz de PRAVIA IA', () => {
  const previousModel = process.env.OPENAI_TRANSCRIPTION_MODEL;

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousModel === undefined) delete process.env.OPENAI_TRANSCRIPTION_MODEL;
    else process.env.OPENAI_TRANSCRIPTION_MODEL = previousModel;
  });

  it('envía el audio al gateway con clasificación económica e idempotencia obligatorias', async () => {
    process.env.OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
    const gateway = { execute: vi.fn().mockResolvedValue({ text: 'Muéstrame los pendientes urgentes.' }) };
    const result = await createAssistantTranscriptionService(gateway as any)(request);

    expect(result).toEqual({ text: 'Muéstrame los pendientes urgentes.' });
    expect(gateway.execute).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      operationCode: AI_OPERATION_CODES.assistantTranscription,
      billingClass: 'CUSTOMER_WALLET',
      idempotencyKey: request.idempotencyKey,
      traceId: request.traceId,
      payload: expect.objectContaining({
        kind: 'transcription',
        buffer: request.buffer,
        mimeType: 'audio/webm',
        filename: 'voz.webm',
      }),
    }));
  });

  it('falla cerrado antes del gateway cuando falta contexto de idempotencia', async () => {
    const gateway = { execute: vi.fn() };
    await expect(createAssistantTranscriptionService(gateway as any)({ ...request, idempotencyKey: '' }))
      .rejects.toMatchObject({ code: 'AI_IDEMPOTENCY_CONTEXT_REQUIRED', status: 400 });
    expect(gateway.execute).not.toHaveBeenCalled();
  });

  it('propaga el error económico sanitizado del gateway sin inventar uso ni costo cero', async () => {
    const gateway = { execute: vi.fn().mockRejectedValue(new PlatformDomainError(
      'AI_PROVIDER_NOT_CONFIGURED', 'El proveedor IA no está configurado.', 503,
    )) };
    await expect(createAssistantTranscriptionService(gateway as any)(request))
      .rejects.toMatchObject({ code: 'AI_PROVIDER_NOT_CONFIGURED', status: 503, message: 'El proveedor IA no está configurado.' });
  });

  it('no filtra detalles técnicos de errores inesperados', async () => {
    const gateway = { execute: vi.fn().mockRejectedValue(new Error('invalid_api_key: detalle sensible')) };
    await expect(createAssistantTranscriptionService(gateway as any)(request))
      .rejects.toMatchObject({ code: 'AI_TRANSCRIPTION_FAILED', status: 502, message: 'No fue posible transcribir el audio. Intenta de nuevo.' });
  });
});
