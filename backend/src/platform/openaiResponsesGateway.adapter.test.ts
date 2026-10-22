import { describe, expect, it, vi } from 'vitest';
import { OpenAiResponsesGatewayAdapter } from './openaiResponsesGateway.adapter';

describe('OpenAI Responses economic adapter', () => {
  it('reintenta un HTTP transitorio dentro de la misma ejecución económica', async () => {
    const db = { resourceCostVersion: { findFirst: vi.fn().mockResolvedValue({
      id: 'cost-http', unit: 'MILLION_TOKENS', currency: 'MXN', cost_amount: '1',
      effective_from: new Date('2026-10-17T00:00:00Z'),
      metadata: { output_per_million: '2', cached_input_per_million: '0.5' },
    }) } } as any;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('temporal', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed', output: [], usage: {
        input_tokens: 4, output_tokens: 3, input_tokens_details: { cached_tokens: 0 },
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const adapter = new OpenAiResponsesGatewayAdapter(db, fetcher as any, 'synthetic-key');
    const result = await adapter.execute<any>({ modelCode: 'qa-model',
      payload: { body: { input: [] }, retryHttp: 2 }, timeoutMs: 2_000, traceId: 'http-retry' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.output.status).toBe('completed');
    expect(result.providerCostAmount).toBe('0.00001000');
    expect(result.fxSnapshot).toMatchObject({ failedHttpAttempts: [{ status: 503, costVerified: false }] });
  });

  it('aggregates provider usage and COGS across one incomplete technical retry', async () => {
    const db = { resourceCostVersion: { findFirst: vi.fn().mockResolvedValue({
      id: 'cost-v1', unit: 'MILLION_TOKENS', currency: 'USD', cost_amount: '1',
      effective_from: new Date('2026-10-17T00:00:00Z'),
      metadata: { output_per_million: '2', cached_input_per_million: '0.5',
        fx_rate: '18', fx_source: 'LOCAL_QA', fx_as_of: '2026-10-17T00:00:00Z' },
    }) } } as any;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'incomplete', usage: {
        input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 2 },
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed', output: [], usage: {
        input_tokens: 20, output_tokens: 10, input_tokens_details: { cached_tokens: 4 },
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const adapter = new OpenAiResponsesGatewayAdapter(db, fetcher as any, 'synthetic-key');

    const result = await adapter.execute<any>({ modelCode: 'qa-model',
      payload: { body: { input: [] }, retryIncomplete: true }, timeoutMs: 2_000, traceId: 'retry-trace' });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.output.status).toBe('completed');
    expect(result.inputTokens).toBe(30);
    expect(result.outputTokens).toBe(15);
    expect(result.providerCostAmount).toBe('0.00005700');
    expect(result.fxSnapshot).toMatchObject({ costVersionId: 'cost-v1', rate: '18' });
  });

  it('prices token-metered transcription from versioned provider usage', async () => {
    const db = { resourceCostVersion: { findFirst: vi.fn().mockResolvedValue({
      id: 'transcription-token-cost', unit: 'MILLION_TOKENS', currency: 'MXN', cost_amount: '1',
      effective_from: new Date('2026-10-17T00:00:00Z'),
      metadata: { output_per_million: '2', cached_input_per_million: '0.5' },
    }) } } as any;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: 'Texto revisable', usage: { input_tokens: 12, output_tokens: 7,
        input_token_details: { cached_tokens: 0 } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const adapter = new OpenAiResponsesGatewayAdapter(db, fetcher as any, 'synthetic-key');

    const result = await adapter.execute<any>({ modelCode: 'transcribe-qa', payload: {
      kind: 'transcription', buffer: Buffer.from('audio'), mimeType: 'audio/webm', filename: 'voz.webm',
    }, timeoutMs: 2_000, traceId: 'transcription-token-trace' });

    expect(result.output.text).toBe('Texto revisable');
    expect(result.providerCostAmount).toBe('0.00002600');
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(7);
    expect(result.fxSnapshot).toMatchObject({ billingUnits: {
      unit: 'MILLION_TOKENS', inputTokens: 12, outputTokens: 7, cachedTokens: 0,
    } });
    expect(fetcher).toHaveBeenCalledWith('https://api.openai.com/v1/audio/transcriptions', expect.objectContaining({
      method: 'POST', body: expect.any(FormData),
      headers: expect.objectContaining({ 'Idempotency-Key': 'transcription-token-trace' }),
    }));
  });

  it('prices minute-metered transcription from provider-reported duration', async () => {
    const db = { resourceCostVersion: { findFirst: vi.fn().mockResolvedValue({
      id: 'transcription-minute-cost', unit: 'MINUTE', currency: 'USD', cost_amount: '0.006',
      effective_from: new Date('2026-10-17T00:00:00Z'),
      metadata: { fx_rate: '18', fx_source: 'LOCAL_QA', fx_as_of: '2026-10-17T00:00:00Z' },
    }) } } as any;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: 'Treinta segundos', duration: 30,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const adapter = new OpenAiResponsesGatewayAdapter(db, fetcher as any, 'synthetic-key');

    const result = await adapter.execute<any>({ modelCode: 'transcribe-qa', payload: {
      kind: 'transcription', buffer: Buffer.from('audio'), mimeType: 'audio/webm', filename: 'voz.webm',
    }, timeoutMs: 2_000, traceId: 'transcription-minute-trace' });

    expect(result.providerCostAmount).toBe('0.00300000');
    expect(result.fxRate).toBe('18');
    expect(result.fxSnapshot).toMatchObject({ billingUnits: { unit: 'MINUTE', durationSeconds: 30 } });
  });

  it('fails closed when transcription omits the provider billing units', async () => {
    const db = { resourceCostVersion: { findFirst: vi.fn().mockResolvedValue({
      id: 'transcription-token-cost', unit: 'MILLION_TOKENS', currency: 'MXN', cost_amount: '1',
      effective_from: new Date('2026-10-17T00:00:00Z'),
      metadata: { output_per_million: '2', cached_input_per_million: '0.5' },
    }) } } as any;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'Sin uso' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const adapter = new OpenAiResponsesGatewayAdapter(db, fetcher as any, 'synthetic-key');

    await expect(adapter.execute({ modelCode: 'transcribe-qa', payload: {
      kind: 'transcription', buffer: Buffer.from('audio'), mimeType: 'audio/webm', filename: 'voz.webm',
    }, timeoutMs: 2_000, traceId: 'transcription-no-usage' }))
      .rejects.toMatchObject({ code: 'AI_PROVIDER_USAGE_MISSING', status: 503 });
  });
});
