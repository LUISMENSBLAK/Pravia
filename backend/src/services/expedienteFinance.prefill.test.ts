import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const ai = vi.hoisted(() => ({ extract: vi.fn(), usage: vi.fn(), failure: vi.fn() }));
vi.mock('./openaiDocument.service', () => ({
  extraerFinanzasDesdeDocumento: ai.extract,
  getOpenAIModelName: () => 'qa-document-model',
}));
vi.mock('./aiUsage.service', () => ({ recordAIUsage: ai.usage, recordAIFailure: ai.failure }));

import { ExpedienteFinanceService, nativeIncomeAmountValues, type ExpedienteFinanceActor } from './expedienteFinance.service';

const actor = {
  id: 'user-a', organizationId: 'org-a', rol: 'ABOGADO',
  permissions: ['expedientes.write', 'documentos.write', 'ia.execute'],
} as ExpedienteFinanceActor;
const file = { buffer: Buffer.from('%PDF-1.4\nqa\n'), originalname: 'comprobante.pdf', mimetype: 'application/pdf', size: 12 };
const usage = { modelo: 'qa-document-model', input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_tokens: 0, total_tokens: 15, duracion_ms: 100, documentos_enviados: 1, costo_estimado_usd: 0.001, precios_version: 'qa', escalamiento_utilizado: false };

