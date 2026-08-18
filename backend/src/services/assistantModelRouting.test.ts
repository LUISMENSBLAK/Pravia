import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extraerMultiplesDocumentos,
  getOpenAIAssistantModelName,
  getOpenAIEscalationModelName,
  getOpenAIModelName,
} from './openaiDocument.service';
import { getAssistantTranscriptionModelName } from './assistantTranscription.service';

const OPTIONAL_MODEL_ENV = [
  'OPENAI_DOCUMENT_MODEL',
  'AI_DOCUMENT_MODEL',
  'OPENAI_ASSISTANT_MODEL',
  'OPENAI_ESCALATION_MODEL',
  'OPENAI_TRANSCRIPTION_MODEL',
  'AI_ESCALATION_ENABLED',
] as const;

describe('routing canónico de modelos PRAVIA IA', () => {
  const previous = new Map<string, string | undefined>();
  const previousKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    for (const key of OPTIONAL_MODEL_ENV) {
      previous.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of OPTIONAL_MODEL_ENV) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });

  it('usa defaults independientes sin ENV opcional', () => {
    expect(getOpenAIModelName()).toBe('gpt-5.4-nano');
    expect(getOpenAIAssistantModelName()).toBe('gpt-5.4-mini');
    expect(getOpenAIEscalationModelName()).toBe('gpt-5.4-mini');
    expect(getAssistantTranscriptionModelName()).toBe('gpt-4o-mini-transcribe');
  });

  it('respeta un modelo custom válido para el asistente', () => {
    process.env.OPENAI_ASSISTANT_MODEL = 'gpt-5.4-mini-2026-03-17';
    expect(getOpenAIAssistantModelName()).toBe('gpt-5.4-mini-2026-03-17');
  });

  it('cambiar el modelo documental no cambia el modelo general', () => {
    process.env.OPENAI_DOCUMENT_MODEL = 'gpt-5.4-nano-2026-03-17';
    expect(getOpenAIModelName()).toBe('gpt-5.4-nano-2026-03-17');
    expect(getOpenAIAssistantModelName()).toBe('gpt-5.4-mini');
  });

  it('escala una extracción dudosa de Nano a Mini mediante el mecanismo existente', async () => {
    process.env.OPENAI_API_KEY = 'test-key-never-sent';
    const responseBody = (confidence: 'LECTURA_DUDOSA' | 'LECTURA_CLARA') => ({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        tipo_persona_detectado: 'FISICA',
        resumen_ejecutivo: 'Resultado sintético.',
        alertas: [],
        campos: [{ campo: 'rfc', valor: 'TEST000000AAA', confianza: confidence, fuente: 'fixture.pdf', documento_id: 'doc-1' }],
        domicilios_detectados: [],
        actividades_economicas: [],
        regimenes: [],
      }) }] }],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(responseBody('LECTURA_DUDOSA')), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(responseBody('LECTURA_CLARA')), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await extraerMultiplesDocumentos([{
      documentoId: 'doc-1',
      nombreOriginal: 'fixture.pdf',
      tipoDocumento: 'OTRO',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 contenido sintético'),
    }]);

    const models = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).model);
    expect(models).toEqual(['gpt-5.4-nano', 'gpt-5.4-mini']);
    expect(result.modelo).toBe('gpt-5.4-mini');
    expect(result.usos).toEqual([
      expect.objectContaining({ modelo: 'gpt-5.4-nano', escalamiento_utilizado: false }),
      expect.objectContaining({ modelo: 'gpt-5.4-mini', escalamiento_utilizado: true }),
    ]);
  });

  it('el asistente general nunca hereda Nano del pipeline documental', () => {
    process.env.OPENAI_DOCUMENT_MODEL = 'gpt-5.4-nano';
    delete process.env.OPENAI_ASSISTANT_MODEL;
    expect(getOpenAIAssistantModelName()).toBe('gpt-5.4-mini');
  });
});
