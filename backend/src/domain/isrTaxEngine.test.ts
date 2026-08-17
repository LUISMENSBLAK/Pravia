import { describe, expect, it } from 'vitest';
import golden from '../fixtures/isr-golden.json';
import { calculateISR, ISR2026_RULESET, ISRCalculationInput, ISRValidationError } from './isrTaxEngine';

const deduction = (patch: Partial<ISRCalculationInput['deductions'][number]> = {}): ISRCalculationInput['deductions'][number] => ({
  id: 'costo',
  concept: 'Costo de adquisición actualizado',
  historicalAmount: '900000.00',
  updatedAmount: '1100000.00',
  expenseDate: '2016-03-01',
  updateOrigin: 'MANUAL_CONFIRMED',
  updateMethod: 'Importe actualizado proporcionado por el usuario',
  treatment: 'COSTO_ADQUISICION_ACTUALIZADO',
  included: true,
  confirmed: true,
  supportDocumentId: 'doc-costo',
  reason: 'LISR 121-I y 124',
  confirmedBy: 'fixture-user',
  confirmedAt: '2026-08-17T15:30:00.000Z',
  ...patch,
});

const base = (patch: Partial<ISRCalculationInput> = {}): ISRCalculationInput => ({
  operationType: 'ENAJENACION_INMUEBLE', taxYear: 2026,
  taxpayer: { fullName: 'María Fiscal Segura', rfc: 'FISM800101AB1', personType: 'FISICA', fiscalResidence: 'MEXICO', confirmed: true },
  property: { description: 'Inmueble de prueba fiscal controlada', landAndConstructionSameAcquisitionDate: true },
  acquisitionDate: '2016-03-01', saleDate: '2026-08-17', yearsElapsed: 10,
  salePrice: '2000000.00', deductions: [deduction()],
  exemptionTreatment: 'NO_APLICA_CONFIRMADO', ordinaryCaseConfirmed: true, specialCases: [], ...patch,
});

const officialRateTable = [
  { order: 1, lower: '0.01', upper: '10135.11', fixedFee: '0.00', percentage: '1.92' },
  { order: 2, lower: '10135.12', upper: '86022.11', fixedFee: '194.59', percentage: '6.40' },
  { order: 3, lower: '86022.12', upper: '151176.19', fixedFee: '5051.37', percentage: '10.88' },
  { order: 4, lower: '151176.20', upper: '175735.66', fixedFee: '12140.13', percentage: '16.00' },
  { order: 5, lower: '175735.67', upper: '210403.69', fixedFee: '16069.64', percentage: '17.92' },
  { order: 6, lower: '210403.70', upper: '424353.97', fixedFee: '22282.14', percentage: '21.36' },
  { order: 7, lower: '424353.98', upper: '668840.14', fixedFee: '67981.92', percentage: '23.52' },
  { order: 8, lower: '668840.15', upper: '1276925.98', fixedFee: '125485.07', percentage: '30.00' },
  { order: 9, lower: '1276925.99', upper: '1702567.97', fixedFee: '307910.81', percentage: '32.00' },
  { order: 10, lower: '1702567.98', upper: '5107703.92', fixedFee: '444116.23', percentage: '34.00' },
  { order: 11, lower: '5107703.93', upper: null, fixedFee: '1601862.46', percentage: '35.00' },
] as const;

const bracketBoundaryCases = officialRateTable.flatMap((bracket) => [
  { value: bracket.lower, order: bracket.order, edge: 'inferior' },
  ...(bracket.upper ? [{ value: bracket.upper, order: bracket.order, edge: 'superior' }] : []),
]);

