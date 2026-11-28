import { describe, expect, it } from 'vitest';
import { legalReviewForQuote } from './quoteLegalReview';

const territory = { state:'NAYARIT', jurisdiction:'NAYARIT', municipality:'Bahía de Banderas', confirmedById:'qa', confirmedAt:'2026-11-25' };
describe('Derechos e impuestos en compraventa', () => {
  it('para Nayarit 2026 calcula sólo referencia registral estatal, no un ISABI ni un cargo', () => {
    expect(legalReviewForQuote('Compraventa de inmueble',territory,'2026-11-27',true)).toEqual([
      expect.objectContaining({category:'Derecho estatal de inscripción',amount:'15461.46',status:'REFERENCIA NO INCLUIDA EN EL TOTAL',article:'Art. 18, apartado A, fracción I'}),
      expect.objectContaining({category:expect.stringContaining('ISABI'),status:'FUNDAMENTO IDENTIFICADO · IMPORTE PENDIENTE',article:'Ley de Ingresos municipal 2026, art. 21',message:expect.stringContaining('0.50%')}),
    ]);
  });
  it('no extrapola el importe a otra fecha, estado, municipio desconocido para ISABI, ni una embarcación', () => {
    expect(legalReviewForQuote('Compraventa de inmueble',territory,'2027-01-01',true)[0]).not.toHaveProperty('amount');
    expect(legalReviewForQuote('Compraventa',{ ...territory,state:'JALISCO' },'2026-11-27',true)[0]).not.toHaveProperty('amount');
    expect(legalReviewForQuote('Compraventa',{ ...territory,municipality:null },'2026-11-27',true)[1].message).toContain('Falta municipio');
    expect(legalReviewForQuote('Compraventa de embarcación',territory,'2026-11-27',true)).toEqual([]);
    expect(legalReviewForQuote('Compraventa',territory,'2026-11-27',false)[0]).not.toHaveProperty('amount');
  });
});
