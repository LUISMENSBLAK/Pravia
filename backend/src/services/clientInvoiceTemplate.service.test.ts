import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { convertDocxToPdf } from './docxPdfConverter.service';
import { renderClientPrefacturaDocx, validateFiscalLogoImage } from './clientInvoiceTemplate.service';
import type { PrefacturaSnapshot } from '../domain/prefacturaPdf';

const snapshot: PrefacturaSnapshot = {
  folio: 'FAC-BOR-QA-0001', version: 1, generated_at: '2026-11-03T10:00:00.000Z',
  emitter: { name: 'NOTARÍA SINTÉTICA QA', rfc: 'AAA010101AAA', regimen: '601', postal_code: '63000' },
  receiver: { name: 'CLIENTE SINTÉTICO QA', rfc: 'BBBB010101AAA', regimen: '601', postal_code: '63000', uso_cfdi: 'G03' },
  currency: 'MXN', exchange_rate: null, equivalent_mxn: null,
  payment: { method: 'PUE', form: '03', terms: null }, export_code: '01', issue_place: '63000',
  concepts: [{ description: 'HONORARIOS SINTÉTICOS DE PRUEBA', product_code: '84111506', unit_code: 'E48',
    quantity: '1', unit_price: '100.00', subtotal: '100.00', transferred: '16.00', retained: '0.00', total: '116.00', tax_object: '02' }],
  amounts: { subtotal: '100.00', transferred: '16.00', retained: '0.00', total: '116.00' },
};

describe('Factura_PRAVIA.docx original → prefactura segura', () => {
  it.each([1, 2, 5, 20])('preserva el machote, repite %i conceptos y omite el falso timbrado', async (count) => {
    const input = { ...snapshot, concepts: Array.from({ length: count }, (_, index) => ({
      ...snapshot.concepts[0], description: `LÍNEA SINTÉTICA ${index + 1} ` + 'DESCRIPCIÓN LARGA '.repeat(8),
    })) };
    const { bytes, templateSha256 } = await renderClientPrefacturaDocx(input);
    const zip = new PizZip(bytes);
    const xml = zip.file('word/document.xml')!.asText();
    const sourceXml = new PizZip(await (await import('node:fs/promises')).readFile(new URL('../../assets/fiscal/Factura_PRAVIA.docx', import.meta.url))).file('word/document.xml')!.asText();
    // The original contains 18 tables. Prefacturas intentionally omit its
    // single-concept detail and five certification/QR tables, retaining 12.
    expect((sourceXml.match(/<w:tbl>/g) || []).length).toBe(18);
    expect((xml.match(/<w:tbl>/g) || []).length).toBe(12);
    expect(templateSha256).toBe('93c7eeac20182e9c75cf21561089dc65becbd1fee037e156af1549bec3e0f9b3');
    expect(zip.file('docProps/core.xml')!.asText()).not.toMatch(/<(?:dc:creator|cp:lastModifiedBy)>[^<]+/);
    expect(xml).toContain('PREFACTURA — SIN VALIDEZ FISCAL');
    expect(xml).toContain('NOTARÍA SINTÉTICA QA');
    expect(xml).toContain('03/11/2026');
    expect(xml).toContain('UTC');
    expect(xml).not.toContain('DOMICILIO / SUCURSAL');
    expect(xml).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
    expect(xml).not.toContain('SELLO DIGITAL DEL SAT');
    expect(xml).not.toContain('TIMBRADO Y VALIDACIÓN SAT');
    expect(xml).not.toContain('ESTE DOCUMENTO ES UNA REPRESENTACIÓN IMPRESA');
    expect((xml.match(/LÍNEA SINTÉTICA/g) || []).length).toBe(count);
    expect(xml).not.toContain('r:embed="rId9"');
    expect(xml).not.toContain('r:embed="rId10"');
    expect(zip.file('word/media/image1.png')).toBeNull();
    expect(zip.file('word/media/image2.png')).toBeNull();
  });

  it.skipIf(!process.env.PRAVIA_DOC_CONVERTER_BIN)('convierte físicamente el machote procesado a PDF legible', async () => {
    const { bytes } = await renderClientPrefacturaDocx(snapshot);
    const pdf = await convertDocxToPdf(bytes);
    const parsed = await PDFDocument.load(pdf);
    expect(parsed.getPageCount()).toBeGreaterThan(0);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const extracted = new (await import('pdf-parse')).PDFParse({ data: pdf });
    try {
      const content = (await extracted.getText()).text;
      expect(content).toContain('NOMBRE O RAZÓN SOCIAL NOTARÍA SINTÉTICA QA');
      expect(content).toContain(snapshot.emitter.rfc);
      expect(content).toContain(snapshot.receiver.rfc);
      expect(content).toContain(snapshot.receiver.postal_code);
      expect(content).toContain(snapshot.concepts[0].product_code);
      expect(content).toContain('RÉGIMEN FISCAL');
    } finally { await extracted.destroy(); }
  });

  it.skipIf(!process.env.PRAVIA_DOC_CONVERTER_BIN).each([5, 12])('conserva la última línea y los totales juntos con 20 conceptos de longitud %i', async (length) => {
    const longSnapshot = { ...snapshot, concepts: Array.from({ length: 20 }, (_, index) => ({
      ...snapshot.concepts[0], description: `LÍNEA SINTÉTICA ${index + 1} ` + 'TEXTO JURÍDICO DE PRUEBA '.repeat(length),
    })) };
    const { bytes } = await renderClientPrefacturaDocx(longSnapshot);
    const pdf = await convertDocxToPdf(bytes);
    const parsed = await PDFDocument.load(pdf);
    expect(parsed.getPageCount()).toBeGreaterThan(1);
    const extracted = new (await import('pdf-parse')).PDFParse({ data: pdf });
    try {
      const content = (await extracted.getText()).text;
      expect(content).toContain('LÍNEA SINTÉTICA 1');
      expect(content).toContain('LÍNEA SINTÉTICA 20');
    } finally { await extracted.destroy(); }
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const document = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
    const finalPage = await document.getPage(document.numPages);
    const lastPageText = (await finalPage.getTextContent()).items.map((item) => 'str' in item ? item.str : '').join(' ');
    expect(lastPageText).toContain('LÍNEA SINTÉTICA 20');
    expect(lastPageText).toContain(snapshot.amounts.total);
  });

  it('sustituye sólo la imagen de cabecera por un logotipo QA válido', async () => {
    const canvas = createCanvas(64, 64);
    const context = canvas.getContext('2d');
    context.fillStyle = '#163a5b'; context.fillRect(0, 0, 64, 64);
    const logo = await canvas.encode('png');
    expect(await validateFiscalLogoImage(logo, 'image/png')).toEqual({ width: 64, height: 64 });
    const { bytes } = await renderClientPrefacturaDocx(snapshot, { bytes: logo, mimeType: 'image/png' });
    const zip = new PizZip(bytes);
    expect(zip.file('word/document.xml')!.asText()).toContain('r:embed="rId9"');
    expect(zip.file('word/media/image2.png')).toBeNull();
    expect(zip.file('word/media/image1.png')!.asNodeBuffer().equals(logo)).toBe(false);
    expect(zip.file('word/media/image1.png')!.asNodeBuffer().length).toBeGreaterThan(100);
  });

  it('rechaza imágenes inválidas en vez de emitir un PDF con un logo falso', async () => {
    await expect(validateFiscalLogoImage(Buffer.from('not-an-image'), 'image/png'))
      .rejects.toMatchObject({ code: 'INVOICE_LOGO_INVALID' });
  });
});