describe('motor determinista de ISR', () => {
  it.each(golden)('golden: $name', (fixture) => {
    const result = calculateISR(base(fixture.input as Partial<ISRCalculationInput>), ISR2026_RULESET);
    expect({ gain: result.gain, tariffBase: result.tariffBase, yearsConsidered: result.yearsConsidered, provisionalFederalISR: result.provisionalFederalISR, bracket: result.bracket.order }).toEqual(fixture.expected);
  });

  it('incorpora exactamente los once renglones oficiales del Anexo 8 RMF 2026', () => {
    expect(ISR2026_RULESET.brackets).toEqual(officialRateTable);
  });

  it.each(bracketBoundaryCases)('aplica el rango $order en su límite $edge $value', ({ value, order }) => {
    const result = calculateISR(base({ salePrice: value, yearsElapsed: 1, deductions: [] }), ISR2026_RULESET);
    expect(result.bracket.order).toBe(order);
    expect(result.tariffBase).toBe(value);
  });

  it('deriva el caso 46,659.42 con precisión Decimal y no desde un fixture de salida', () => {
    const result = calculateISR(base({
      salePrice: '2000000.00', yearsElapsed: 10,
      deductions: [deduction({ historicalAmount: '900000.00', updatedAmount: '1200000.00' })],
    }), ISR2026_RULESET);
    expect(result.gain).toBe('800000.00');
    expect(result.tariffBase).toBe('80000.00');
    expect(result.bracket).toMatchObject({ lower: '10135.12', fixedFee: '194.59', percentage: '6.40' });
    expect(result.calculationPrecision).toEqual({ tariffTaxRaw: '4665.94232', provisionalFederalISRRaw: '46659.42320' });
    expect(result.provisionalFederalISR).toBe('46659.42');
  });

  it('declara alcance federal artículo 126 y conserva artículo 127 como no soportado', () => {
    const result = calculateISR(base(), ISR2026_RULESET);
    expect(result).toMatchObject({
      scope: 'FEDERAL_ARTICLE_126_ONLY',
      fiscalOperationFullyDetermined: false,
      unsupportedObligations: ['LISR_ARTICLE_127_STATE_PAYMENT'],
    });
    expect(result).not.toHaveProperty('total');
  });

  it('usa el importe actualizado manual solo con procedencia completa', () => {
    const item = deduction({ historicalAmount: '1000000.00', updatedAmount: '1200000.00' });
    const result = calculateISR(base({ deductions: [item] }), ISR2026_RULESET);
    expect(result.consideredDeductions).toBe('1200000.00');
    expect(item.updateOrigin).toBe('MANUAL_CONFIRMED');
    expect(item.confirmedBy).toBeTruthy();
    expect(item.confirmedAt).toBeTruthy();
  });

  it.each(['PRAVIA_CALCULATION', 'NORMATIVE_OPTION_TABLE'] as const)('rechaza el origen %s mientras no exista implementación normativa', (updateOrigin) => {
    expect(() => calculateISR(base({ deductions: [deduction({ updateOrigin })] }), ISR2026_RULESET)).toThrowError(/aún no está implementada/);
  });

  it('conserva tratamientos diferenciados de artículos 121 y 124', () => {
    const input = base({ deductions: [
      deduction({ id: 'costo', treatment: 'COSTO_ADQUISICION_ACTUALIZADO', reason: 'LISR 121-I y 124' }),
      deduction({ id: 'gastos', concept: 'Gastos notariales', historicalAmount: '50000.00', updatedAmount: '60000.00', treatment: 'GASTOS_NOTARIALES_IMPUESTOS_DERECHOS_AVALUO_ACTUALIZADOS', reason: 'LISR 121-III' }),
    ] });
    calculateISR(input, ISR2026_RULESET);
    expect(input.deductions.map((item) => ({ treatment: item.treatment, reason: item.reason }))).toEqual([
      { treatment: 'COSTO_ADQUISICION_ACTUALIZADO', reason: 'LISR 121-I y 124' },
      { treatment: 'GASTOS_NOTARIALES_IMPUESTOS_DERECHOS_AVALUO_ACTUALIZADOS', reason: 'LISR 121-III' },
    ]);
  });

  it('aplica el máximo legal de veinte años', () => expect(calculateISR(base({ yearsElapsed: 25 }), ISR2026_RULESET).yearsConsidered).toBe(20));
  it('calcula expresamente una operación de un año', () => expect(calculateISR(base({ salePrice: '10135.12', yearsElapsed: 1, deductions: [] }), ISR2026_RULESET)).toMatchObject({ yearsConsidered: 1, tariffBase: '10135.12', provisionalFederalISR: '194.59' }));
  it('procesa centavos y redondea HALF_UP exclusivamente al resultado monetario', () => {
    const result = calculateISR(base({ salePrice: '500000.99', yearsElapsed: 5, deductions: [deduction({ historicalAmount: '200000.25', updatedAmount: '250000.49' })] }), ISR2026_RULESET);
    expect(result).toMatchObject({ gain: '250000.50', tariffBase: '50000.10', provisionalFederalISR: '13729.74' });
  });
  it('no muta la entrada ni el ruleset', () => {
    const input = base(); const before = JSON.stringify(input); const rules = JSON.stringify(ISR2026_RULESET);
    calculateISR(input, ISR2026_RULESET);
    expect(JSON.stringify(input)).toBe(before); expect(JSON.stringify(ISR2026_RULESET)).toBe(rules);
  });
  it('rechaza fechas invertidas', () => expect(() => calculateISR(base({ acquisitionDate: '2026-08-18' }), ISR2026_RULESET)).toThrowError(/anterior/));
  it('rechaza importes negativos', () => expect(() => calculateISR(base({ salePrice: '-1' }), ISR2026_RULESET)).toThrowError(/mayor a cero/));
  it('rechaza importe cero', () => expect(() => calculateISR(base({ salePrice: '0' }), ISR2026_RULESET)).toThrowError(/mayor a cero/));
  it('rechaza datos indispensables ausentes', () => expect(() => calculateISR(base({ taxpayer: { ...base().taxpayer, rfc: '' } }), ISR2026_RULESET)).toThrowError(/Confirma/));
  it('rechaza ejercicio sin tarifa', () => expect(() => calculateISR(base({ taxYear: 2025, saleDate: '2025-08-17' }), ISR2026_RULESET)).toThrowError(/tarifa confirmada/));
  it('rechaza un ruleset sin rango aplicable', () => expect(() => calculateISR(base(), { ...ISR2026_RULESET, brackets: [] })).toThrowError(/rango de tarifa/));
  it('rechaza una deducción pendiente de confirmar', () => expect(() => calculateISR(base({ deductions: [deduction({ confirmed: false })] }), ISR2026_RULESET)).toThrowError(/tratamiento fiscal/));
  it('rechaza una deducción incluida sin trazabilidad completa', () => expect(() => calculateISR(base({ deductions: [deduction({ supportDocumentId: '' })] }), ISR2026_RULESET)).toThrowError(/trazabilidad/));
  it('ignora correctamente una partida excluida', () => {
    const result = calculateISR(base({ deductions: [deduction({ included: false, treatment: 'NO_DEDUCIBLE' })] }), ISR2026_RULESET);
    expect(result.consideredDeductions).toBe('0.00');
  });
  it('bloquea ganancia cero para revisión específica', () => expect(() => calculateISR(base({ deductions: [deduction({ updatedAmount: '2000000.00' })] }), ISR2026_RULESET)).toThrowError(/ganancia nula/));
  it('bloquea pérdidas para revisión específica', () => expect(() => calculateISR(base({ deductions: [deduction({ updatedAmount: '2100000.00' })] }), ISR2026_RULESET)).toThrowError(/pérdida/));
  it('bloquea exenciones no implementadas', () => expect(() => calculateISR(base({ exemptionTreatment: 'SOLICITADA' }), ISR2026_RULESET)).toThrowError(/exención/));
  it('bloquea copropiedad y otros supuestos especiales', () => expect(() => calculateISR(base({ specialCases: ['COPROPIEDAD'] }), ISR2026_RULESET)).toThrowError(/supuesto especial/));
  it('bloquea personas morales', () => expect(() => calculateISR(base({ taxpayer: { ...base().taxpayer, personType: 'MORAL' } }), ISR2026_RULESET)).toThrowError(/supuesto de contribuyente/));
  it('expone códigos humanos estables sin stack técnico', () => {
    try { calculateISR(base({ operationType: 'ADQUISICION_INMUEBLE' }), ISR2026_RULESET); throw new Error('debió fallar'); }
    catch (error) { expect(error).toBeInstanceOf(ISRValidationError); expect((error as ISRValidationError).code).toBe('UNSUPPORTED_CASE'); }
  });
});
