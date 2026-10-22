import { describe, expect, it, vi } from 'vitest';
import { requestProspectDocumentReview, reviewIsCurrent } from './prospectDocumentReview.service';

const actor = { id: 'user-qa', organizationId: 'org-qa', membershipId: 'membership-qa', rol: 'DIRECCION',
  scope: 'GLOBAL', sessionId: 'session-qa', permissions: ['prospectos.write', 'documentos.read', 'ia.execute', 'ai.use'] } as any;

const document = { id: 'doc-1', name: 'minuta.txt', mime: 'text/plain', buffer: Buffer.from('La minuta consigna fecha 12 de abril de 2026.') };
const providerPayload = (payload: unknown) => ({
  status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
  usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
});
const gateway = (payload: unknown) => ({ execute: vi.fn().mockResolvedValue(providerPayload(payload)) });

describe('Prospectos · revisión documental preliminar', () => {
  it('compara snapshots JSON sin depender del orden interno de claves de PostgreSQL', () => {
    expect(reviewIsCurrent({ act_snapshot: [{ name: 'Compraventa', id: 'a' }], document_snapshot: [{ size: 30, id: 'd' }] },
      [{ id: 'a', name: 'Compraventa' }], [{ id: 'd', size: 30 }])).toBe(true);
    expect(reviewIsCurrent({ act_snapshot: [{ id: 'a' }], document_snapshot: [{ id: 'd', checksum: 'old' }] },
      [{ id: 'a' }], [{ id: 'd', checksum: 'new' }])).toBe(false);
  });

  it('envía sólo las fuentes cargadas y acepta únicamente citas a sus IDs', async () => {
    const economicGateway = gateway({ summary: 'Revisión preliminar.', findings: [
      { detail: 'Verificar la fecha consignada.', document_ids: ['doc-1'] },
    ] });
    const result = await requestProspectDocumentReview({ actor, idempotencyKey: 'review-qa', traceId: 'trace-qa',
      acts: ['Protocolización de acta de asamblea'], configuredContext: [], documents: [document], gateway: economicGateway });
    expect(result.findings).toEqual([{ detail: 'Verificar la fecha consignada.', document_ids: ['doc-1'] }]);
    expect(economicGateway.execute).toHaveBeenCalledWith(expect.objectContaining({
      operationCode: 'PROSPECT_DOCUMENT_REVIEW', billingClass: 'CUSTOMER_WALLET', idempotencyKey: 'review-qa',
    }));
    const request = economicGateway.execute.mock.calls[0][0].payload.body;
    expect(JSON.stringify(request.input)).toContain('doc-1');
    expect(JSON.stringify(request.input)).toContain('La minuta consigna fecha');
    expect(request.store).toBe(false);
  });

  it('rechaza un hallazgo que cite documentos inexistentes sin guardar falso éxito', async () => {
    await expect(requestProspectDocumentReview({ actor, idempotencyKey: 'review-invalid', traceId: 'trace-invalid',
      acts: ['Compraventa'], configuredContext: [], documents: [document],
      gateway: gateway({ summary: 'Discrepancia.', findings: [
        { detail: 'Titular distinto.', document_ids: ['not-uploaded'] },
      ] }) })).rejects.toMatchObject({ code: 'PROSPECT_REVIEW_INVALID_OUTPUT', status: 503 });
  });

  it('falla cerrado cuando falta la clave de idempotencia', async () => {
    await expect(requestProspectDocumentReview({ actor, idempotencyKey: '', traceId: 'trace-missing',
      acts: ['Compraventa'], configuredContext: [], documents: [document], gateway: gateway({}) }))
      .rejects.toMatchObject({ code: 'AI_IDEMPOTENCY_CONTEXT_REQUIRED', status: 400 });
  });
});
