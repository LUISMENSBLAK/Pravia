import { Document, Packer, Paragraph } from 'docx';
import { PDFDocument } from 'pdf-lib';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { DOCX_MIME, PDF_MIME, renderFunctionalDocumentBuffer } from './functionalDocumentRenderer.service';

describe('CFG-002 · render operativo desde el archivo exacto', () => {
  it('requires explicit variables in strict mode and preserves package styles and fixed text',async()=>{
    const source=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('SINTÉTICO · TEXTO FIJO'),new Paragraph('{{nombre}}'),new Paragraph('{{faltante}}')]}]}));
    const result=await renderFunctionalDocumentBuffer(source,DOCX_MIME,{nombre:'QA confirmado',faltante:null},undefined,{strictMapping:true});
    const zip=new PizZip(result.buffer),original=new PizZip(source);
    expect(zip.file('word/styles.xml')?.asText()).toBe(original.file('word/styles.xml')?.asText());
    expect(zip.file('word/document.xml')?.asText()).toContain('SINTÉTICO · TEXTO FIJO');
    expect(zip.file('word/document.xml')?.asText()).toContain('QA confirmado');
    expect(zip.file('word/document.xml')?.asText()).toContain('[PENDIENTE: DATO NO DISPONIBLE]');
    const plain=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('*** sin mapeo')]}]}));
    await expect(renderFunctionalDocumentBuffer(plain,DOCX_MIME,{nombre:'QA'},undefined,{strictMapping:true})).rejects.toMatchObject({code:'FUNCTIONAL_TEMPLATE_MAPPING_REQUIRED'});
    const pdf=await PDFDocument.create();pdf.addPage();
    await expect(renderFunctionalDocumentBuffer(Buffer.from(await pdf.save()),PDF_MIME,{nombre:'QA'},undefined,{strictMapping:true})).rejects.toMatchObject({code:'FUNCTIONAL_TEMPLATE_MAPPING_REQUIRED'});
  });
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
