import { describe, expect, it } from 'vitest';
import { buildQuoteAnalytics, parseQuoteListQuery } from './quoteQuery';

describe('quote query', () => {
  it('normaliza paginación, filtros y sort con whitelist', () => {
    const result = parseQuoteListQuery({ page: '3', pageSize: '500', estado: 'ENVIADA_CLIENTE,NOPE', sort: 'total_cliente:asc', acto: 'Hipoteca' });
    expect(result).toMatchObject({ paginated: true, page: 3, pageSize: 100, skip: 200, states: ['ENVIADA_CLIENTE'], sortBy: 'total_cliente', sortOrder: 'asc', act: 'Hipoteca' });
  });

  it('conserva la respuesta legacy si no se solicita página', () => {
    expect(parseQuoteListQuery({ estado: 'BORRADOR' }).paginated).toBe(false);
  });

  it('agrupa cohortes reales de envío y aceptación sin superar 100%', () => {
    const analytics = buildQuoteAnalytics([
      { fecha_enviada_cliente: new Date('2026-08-01T10:00:00Z'), fecha_aceptacion_cliente: new Date('2026-08-05T10:00:00Z'), total_cliente: '1200' },
      { fecha_enviada_cliente: new Date('2026-08-02T10:00:00Z'), fecha_aceptacion_cliente: null, total_cliente: 800 },
    ], '6m', new Date('2026-08-12T12:00:00Z'));
    expect(analytics.at(-1)).toMatchObject({ key: '2026-08', sentCount: 2, acceptedCount: 1, sentAmount: 2000, acceptedAmount: 1200, rate: 50 });
  });
});
