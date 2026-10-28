import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractPresupuestoData } from './claude.service';

describe('extracción determinística de presupuesto', () => {
  it('rechaza PDF sin texto sin fingir que el binario es texto extraído', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 300]);
    const result = await extractPresupuestoData(Buffer.from(await pdf.save()), 'qa-sintetico.pdf');
    expect(result.error).toBe('PDF_TEXT_UNAVAILABLE');
    expect(result.rubros).toEqual([]);
    expect(result.suma_valida).toBe(false);
    expect(result.mensaje_validacion).toMatch(/revisa el archivo manualmente/i);
  });
});
