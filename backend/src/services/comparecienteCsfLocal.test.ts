import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extraerMultiplesDocumentos } from './openaiDocument.service';

async function syntheticPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const lines = [
    'CONSTANCIA DE SITUACION FISCAL - SINTETICA / SIN VALIDEZ FISCAL',
    'RFC: QAFA010101QA1', 'Nombre completo: PERSONA FISICA SINTETICA',
    'Codigo Postal: 63735', 'Domicilio Fiscal: CALLE DE PRUEBA 10',
    'Fecha de emision: 2026-10-26',
    'Regimen Fiscal: 901 REGIMEN SINTETICO A',
    'Regimen Fiscal: 902 REGIMEN SINTETICO B',
  ];
  lines.forEach((line, index) => page.drawText(line, { x: 30, y: 740 - index * 24, size: 12, font }));
  return Buffer.from(await pdf.save());
}

describe('Compareciente · CSF local compartible', () => {
  it('lee bytes reales, detecta los dos regímenes y no invoca AI Gateway ni wallet', async () => {
    const buffer = await syntheticPdf();
    let gatewayCalled = false;
    const result = await extraerMultiplesDocumentos([{
      buffer, mimeType: 'application/pdf', tipoDocumento: 'CONSTANCIA_FISCAL',
      documentoId: '11111111-1111-4111-8111-111111111111',
      nombreOriginal: 'CSF_SINTETICA_SIN_VALIDEZ_FISCAL.pdf',
    }], { actor: { userId: '22222222-2222-4222-8222-222222222222',
      organizationId: '33333333-3333-4333-8333-333333333333',
      membershipId: '44444444-4444-4444-8444-444444444444',
      role: 'ABOGADO', permissions: ['comparecientes.write', 'documentos.read'],
      scope: 'ORGANIZATION', sessionId: 'qa-session' } as any,
      idempotencyKey: 'local-csf-1', traceId: 'local-csf-1',
      gateway: { execute: async () => { gatewayCalled = true; throw new Error('Unexpected gateway'); } } as any,
    });
    expect(gatewayCalled).toBe(false);
    expect(result.proveedor).toBe('LOCAL_DETERMINISTIC');
    expect(result.campos).toEqual(expect.arrayContaining([expect.objectContaining({
      campo: 'rfc', valor: 'QAFA010101QA1', documento_id: '11111111-1111-4111-8111-111111111111',
    })]));
    expect(result.documentos_csf?.[0]?.regimenes_fiscales.map((item) => item.clave)).toEqual(['901', '902']);
    expect(result.documentos_csf?.[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.usos || []).toHaveLength(0);
  });
});
