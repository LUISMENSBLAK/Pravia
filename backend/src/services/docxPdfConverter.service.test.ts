import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { convertDocxToPdf, DocumentConversionError } from './docxPdfConverter.service';
import { renderQuoteTemplate } from './quoteDocument.service';

const standardQuoteTemplate = () => {
  const archive = path.resolve(process.cwd(), 'resources/cfg002/PRAVIA_OS_CFG-002_Biblioteca_Estandar_v2_LEGAL.zip');
  const zip = new PizZip(readFileSync(archive));
  return zip.file('PRAVIA_OS_CFG-002_Biblioteca_Estandar_v2_LEGAL/NOTARIA/Formatos/Administrativos/ADM-001_Cotizacion_Servicios_Notariales.docx')!.asNodeBuffer();
};

describe('DOCX→PDF private converter', () => {
  it('rechaza un Word vacío y contenido activo antes de ejecutar el conversor', async () => {
    await expect(convertDocxToPdf(Buffer.alloc(0))).rejects.toMatchObject({ code: 'DOCX_SIZE_INVALID' });
    const unsafe = new PizZip(standardQuoteTemplate());
    unsafe.file('word/vbaProject.bin', Buffer.from('qa'));
    await expect(convertDocxToPdf(unsafe.generate({ type: 'nodebuffer' }))).rejects.toMatchObject({ code: 'DOCX_ACTIVE_CONTENT' });
  });

  it('rechaza relaciones externas del DOCX', async () => {
    const unsafe = new PizZip(standardQuoteTemplate());
    unsafe.file('word/_rels/document.xml.rels', '<Relationships><Relationship TargetMode="External" Target="https://example.test"/></Relationships>');
    await expect(convertDocxToPdf(unsafe.generate({ type: 'nodebuffer' }))).rejects.toMatchObject({ code: 'DOCX_EXTERNAL_RELATIONSHIP' });
  });

  it.skipIf(!process.env.PRAVIA_DOC_CONVERTER_BIN)('convierte ADM-001 real en PDF legible sin PDF genérico', async () => {
    const docx = renderQuoteTemplate(standardQuoteTemplate(), {
      'cotizacion.folio': 'COT-QA-0001-2026', 'cliente.nombre': 'CLIENTE SINTÉTICO',
    }, [{ concepto: 'HONORARIOS QA', categoria: 'HONORARIOS', importeCents: 10_000n },
      { concepto: 'IVA QA', categoria: 'IVA_HONORARIOS', importeCents: 1_600n }]);
    const pdf = await convertDocxToPdf(docx);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const parsed = await PDFDocument.load(pdf);
    expect(parsed.getPageCount()).toBeGreaterThan(0);
    expect(pdf.length).toBeGreaterThan(1_000);
  });

  it.skipIf(!process.env.PRAVIA_DOC_CONVERTER_BIN)('informa con código estable si el ejecutable no está disponible', async () => {
    const previous = process.env.PRAVIA_DOC_CONVERTER_BIN;
    process.env.PRAVIA_DOC_CONVERTER_BIN = '/ruta-qa-inexistente/soffice';
    try {
      await expect(convertDocxToPdf(standardQuoteTemplate())).rejects.toBeInstanceOf(DocumentConversionError);
      await expect(convertDocxToPdf(standardQuoteTemplate())).rejects.toMatchObject({ code: 'PDF_CONVERTER_UNAVAILABLE' });
    } finally { process.env.PRAVIA_DOC_CONVERTER_BIN = previous; }
  });
});
