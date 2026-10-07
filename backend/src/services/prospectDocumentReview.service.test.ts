import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestProspectDocumentReview, reviewIsCurrent } from './prospectDocumentReview.service';

const originalKey = process.env.OPENAI_API_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

const document = { id: 'doc-1', name: 'minuta.txt', mime: 'text/plain', buffer: Buffer.from('La minuta consigna fecha 12 de abril de 2026.') };
const providerResponse = (payload: unknown) => new Response(JSON.stringify({
  status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
  usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
}), { status: 200, headers: { 'content-type': 'application/json' } });

describe('Prospectos · revisión documental preliminar', () => {
  it('compara snapshots JSON sin depender del orden interno de claves de PostgreSQL', () => {
    expect(reviewIsCurrent({ act_snapshot: [{ name: 'Compraventa', id: 'a' }], document_snapshot: [{ size: 30, id: 'd' }] },
      [{ id: 'a', name: 'Compraventa' }], [{ id: 'd', size: 30 }])).toBe(true);
    expect(reviewIsCurrent({ act_snapshot: [{ id: 'a' }], document_snapshot: [{ id: 'd', checksum: 'old' }] },
      [{ id: 'a' }], [{ id: 'd', checksum: 'new' }])).toBe(false);
  });

  it('envía sólo las fuentes cargadas y acepta únicamente citas a sus IDs', async () => {
    process.env.OPENAI_API_KEY = 'synthetic-test-key';
    const fetchImpl = vi.fn().mockResolvedValue(providerResponse({ summary: 'Revisión preliminar.', findings: [
      { detail: 'Verificar la fecha consignada.', document_ids: ['doc-1'] },
    ] }));
    const result = await requestProspectDocumentReview({ acts: ['Protocolización de acta de asamblea'],
      configuredContext: [], documents: [document], fetchImpl });
    expect(result.findings).toEqual([{ detail: 'Verificar la fecha consignada.', document_ids: ['doc-1'] }]);
    const request = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
    expect(JSON.stringify(request.input)).toContain('doc-1');
    expect(JSON.stringify(request.input)).toContain('La minuta consigna fecha');
    expect(request.store).toBe(false);
  });

  it('rechaza un hallazgo que cite documentos inexistentes sin guardar falso éxito', async () => {
    process.env.OPENAI_API_KEY = 'synthetic-test-key';
    await expect(requestProspectDocumentReview({ acts: ['Compraventa'], configuredContext: [], documents: [document],
      fetchImpl: vi.fn().mockResolvedValue(providerResponse({ summary: 'Discrepancia.', findings: [
        { detail: 'Titular distinto.', document_ids: ['not-uploaded'] },
      ] })) })).rejects.toMatchObject({ code: 'PROSPECT_REVIEW_INVALID_OUTPUT', status: 503 });
  });

  it('mantiene la revisión opcional cuando falta el proveedor, sin crear resultados sintéticos', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(requestProspectDocumentReview({ acts: ['Compraventa'], configuredContext: [], documents: [document] }))
      .rejects.toMatchObject({ code: 'PROSPECT_REVIEW_AI_UNAVAILABLE', status: 503 });
  });
});
