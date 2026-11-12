import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { extractCurpImage, extractCurpPdf } from './curpDocumentExtraction.service';
import { extractIdentityImageWithLocalOcr, extractIdentityPdfWithLocalOcr } from './identityDocumentOcr.service';
import { extraerMultiplesDocumentos } from './openaiDocument.service';

async function scannedPdf(lines: string[]) {
  const canvas = createCanvas(1224, 1584);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 1224, 1584);
  context.fillStyle = '#000';
  context.font = '34px sans-serif';
  lines.forEach((line, index) => context.fillText(line, 72, 120 + 72 * index));
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const image = await pdf.embedPng(canvas.toBuffer('image/png'));
  page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  return Buffer.from(await pdf.save());
}

const curp = 'GARA900101HDFRBC77';
const scanLabel = 'SINTETICO - SIN VALIDEZ OFICIAL';
describe('OCR local de identificaciones', () => {
  it('lee una CURP de un PDF rasterizado con fuente, página y confirmación pendiente', async () => {
    const pdf = await scannedPdf([scanLabel, 'Clave Unica de Registro de Poblacion', 'Clave:', curp]);
    const result = await extractCurpPdf(pdf, 'curp-qa');
    expect(result).toMatchObject({ source: 'LOCAL_OCR_PDF', requires_human_confirmation: true,
      fields: { curp: { normalized: curp, page: 1, document_id: 'curp-qa', block: null, status: 'DETECTED_UNCONFIRMED' } } });
  }, 25_000);

  it('deja para revisión la CURP si no puede distinguir 0 de O en la posición variable', async () => {
    const pdf = await scannedPdf([scanLabel, 'Clave Unica de Registro de Poblacion', 'Clave:', 'GARA900101HDFRBC09']);
    const result = await extractCurpPdf(pdf, 'curp-ambiguo-qa');
    expect(result.fields.curp).toBeNull();
    expect(result.warnings).toContain('CURP_CARACTER_AMBIGUO');
  }, 25_000);

  it('omite un valor ambiguo de identificación en vez de elegirlo', async () => {
    const pdf = await scannedPdf([scanLabel, 'Credencial para votar', 'CIC: 123456789', 'CIC: 987654321', 'OCR: 1234567890123']);
    const result = await extractIdentityPdfWithLocalOcr(pdf, 'ine-qa', 'INE');
    expect(result).toMatchObject({ recognized: true, method: 'LOCAL_OCR_PDF', status: 'REVIEW_REQUIRED',
      identificadores_ine: { ocr: '1234567890123' }, fields: [] });
    expect(result.identificadores_ine.cic).toBeUndefined();
  }, 25_000);

  it('no atribuye un identificador a una foto sin la cabecera correspondiente', async () => {
    const canvas = createCanvas(1200, 500);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#eee7da'; ctx.fillRect(0, 0, 1200, 500);
    ctx.font = '40px sans-serif'; ctx.fillStyle = '#333';
    ctx.fillText(scanLabel, 60, 90);
    ctx.fillText(curp, 60, 160);
    const photo = canvas.toBuffer('image/jpeg', 75);
    await expect(extractCurpImage(photo, 'foto-no-curp', 'image/jpeg')).rejects.toMatchObject({ code: 'CURP_DOCUMENT_NOT_RECOGNIZED' });
    const ine = await extractIdentityImageWithLocalOcr(photo, 'foto-no-ine', 'INE', 'image/jpeg');
    expect(ine).toMatchObject({ recognized: false, method: 'LOCAL_OCR_IMAGE', fields: [], status: 'REVIEW_REQUIRED' });
    expect(ine.identificadores_ine.cic).toBeUndefined();
    expect(ine.identificadores_ine.ocr).toBeUndefined();
  }, 25_000);

  it('rechaza dimensiones excesivas y tipo declarado incorrecto antes de iniciar OCR', async () => {
    const png = createCanvas(6010, 20).toBuffer('image/png');
    await expect(extractIdentityImageWithLocalOcr(png, 'foto-grande', 'INE', 'image/png')).rejects.toThrow('IDENTITY_OCR_IMAGE_DIMENSIONS');
    await expect(extractIdentityImageWithLocalOcr(png, 'tipo-incorrecto', 'INE', 'image/jpeg')).rejects.toThrow('IDENTITY_OCR_IMAGE_DIMENSIONS');
  });

  it('conserva la extracción de la CSF válida cuando una CURP del mismo lote no se identifica', async () => {
    const execute = vi.fn();
    const pdf = await scannedPdf([scanLabel, 'Constancia de Situacion Fiscal', 'RFC: QAFA010101QA1',
      'Nombre completo: PERSONA SINTETICA', 'Codigo Postal: 63735', 'Domicilio Fiscal: CALLE DE PRUEBA']);
    const invalid = await scannedPdf([scanLabel, 'OTRO DOCUMENTO SIN IDENTIDAD', curp]);
    const result = await extraerMultiplesDocumentos([
      { buffer: invalid, mimeType: 'application/pdf', tipoDocumento: 'CURP', documentoId: 'curp', nombreOriginal: 'curp-qa.pdf' },
      { buffer: pdf, mimeType: 'application/pdf', tipoDocumento: 'CONSTANCIA_FISCAL', documentoId: 'csf', nombreOriginal: 'csf-qa.pdf' },
    ], { actor: { userId: 'user-qa', organizationId: 'org-qa', membershipId: 'member-qa',
      role: 'ABOGADO', permissions: ['ia.execute'], scope: 'ASSIGNED_OBJECTS', sessionId: 'session-qa' },
      idempotencyKey: 'ocr-local', traceId: 'ocr-local', gateway: { execute } });
    expect(execute).not.toHaveBeenCalled();
    expect(result.campos).toEqual([expect.objectContaining({ campo: 'rfc', valor: 'QAFA010101QA1', documento_id: 'csf' })]);
    expect(result.alertas).toContain('El escaneo no se pudo identificar como constancia CURP.');
    expect(result.documentos_csf?.[0].source).toBe('LOCAL_OCR_PDF');
  }, 30_000);
});
