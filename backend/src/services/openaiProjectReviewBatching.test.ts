import { describe, expect, it } from 'vitest';
import { PROJECT_REVIEW_AREAS, isRetryableProjectReviewError, isRetryableProjectReviewStatus, mapProjectReviewBatches, partitionProjectReviewDocuments, type DocumentoParaExtraccion } from './openaiDocument.service';

const document = (id: string, bytes: number): DocumentoParaExtraccion => ({
  buffer: Buffer.alloc(bytes),
  mimeType: 'application/pdf',
  tipoDocumento: 'FUENTE_PROYECTO',
  documentoId: id,
  nombreOriginal: `${id}.pdf`,
});

describe('EXP-010 · revisión documental grande por lotes', () => {
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