describe('EXP-008 · prellenado temporal desde comprobante', () => {
  beforeEach(() => { vi.clearAllMocks(); ai.usage.mockResolvedValue(undefined); ai.failure.mockResolvedValue(undefined); });

  it('detecta importes distintos visibles en el PDF sin confundir fechas ni referencias', () => {
    expect(nativeIncomeAmountValues('Referencia 2026-10-06 · Subtotal: $10,000.00 MXN · IVA: $1,600.00 MXN · TOTAL PAGADO: $11,600.00 MXN'))
      .toEqual(['10000.00', '1600.00', '11600.00']);
  });

  it('suprime un subtotal aislado del proveedor cuando el PDF nativo muestra otros importes', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('Subtotal: $10,000.00 MXN', { x: 40, y: 700, size: 12, font });
    page.drawText('IVA: $1,600.00 MXN', { x: 40, y: 670, size: 12, font });
    page.drawText('TOTAL PAGADO: $11,600.00 MXN', { x: 40, y: 640, size: 12, font });
    const buffer = Buffer.from(await pdf.save());
    const db = { expediente: { findFirst: vi.fn().mockResolvedValue({ id: 'case-a' }) } };
    ai.extract.mockResolvedValueOnce({ campos: [{ campo: 'monto', valor: '10000.00', confianza: 'LECTURA_CLARA', fragmento: 'Subtotal: $10,000.00 MXN' }], conflictos: [], faltantes: [], uso: usage });
    const result = await new ExpedienteFinanceService(db as any).previewIncomeAI(actor, 'case-a', { buffer, originalname: 'multi.pdf', mimetype: 'application/pdf', size: buffer.length });
    expect(result.monto_reportado).toBeNull();
    expect(result.evidencia.some((item) => item.campo === 'monto')).toBe(false);
    expect(ai.extract).toHaveBeenCalledTimes(1);
    expect(ai.usage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ metadata: expect.objectContaining({ attempts: 1, outcome: 'CONFLICT_OR_CURRENCY', first_pass_reason: 'SOURCE_AMOUNT_CONFLICT', native_amounts_distinct: 3 }) }));
  });

  it('devuelve sólo sugerencias claras sin persistir ingreso, documento ni movimiento', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'case-a' });
    const db = { expediente: { findFirst } };
    ai.extract.mockResolvedValueOnce({
      campos: [
        { campo: 'monto', valor: '250.00', confianza: 'LECTURA_CLARA', pagina: 1, fragmento: '$250.00' },
        { campo: 'concepto', valor: 'Anticipo', confianza: 'LECTURA_CLARA', pagina: 1, fragmento: 'Anticipo' },
      ],
      conflictos: [], faltantes: [], uso: { modelo: 'qa-document-model' }, modelo: 'qa-document-model',
    });
    const result = await new ExpedienteFinanceService(db as any).previewIncomeAI(actor, 'case-a', file);
    expect(result).toMatchObject({ monto_reportado: '250.00', concepto_contexto: 'Anticipo' });
    expect(ai.extract).toHaveBeenCalledWith(expect.objectContaining({ buffer: file.buffer, mimeType: 'application/pdf', tipoDocumento: 'COMPROBANTE_INGRESO' }));
    expect(ai.usage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organizationId: 'org-a', expedienteId: 'case-a', operacion: 'EXP008_INCOME_PREFILL', metadata: expect.objectContaining({ persisted_finance: false }) }));
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organization_id: 'org-a', id: 'case-a' }) }));
    expect(Object.keys(db)).toEqual(['expediente']);
  });

  it('informa fallo del proveedor sin éxito simulado ni write financiero', async () => {
    const db = { expediente: { findFirst: vi.fn().mockResolvedValue({ id: 'case-a' }) } };
    ai.extract.mockRejectedValueOnce(new Error('Proveedor no disponible'));
    await expect(new ExpedienteFinanceService(db as any).previewIncomeAI(actor, 'case-a', file))
      .rejects.toMatchObject({ status: 502, code: 'EXP008_AI_PREFILL_FAILED' });
    expect(ai.failure).toHaveBeenCalledWith(expect.objectContaining({ operacion: 'EXP008_INCOME_PREFILL', organizationId: 'org-a', expedienteId: 'case-a' }));
    expect(ai.usage).not.toHaveBeenCalled();
    expect(Object.keys(db)).toEqual(['expediente']);
  });

  it('recupera una sola vez el monto vacío y contabiliza ambos intentos sin persistir finanzas', async () => {
    const db = { expediente: { findFirst: vi.fn().mockResolvedValue({ id: 'case-a' }) } };
    ai.extract.mockResolvedValueOnce({ campos: [], conflictos: [], faltantes: ['monto'], uso: usage })
      .mockResolvedValueOnce({ campos: [{ campo: 'monto', valor: '$ 123.45 MXN', confianza: 'LECTURA_CLARA', pagina: 1, fragmento: 'Total pagado $ 123.45 MXN' }], conflictos: [], faltantes: [], uso: usage });
    const result = await new ExpedienteFinanceService(db as any).previewIncomeAI(actor, 'case-a', file);
    expect(result.monto_reportado).toBe('123.45');
    expect(ai.extract).toHaveBeenCalledTimes(2);
    expect(ai.extract).toHaveBeenLastCalledWith(expect.anything(), 'EXP008', 'AMOUNT');
    expect(ai.usage).toHaveBeenCalledWith(expect.objectContaining({ input_tokens: 20, total_tokens: 30, documentos_enviados: 2 }), expect.objectContaining({ metadata: expect.objectContaining({ attempts: 2, recovery: 'RECOVERED', persisted_finance: false }) }));
    expect(Object.keys(db)).toEqual(['expediente']);
  });

  it('mantiene revisión manual si la segunda lectura discrepa de la primera', async () => {
    const db = { expediente: { findFirst: vi.fn().mockResolvedValue({ id: 'case-a' }) } };
    ai.extract.mockResolvedValueOnce({ campos: [{ campo: 'monto', valor: '100.00', confianza: 'LECTURA_DUDOSA' }], conflictos: [], faltantes: [], uso: usage })
      .mockResolvedValueOnce({ campos: [{ campo: 'monto', valor: '200.00', confianza: 'LECTURA_CLARA' }], conflictos: [], faltantes: [], uso: usage });
    const result = await new ExpedienteFinanceService(db as any).previewIncomeAI(actor, 'case-a', file);
    expect(result.monto_reportado).toBeNull();
    expect(ai.extract).toHaveBeenCalledTimes(2);
    expect(ai.usage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ metadata: expect.objectContaining({ attempts: 2, recovery: 'MANUAL_REVIEW', outcome: 'MANUAL_REVIEW' }) }));
  });

  it('no reintenta importes ambiguos ni moneda extranjera', async () => {
    const db = { expediente: { findFirst: vi.fn().mockResolvedValue({ id: 'case-a' }) } };
    ai.extract.mockResolvedValueOnce({ campos: [{ campo: 'monto', valor: '100.00', confianza: 'LECTURA_CLARA' }], conflictos: [{ campo: 'monto', detalle: 'También 200.00' }], faltantes: [], uso: usage })
      .mockResolvedValueOnce({ campos: [{ campo: 'monto', valor: '100.00', confianza: 'LECTURA_CLARA' }, { campo: 'moneda', valor: 'USD', confianza: 'LECTURA_CLARA' }], conflictos: [], faltantes: [], uso: usage });
    const service = new ExpedienteFinanceService(db as any);
    expect((await service.previewIncomeAI(actor, 'case-a', file)).monto_reportado).toBeNull();
    expect((await service.previewIncomeAI(actor, 'case-a', file)).monto_reportado).toBeNull();
    expect(ai.extract).toHaveBeenCalledTimes(2);
  });
});
