import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { fiscalCsfSynthetic } from '../fixtures/fiscalCsf.synthetic';
import { FiscalDocumentExtractionService, parseFiscalCsfText } from './fiscalDocumentExtraction.service';

const extractor = new FiscalDocumentExtractionService();
async function pdf(text: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split('\n').forEach((line, index) => {
    page.drawText(line.replace(/—/g, '-'), { x: 32, y: 740 - index * 30, size: 13, font });
  });
  return Buffer.from(await doc.save());
}
function png(text: string, fontSize = 32) {
  const lines = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split('\n');
  const canvas = createCanvas(1500, Math.max(800, lines.length * 60 + 80));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000'; ctx.font = `${fontSize}px Arial`;
  lines.forEach((line, index) => ctx.fillText(line.replace(/—/g, '-'), 30, 70 + index * 60));
  return canvas.toBuffer('image/png');
}
const file = (buffer: Buffer, originalname: string, mimetype: string) => ({ buffer, originalname, mimetype, size: buffer.length });

describe('CSF sintéticas sin validez fiscal · extracción real', () => {
  it('lee etiquetas de CSF tabular sin inventar la clave SAT ausente', () => {
    const parsed = parseFiscalCsfText(`CONSTANCIA DE SITUACIÓN FISCAL
Lugar y Fecha de Emisión
LUGAR SINTÉTICO, 01 DE ENERO DE 2026
Datos de Identificación del Contribuyente:
RFC: QAFA010101QA1
CURP: QAAA010101HDFXXX01
Nombre (s): PERSONA
Primer Apellido: PRUEBA
Segundo Apellido: SINTETICA
Fecha inicio de operaciones: 01 de enero de 2025
Estatus en el padrón: ACTIVO
Datos del domicilio registrado
Código Postal: 63735 Tipo de Vialidad: CALLE
Nombre de Vialidad: PRUEBA Número Exterior: 12
Número Interior: A Nombre de la Colonia: CENTRO
Nombre de la Localidad: QA Nombre del Municipio o Demarcación Territorial: QA
Nombre de la Entidad Federativa: QA
Actividades Económicas:
Orden Actividad Económica Porcentaje Fecha Inicio Fecha Fin
1 ACTIVIDAD SINTETICA DE PRUEBA 100 01/01/2025
Regímenes:
Régimen Fecha Inicio Fecha Fin
Régimen de Prueba Sintética 01/01/2025`);
    expect(parsed).toMatchObject({ status: 'REVIEW_REQUIRED', nombre: 'PERSONA', apellido_paterno: 'PRUEBA',
      codigo_postal: '63735', domicilio_fiscal_estructurado: { tipo_vialidad: 'CALLE',
        nombre_vialidad: 'PRUEBA', numero_exterior: '12', numero_interior: 'A', colonia: 'CENTRO' },
      actividades_economicas: [{ orden: 1, descripcion: 'ACTIVIDAD SINTETICA DE PRUEBA', porcentaje: 100,
        fecha_inicio: '01/01/2025', fecha_fin: null }],
      regimenes_fiscales: [], regimenes_documentales: [{ descripcion: 'Régimen de Prueba Sintética',
        fecha_inicio: '01/01/2025', clave: null }] });
  });
  it('distingue persona física con un régimen y varios sin sobrescribirlos', () => {
    expect(parseFiscalCsfText(fiscalCsfSynthetic.physicalSingle)).toMatchObject({ rfc: 'QAFA010101QA1',
      regimenes_fiscales: [{ clave: '901' }], status: 'EXTRACTED' });
    expect(parseFiscalCsfText(fiscalCsfSynthetic.physicalMultiple)).toMatchObject({
      regimenes_fiscales: [{ clave: '901' }, { clave: '902' }], status: 'EXTRACTED',
    });
  });
  it('distingue persona moral, faltantes, contradicción y documento ajeno', () => {
    expect(parseFiscalCsfText(fiscalCsfSynthetic.company)).toMatchObject({ rfc: 'QAQ010101QA1',
      razon_social: 'EMPRESA SINTETICA QA', codigo_postal: '63736' });
    expect(parseFiscalCsfText(fiscalCsfSynthetic.missing)).toMatchObject({ status: 'PARTIALLY_EXTRACTED',
      codigo_postal: null, regimenes_fiscales: [] });
    expect(parseFiscalCsfText(fiscalCsfSynthetic.contradictory)).toMatchObject({ rfc: null,
      status: 'REVIEW_REQUIRED', conflicts: ['RFC contradictorios detectados'] });
    expect(() => parseFiscalCsfText(fiscalCsfSynthetic.notCsf)).toThrowError(expect.objectContaining({ code: 'CSF_DOCUMENT_NOT_RECOGNIZED' }));
  });
  it('lee un PDF binario sintético, no texto enviado por el cliente', async () => {
    const bytes = await pdf(fiscalCsfSynthetic.physicalMultiple);
    const result = await extractor.extract(file(bytes, 'CSF_SINTETICA_NO_OFICIAL.pdf', 'application/pdf'));
    expect(result).toMatchObject({ source: 'DETERMINISTIC_PDF_TEXT', rfc: 'QAFA010101QA1',
      regimenes_fiscales: [{ clave: '901' }, { clave: '902' }],
      source_pages: { rfc: 1, codigo_postal: 1 }, requiresReview: true });
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('conserva página de procedencia en una CSF sintética de dos páginas', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const first = doc.addPage([612, 792]);
    first.drawText('CONSTANCIA DE SITUACION FISCAL', { x: 32, y: 740, font, size: 13 });
    first.drawText('RFC: QAFA010101QA1', { x: 32, y: 710, font, size: 13 });
    first.drawText('Nombre completo: PERSONA SINTETICA QA', { x: 32, y: 680, font, size: 13 });
    const second = doc.addPage([612, 792]);
    second.drawText('Actividades Economicas:', { x: 32, y: 770, font, size: 13 });
    second.drawText('1 ACTIVIDAD SINTETICA 100 01/01/2025', { x: 32, y: 755, font, size: 13 });
    second.drawText('Regimenes:', { x: 32, y: 740, font, size: 13 });
    second.drawText('Regimen Fecha Inicio Fecha Fin', { x: 32, y: 710, font, size: 13 });
    second.drawText('Regimen Sintetico de Prueba 01/01/2025', { x: 32, y: 680, font, size: 13 });
    const bytes = Buffer.from(await doc.save());
    const result = await extractor.extract(file(bytes, 'CSF_DOS_PAGINAS_SINTETICA.pdf', 'application/pdf'));
    expect(result.source_pages.rfc).toBe(1);
    expect(result.source_pages.actividades_economicas).toEqual([{ descripcion: 'ACTIVIDAD SINTETICA', page: 2 }]);
    expect(result.source_pages.regimenes_documentales).toEqual([{ descripcion: 'Regimen Sintetico de Prueba', page: 2 }]);
    expect(result.status).toBe('REVIEW_REQUIRED');
  });
  it('ejecuta OCR local sobre imagen sintética legible', async () => {
    const bytes = png(fiscalCsfSynthetic.physicalSingle);
    const result = await extractor.extract(file(bytes, 'CSF_SINTETICA_NO_OFICIAL.png', 'image/png'));
    expect(result).toMatchObject({ source: 'LOCAL_OCR_IMAGE', rfc: 'QAFA010101QA1',
      codigo_postal: '63735', requiresReview: true });
  }, 30000);
  it('ejecuta OCR local sobre PDF escaneado sintético', async () => {
    const doc = await PDFDocument.create();
    const embedded = await doc.embedPng(png(fiscalCsfSynthetic.physicalSingle));
    const page = doc.addPage([1500, 800]);
    page.drawImage(embedded, { x: 0, y: 0, width: 1500, height: 800 });
    const bytes = Buffer.from(await doc.save());
    const result = await extractor.extract(file(bytes, 'CSF_ESCANEADA_SINTETICA.pdf', 'application/pdf'));
    expect(result).toMatchObject({ source: 'LOCAL_OCR_PDF', rfc: 'QAFA010101QA1', requiresReview: true });
  }, 30000);
  it('no inventa éxito cuando la imagen no permite lectura', async () => {
    const bytes = png(fiscalCsfSynthetic.physicalSingle, 2);
    await expect(extractor.extract(file(bytes, 'CSF_MALA_CALIDAD_SINTETICA.png', 'image/png')))
      .rejects.toMatchObject({ code: 'CSF_DOCUMENT_NOT_RECOGNIZED' });
  }, 30000);
  it('informa un PDF corrupto sin exponer detalles internos del parser', async () => {
    const bytes = Buffer.from('%PDF-1.7\nPDF SINTÉTICO CORRUPTO');
    await expect(extractor.extract(file(bytes, 'CSF_CORRUPTA_SINTETICA.pdf', 'application/pdf')))
      .rejects.toMatchObject({ code: 'CSF_PDF_UNREADABLE', status: 422 });
  });
});
