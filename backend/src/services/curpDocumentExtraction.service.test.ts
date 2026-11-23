import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractCurpPdf } from './curpDocumentExtraction.service';
import { extraerMultiplesDocumentos } from './openaiDocument.service';
import { PlatformDomainError } from '../platform/platform.errors';

async function syntheticCurpPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const draw = (value: string, x: number, y: number) => page.drawText(value, { x, y, font, size: 10 });
  draw('Clave Unica de Registro de Poblacion - SINTETICO / SIN VALIDEZ', 20, 740);
  draw('Clave:', 170, 660);
  draw('GARA900101HDFRBC09', 170, 642);
  draw('Nombre', 170, 615);
  draw('PERSONA DE PRUEBA', 170, 596);
  draw('Fecha de inscripcion', 150, 545);
  draw('05/02/2026', 150, 529);
  draw('Folio', 290, 545);
  draw('12345678', 290, 529);
  draw('Entidad de registro', 380, 545);
  draw('NAYARIT', 380, 529);
  draw('CURP Certificada: verificada con el Registro Civil', 325, 480);
  return Buffer.from(await pdf.save());
}

describe('extracción determinística CURP PDF', () => {
  it('conserva la lectura local real y declara el análisis parcial si falla la IA de otro documento', async () => {
    const execute = vi.fn().mockRejectedValue(new PlatformDomainError('AI_EXTERNAL_DISABLED', 'IA deshabilitada en este entorno.', 503));
    const result = await extraerMultiplesDocumentos([
      { buffer: await syntheticCurpPdf(), mimeType: 'application/pdf', tipoDocumento: 'CURP', documentoId: 'curp-qa', nombreOriginal: 'CURP_SINTETICA.pdf' },
      { buffer: Buffer.from('synthetic image'), mimeType: 'image/png', tipoDocumento: 'IDENTIFICACION', documentoId: 'ine-qa', nombreOriginal: 'INE_SINTETICA.png' },
    ], { actor: { userId: 'user-qa', organizationId: 'org-qa', membershipId: 'membership-qa', role: 'ABOGADO', permissions: ['ia.execute'], scope: 'ASSIGNED_OBJECTS', sessionId: 'session-qa' }, idempotencyKey: 'partial-qa', traceId: 'partial-qa', gateway: { execute } });
    expect(execute).toHaveBeenCalled(); expect(result.campos).toMatchObject([{ campo: 'curp', valor: 'GARA900101HDFRBC09' }]);
    expect(result.alertas.join(' ')).toContain('Extracción parcial'); expect(result.alertas.join(' ')).toContain('INE_SINTETICA.png');
    expect(result.errores).toMatchObject([{ documento_id: 'ine-qa', nombre: 'INE_SINTETICA.png', code: 'AI_EXTERNAL_DISABLED', error: 'IA deshabilitada en este entorno.' }]);
    expect(result.campos.some(field => field.documento_id === 'ine-qa')).toBe(false);
  });
  it('no anuncia éxito cuando todas las fuentes requieren un proveedor que falla', async () => {
    const failure = Object.assign(new Error('provider unavailable'), { code: 'AI_EXTERNAL_DISABLED' });
    await expect(extraerMultiplesDocumentos([{ buffer: Buffer.from('synthetic image'), mimeType: 'image/png', tipoDocumento: 'IDENTIFICACION', documentoId: 'ine-qa', nombreOriginal: 'INE_SINTETICA.png' }], {
      actor: { userId: 'user-qa', organizationId: 'org-qa', membershipId: 'membership-qa', role: 'ABOGADO', permissions: ['ia.execute'], scope: 'ASSIGNED_OBJECTS', sessionId: 'session-qa' }, idempotencyKey: 'failed-qa', traceId: 'failed-qa', gateway: { execute: vi.fn().mockRejectedValue(failure) },
    })).rejects.toBe(failure);
  });
  it('lee valores etiquetados por posición sin inventar apellidos ni fecha de emisión', async () => {
    const bytes = await syntheticCurpPdf();
    const result = await extractCurpPdf(bytes, 'documento-sintetico');
    expect(result.status).toBe('REVIEW_REQUIRED');
    expect(result.fields.curp).toMatchObject({ normalized: 'GARA900101HDFRBC09', page: 1,
      document_id: 'documento-sintetico', method: 'DETERMINISTIC_PDF_TEXT' });
    expect(result.fields.nombre_literal?.literal).toBe('PERSONA DE PRUEBA');
    expect(result.fields.fecha_inscripcion?.normalized).toBe('2026-02-05');
    expect(result.fields.folio_documental?.literal).toBe('12345678');
    expect(result.fields.entidad_registro?.literal).toBe('NAYARIT');
    expect(result.fields.certificacion_literal?.literal).toContain('Registro Civil');
    expect(result.fields.apellido_paterno).toBeNull();
    expect(result.fields.apellido_materno).toBeNull();
    expect(result.fields.fecha_emision).toBeNull();
    expect(result.warnings).toContain('NO_VALIDADO_CON_RENAPO');
  });

  it('rechaza documento no CURP y PDF corrupto sin publicar texto privado', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    page.drawText('DOCUMENTO SINTETICO NO CURP');
    await expect(extractCurpPdf(Buffer.from(await pdf.save()), 'otro'))
      .rejects.toMatchObject({ code: 'CURP_DOCUMENT_NOT_RECOGNIZED' });
    await expect(extractCurpPdf(Buffer.from('%PDF-archivo-truncado'), 'otro'))
      .rejects.toMatchObject({ code: 'CURP_PDF_UNREADABLE' });
  });

  it('integra CURP en propuestas de Comparecientes sin llamar al AI Gateway', async () => {
    const execute = vi.fn();
    const result = await extraerMultiplesDocumentos([{
      buffer: await syntheticCurpPdf(), mimeType: 'application/pdf',
      tipoDocumento: 'CURP', documentoId: 'doc-curp-qa', nombreOriginal: 'CURP_SINTETICA.pdf',
    }], { actor: { userId: 'user-qa', organizationId: 'org-qa', membershipId: 'membership-qa',
      role: 'ABOGADO', permissions: ['ia.execute'], scope: 'ASSIGNED_OBJECTS', sessionId: 'session-qa' },
    idempotencyKey: 'curp-local-qa', traceId: 'curp-local-qa', gateway: { execute } });
    expect(execute).not.toHaveBeenCalled();
    expect(result.proveedor).toBe('LOCAL_DETERMINISTIC');
    expect(result.uso).toBeUndefined();
    expect(result.campos).toMatchObject([{ campo: 'curp', valor: 'GARA900101HDFRBC09',
      pagina: 1, documento_id: 'doc-curp-qa' }]);
    expect(result.documentos_curp?.[0]?.fields.folio_documental?.literal).toBe('12345678');
    expect(result.documentos_curp?.[0]?.fields.apellido_paterno).toBeNull();
  });
});
