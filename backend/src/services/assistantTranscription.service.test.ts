import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssistantTranscriptionService } from './assistantTranscription.service';

describe('transcripción de voz de PRAVIA IA', () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.OPENAI_TRANSCRIPTION_MODEL;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key-never-printed';
    process.env.OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENAI_TRANSCRIPTION_MODEL; else process.env.OPENAI_TRANSCRIPTION_MODEL = previousModel;
  });

  it('envía audio multipart al endpoint oficial y devuelve texto revisable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: 'Muéstrame los pendientes urgentes.', usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const transcribe = createAssistantTranscriptionService(fetchImpl as any);
    const result = await transcribe({ buffer: Buffer.from('audio'), mimeType: 'audio/webm', filename: 'voz.webm' });
    expect(result).toMatchObject({ text: 'Muéstrame los pendientes urgentes.', model: 'gpt-4o-mini-transcribe', usage: { total_tokens: 19 } });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.openai.com/v1/audio/transcriptions', expect.objectContaining({ method: 'POST', body: expect.any(FormData) }));
    const request = fetchImpl.mock.calls[0][1];
    expect(request.headers.Authorization).toMatch(/^Bearer /);
  });

  it('falla de forma humana y controlada cuando no existe credencial', async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchImpl = vi.fn();
    await expect(createAssistantTranscriptionService(fetchImpl as any)({ buffer: Buffer.from('audio'), mimeType: 'audio/webm', filename: 'voz.webm' }))
      .rejects.toMatchObject({ code: 'AI_PROVIDER_NOT_CONFIGURED', status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('no filtra el cuerpo técnico de un rechazo del proveedor', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('invalid_api_key: detalle sensible', { status: 401 }));
    await expect(createAssistantTranscriptionService(fetchImpl as any)({ buffer: Buffer.from('audio'), mimeType: 'audio/webm', filename: 'voz.webm' }))
      .rejects.toMatchObject({ code: 'AI_TRANSCRIPTION_AUTH_FAILED', status: 502, message: 'No fue posible transcribir el audio. Intenta de nuevo.' });
  });
});
