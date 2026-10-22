import { describe, expect, it } from 'vitest';
import { analizarProyectoNotarialConOpenAI, PROJECT_REVIEW_AREAS, isRetryableProjectReviewError, isRetryableProjectReviewStatus, mapProjectReviewBatches, partitionProjectReviewDocuments, type DocumentoParaExtraccion } from './openaiDocument.service';

const document = (id: string, bytes: number): DocumentoParaExtraccion => ({
  buffer: Buffer.alloc(bytes),
  mimeType: 'application/pdf',
  tipoDocumento: 'FUENTE_PROYECTO',
  documentoId: id,
  nombreOriginal: `${id}.pdf`,
});

describe('EXP-010 · revisión documental grande por lotes', () => {
  it('asigna una subclave económica estable a cada lote revisado', async () => {
    const calls: any[] = [];
    const gateway = { execute: async (request: any) => {
      calls.push(request);
      return { status: 'completed', usage: { input_tokens: 5, output_tokens: 5, input_tokens_details: { cached_tokens: 0 } }, output: [{ content: [{
        type: 'output_text', text: JSON.stringify({ resumen_ejecutivo: 'QA', observaciones: [], areas_revision: PROJECT_REVIEW_AREAS.map((area) => ({
          area: area.id, etiqueta: area.label, estado: 'REVISADO_SIN_HALLAZGOS', resumen: 'Sin hallazgos.', hallazgos: 0,
        })) }),
      }] }] };
    } };
    const result = await analizarProyectoNotarialConOpenAI(document('project', 2), [document('a', 2), document('b', 2)], {}, undefined, {
      actor: { userId: 'user-qa', organizationId: 'org-qa', membershipId: 'membership-qa', role: 'DIRECCION', permissions: ['ai.use'], scope: 'GLOBAL', sessionId: 'session-qa' },
      idempotencyKey: 'review-qa', traceId: 'trace-review-qa', gateway,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ operationCode: 'PROJECT_LEGAL_REVIEW', billingClass: 'CUSTOMER_WALLET', idempotencyKey: 'review-qa:batch:1' });
    expect(result.areas_revision).toHaveLength(17);
  });

  it('conserva las 17 áreas contractuales en un orden estable y sin duplicados', () => {
    expect(PROJECT_REVIEW_AREAS).toHaveLength(17);
    expect(new Set(PROJECT_REVIEW_AREAS.map((item) => item.id)).size).toBe(17);
    expect(PROJECT_REVIEW_AREAS[0].id).toBe('RESIDUOS_MACHOTE');
    expect(PROJECT_REVIEW_AREAS[16].id).toBe('INSERTOS_LITERALES');
  });
  it('respeta simultáneamente el máximo de documentos y bytes sin omitir fuentes', () => {
    const sources = [document('a', 4), document('b', 4), document('c', 4), document('d', 2), document('e', 2)];
    const batches = partitionProjectReviewDocuments(sources, 3, 10);
    expect(batches.map((batch) => batch.map((item) => item.documentoId))).toEqual([
      ['a', 'b'],
      ['c', 'd', 'e'],
    ]);
    expect(batches.flat().map((item) => item.documentoId)).toEqual(sources.map((item) => item.documentoId));
  });

  it('conserva como lote individual un documento mayor al límite en vez de descartarlo', () => {
    const batches = partitionProjectReviewDocuments([document('large', 15), document('small', 2)], 4, 10);
    expect(batches.map((batch) => batch.map((item) => item.documentoId))).toEqual([['large'], ['small']]);
  });

  it('procesa lotes grandes con concurrencia acotada y conserva el orden original', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapProjectReviewBatches([0, 1, 2, 3, 4, 5], async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value % 2 ? 4 : 10));
      active -= 1;
      return `batch-${value}`;
    }, 3);

    expect(peak).toBe(3);
    expect(result).toEqual(['batch-0', 'batch-1', 'batch-2', 'batch-3', 'batch-4', 'batch-5']);
  });

  it('limita por defecto la revisión a tres solicitudes simultáneas', async () => {
    let active = 0;
    let peak = 0;
    await mapProjectReviewBatches([0, 1, 2, 3], async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });
    expect(peak).toBe(3);
  });

  it('reintenta sólo rate limits, timeouts y fallos transitorios del proveedor', () => {
    expect(isRetryableProjectReviewStatus(408)).toBe(true);
    expect(isRetryableProjectReviewStatus(429)).toBe(true);
    expect(isRetryableProjectReviewStatus(500)).toBe(true);
    expect(isRetryableProjectReviewStatus(520)).toBe(true);
    expect(isRetryableProjectReviewStatus(400)).toBe(false);
    expect(isRetryableProjectReviewStatus(401)).toBe(false);
    expect(isRetryableProjectReviewStatus(422)).toBe(false);
    expect(isRetryableProjectReviewError(new DOMException('agotó el tiempo', 'TimeoutError'))).toBe(true);
    expect(isRetryableProjectReviewError(new DOMException('abortado por timeout', 'AbortError'))).toBe(true);
    expect(isRetryableProjectReviewError(new TypeError('fetch failed: socket closed'))).toBe(true);
    expect(isRetryableProjectReviewError(new Error('JSON inválido'))).toBe(false);
  });
});
