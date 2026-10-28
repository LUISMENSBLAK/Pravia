import { describe, expect, it } from 'vitest';
import { PDFParse } from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';
import { renderPrefacturaPdf, type PrefacturaSnapshot } from './prefacturaPdf';

const example: PrefacturaSnapshot = {
  folio: 'FAC-BOR-000021', version: 1, generated_at: '2026-10-26T09:00:00.000Z',
  emitter: { name: 'EMISOR QA', rfc: 'AAA010101AAA', regimen: '601', postal_code: '63735' },
  receiver: { name: 'RECEPTOR QA', rfc: 'BBB010101BBB', regimen: '612', postal_code: '63736', uso_cfdi: 'G03' },
  currency: 'MXN', exchange_rate: null, equivalent_mxn: null,
  payment: { method: 'PPD', form: '99', terms: 'Pago diferido' }, export_code: '01', issue_place: '63735',
  concepts: [{ description: 'Honorarios de prueba', product_code: '80121700', unit_code: 'E48', quantity: '1', unit_price: '8000.00', subtotal: '8000.00', transferred: '0.00', retained: '0.00', total: '8000.00' }],
  amounts: { subtotal: '8000.00', transferred: '0.00', retained: '0.00', total: '8000.00' },
};

describe('prefactura PDF binaria', () => {
  it('produce páginas PDF con snapshot, folio, importes y leyenda no fiscal', async () => {
    const bytes = await renderPrefacturaPdf(example);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
    const parser = new PDFParse({ data: bytes });
    try {
      const content = (await parser.getText()).text;
      expect(content).toContain('FAC-BOR-000021');
      expect(content).toContain('PREFACTURA');
      expect(content).toContain('DOCUMENTO SIN VALIDEZ FISCAL');
      expect(content).toContain('AAA010101AAA');
      expect(content).toContain('BBB010101BBB');
      expect(content).toContain('Honorarios de prueba');
      expect(content).toContain('8,000.00 MXN');
      expect(content).not.toContain('UUID:');
    } finally { await parser.destroy(); }
  });

  it('reproduce el cambio de moneda y versión desde el snapshot fijado', async () => {
    const bytes = await renderPrefacturaPdf({ ...example, version: 2, currency: 'USD', exchange_rate: '17.100000', equivalent_mxn: '136800.00' });
    const parser = new PDFParse({ data: bytes });
    try {
      const content = (await parser.getText()).text;
      expect(content).toContain('v2');
      expect(content).toContain('USD');
      expect(content).toContain('17.100000');
      expect(content).toContain('136,800.00 MXN');
    } finally { await parser.destroy(); }
  });
});
