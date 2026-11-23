import { describe, expect, it } from 'vitest';
import { parseQuotePropertyValues, quotePropertyValuesPayload } from './quotePropertyValues';

describe('Cotización · cuatro datos inmobiliarios opcionales separados', () => {
  it('preserva omisiones, permite borrar y distingue cero explícito de información ausente', () => {
    expect(parseQuotePropertyValues({})).toEqual({});
    expect(parseQuotePropertyValues({ operationValue: '', cadastralValue: null, propertyTaxAccount: ' ', predialAmount: '0' }))
      .toEqual({ valor_operacion: null, valor_catastral: null, cuenta_predial: null, importe_predial: '0.00' });
    expect(quotePropertyValuesPayload({})).toEqual({ operationValue: null, cadastralValue: null, propertyTaxAccount: null, predialAmount: null });
  });
  it('no convierte la cuenta en dinero ni pierde ceros iniciales, letras o guiones', () => {
    expect(parseQuotePropertyValues({ operationValue: '2000000.50', cadastralValue: '1200000.25', propertyTaxAccount: '  00017-a/26  ', predialAmount: '1250.75' }))
      .toEqual({ valor_operacion: '2000000.50', valor_catastral: '1200000.25', cuenta_predial: '00017-a/26', importe_predial: '1250.75' });
  });
  it.each([-1, '1.001', 'NaN', Infinity, true, {}, '100000000000000', '1,000.00'])('rechaza importe inválido %j', (value) => {
    expect(() => parseQuotePropertyValues({ predialAmount: value })).toThrow();
  });
  it.each([123, 'a'.repeat(181), 'a\nb'])('rechaza cuenta inválida sin truncarla silenciosamente %j', (value) => {
    expect(() => parseQuotePropertyValues({ propertyTaxAccount: value })).toThrow();
  });
  it('rechaza metadatos desconocidos e inyección de workflow', () => {
    expect(() => parseQuotePropertyValues({ estado: 'ACEPTADA' })).toThrow();
    expect(() => parseQuotePropertyValues(null)).toThrow();
  });
});
