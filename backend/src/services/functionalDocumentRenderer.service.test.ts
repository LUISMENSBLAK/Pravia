import { Document, Packer, Paragraph } from 'docx';
import { PDFDocument } from 'pdf-lib';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { DOCX_MIME, PDF_MIME, renderFunctionalDocumentBuffer } from './functionalDocumentRenderer.service';

describe('CFG-002 · render operativo desde el archivo exacto', () => {
  it('conserva el testigo del DOCX seleccionado y sustituye variables estructuradas', async () => {
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph('PLANTILLA TESTIGO B'),
      new Paragraph('Folio: {{isr.folio}}'),
      new Paragraph('Resultado: {{isr.resultado}}'),
    ] }] }));
    const rendered = await renderFunctionalDocumentBuffer(source, DOCX_MIME, { 'isr.folio': 'ISR-0001-2026', 'isr.resultado': '1,234.56' });
    const xml = new PizZip(rendered.buffer).file('word/document.xml')!.asText();
    expect(rendered.mimeType).toBe(DOCX_MIME);
    expect(xml).toContain('PLANTILLA TESTIGO B');
    expect(xml).toContain('ISR-0001-2026');
    expect(xml).toContain('1,234.56');
    expect(xml).not.toContain('{{isr.folio}}');
  });

  it('usa el PDF configurado como base y anexa datos cuando no tiene AcroForm', async () => {
    const template = await PDFDocument.create();
    template.addPage([300, 300]);
    const source = Buffer.from(await template.save());
    const rendered = await renderFunctionalDocumentBuffer(source, PDF_MIME, { 'solicitud.concepto': 'Derechos RPP' });
    const result = await PDFDocument.load(rendered.buffer);
    expect(rendered.mimeType).toBe(PDF_MIME);
    expect(result.getPageCount()).toBe(2);
  });

  it('rechaza archivos que no sean DOCX o PDF en puntos generadores', async () => {
    await expect(renderFunctionalDocumentBuffer(Buffer.from('texto'), 'text/plain', {})).rejects.toMatchObject({ code: 'FUNCTIONAL_TEMPLATE_TYPE_UNSUPPORTED' });
  });
});
