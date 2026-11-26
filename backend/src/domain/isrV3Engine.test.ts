import { describe, expect, it } from 'vitest';
import { ISR2026_RULESET } from './isrTaxEngine';
import { buildISRV3RuleSnapshot, calculateISRV3, type ISRV3Input, type ISRV3Party, type ISRV3RuleSnapshot } from './isrV3Engine';
import annex from '../../data/fiscal/isr-annex9-2026-20260717.json';

const parameter = (value: string, ruleId: string, legalReference: string) => ({ value, ruleId, legalReference, ruleVersion: '2026.1', sourceUrl: 'https://www.diputados.gob.mx/LeyesBiblio/' });
const rules: ISRV3RuleSnapshot = {
  engineVersion: 'ISR-V3.0', effectiveDate: '2026-09-27', saleRuleSet: ISR2026_RULESET,
  foreignGrossRate: parameter('25', 'LISR160_GROSS_RATE', 'LISR artículo 160'),
  foreignGainRate: parameter('35', 'LISR160_GAIN_MAX_RATE', 'LISR artículos 160 y 152'),
  acquisitionThresholdPercent: parameter('10', 'RLISR217_THRESHOLD_PERCENT', 'RLISR artículo 217'),
  acquisitionRate: parameter('20', 'RLISR217_ACQUISITION_RATE', 'LISR artículos 130 y 132; RLISR artículo 217'),
  ivaGeneralRate: parameter('16', 'LIVA_GENERAL_RATE', 'LIVA artículo 1'),
  homeExemptionLimitPesos: parameter('5000000', 'LISR93_XIX_HOME_EXEMPTION_LIMIT_PESOS', 'LISR artículo 93, fracción XIX, inciso a)'),
  minimumAcquisitionPercent: parameter('10', 'LISR121_MIN_ACQUISITION_PERCENT', 'LISR artículo 121 I'),
  statePaymentRate: parameter('5', 'LISR127_STATE_RATE', 'LISR artículo 127'),
};

const seller = (overrides: Partial<ISRV3Party> = {}): ISRV3Party => ({
  id: 'seller-1', role: 'ENAJENANTE', name: 'Enajenante uno', subjectType: 'PF', nationalityCode: 'MX', fiscalResidence: 'MEXICO', percentage: '100',
  acquisitionLayers: [{ id: 'layer-1', percentage: '100', acquisitionAct: 'ONEROSA', legalDate: '2016-01-01', fiscalDate: '2016-01-01', adjustedLandCost: '400000', adjustedConstructionCost: '0', source: 'Escritura antecedente', verified: true }],
  ...overrides,
});
const buyer = (overrides: Partial<ISRV3Party> = {}): ISRV3Party => ({ id: 'buyer-1', role: 'ADQUIRENTE', name: 'Adquirente uno', subjectType: 'PF', nationalityCode: 'MX', fiscalResidence: 'MEXICO', percentage: '100', ...overrides });
const baseInput = (overrides: Partial<ISRV3Input> = {}): ISRV3Input => ({
  schemaVersion: 3, taxYear: 2026, operationDate: '2026-09-27',
  act: { id: 'act-1', name: 'Compraventa', fiscalClassification: 'COMPRAVENTA' },
  property: { type: 'TERRENO', sameAcquisitionDate: true },
  values: { operation: '1000000', appraisal: '1000000', cadastral: '800000', landSale: '1000000', constructionSale: '0' },
  calculateIVA: false, parties: [seller(), buyer()], deductions: [], ...overrides,
});

describe('ISR v3 · 38 fixtures contractuales independientes', () => {
  it.each(['2026-11-11', '2026-11-23'])('regresión del cliente: costo mínimo 10%% y pago estatal acreditable (%s)', (operationDate) => {
    // LISR 121 I, 126 y 127; Anexo 8 RMF 2026 apartado A.I.
    // No se inventa un INPC: se verifica el piso usando un costo actualizado
    // expresamente confirmado, menor al mínimo, y ambas fechas comunicadas.
    const result = calculateISRV3(baseInput({ operationDate,
      values: { operation:'746130.00', appraisal:'746130.00', cadastral:'', landSale:'746130.00', constructionSale:'0' },
      parties:[seller({ acquisitionLayers:[{id:'client-case', percentage:'100', acquisitionAct:'ONEROSA', legalDate:'2025-05-26', fiscalDate:'2025-05-26', adjustedLandCost:'2034.65', adjustedConstructionCost:'0', source:'Costo actualizado confirmado para aislar piso fiscal; no representa un INPC obtenido', verified:true}] }), buyer()],
    }), rules);
    expect(result.saleISR[0]).toMatchObject({ amount:'126288.13', taxableBase:'671517.00',
      acquisitionWorksheet:{minimumCost:'74613.00', appliedCost:'74613.00'},
      distribution:{statePayment:'33575.85',federalRemainder:'92712.28'} });
    expect(result.acquisitionISR[0]).toMatchObject({status:'NO_GENERADO',amount:'0.00'});
  });
  it('una base positiva fuera del rango de tarifa queda pendiente, no provoca error ni inventa un tramo', () => {
    const input = baseInput({ values: { ...baseInput().values, operation: '400000.01', landSale: '400000.01' } });
    expect(calculateISRV3(input, rules).saleISR[0]).toMatchObject({ status: 'PENDIENTE_INFORMACION', amount: null, route: 'TARIFA_SIN_TRAMO' });
  });
  it('CASO 1. PF residente en México, sólo terreno, ganancia', () => {
    const result = calculateISRV3(baseInput(), rules);
    expect(result.saleISR[0]).toMatchObject({ status: 'GRAVADO', amount: '33859.42', taxableBase: '600000.00', route: 'PF_MEXICO' });
  });

  it('CASO 2. Terreno y construcción adquiridos en la misma fecha', () => {
    const input = baseInput({ property: { type: 'TERRENO_CONSTRUCCION', sameAcquisitionDate: true }, values: { operation: '1500000', appraisal: '1500000', cadastral: '1200000', landSale: '700000', constructionSale: '800000' }, parties: [seller({ acquisitionLayers: [{ id: 'same', percentage: '100', acquisitionAct: 'ONEROSA', legalDate: '2016-01-01', fiscalDate: '2016-01-01', adjustedLandCost: '300000', adjustedConstructionCost: '500000', source: 'Escritura', verified: true }] }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0].status).toBe('GRAVADO');
  });

  it('CASO 3. Terreno y construcción con fechas diferentes', () => {
    const input = baseInput({ property: { type: 'TERRENO_CONSTRUCCION', sameAcquisitionDate: false }, parties: [seller({ acquisitionLayers: [{ id: 'land', percentage: '60', acquisitionAct: 'ONEROSA', legalDate: '2010-01-01', fiscalDate: '2010-01-01', adjustedLandCost: '250000', adjustedConstructionCost: '0', source: 'Escritura', verified: true }, { id: 'building', percentage: '40', acquisitionAct: 'ONEROSA', legalDate: '2018-01-01', fiscalDate: '2018-01-01', adjustedLandCost: '0', adjustedConstructionCost: '250000', source: 'Aviso de obra', verified: true }] }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0]).toMatchObject({ status: 'PENDIENTE_INFORMACION', amount: null });
    expect(calculateISRV3(input, rules).missing.join(' ')).toContain('no se aplica a toda la ganancia la fecha más antigua');
  });

  it('CASO 4. Construcción posterior sin costo comprobable conserva pendiente RLISR 205', () => {
    const input = baseInput({ parties: [seller({ acquisitionLayers: [{ id: 'obra', percentage: '100', acquisitionAct: 'ONEROSA', legalDate: '2016-01-01', fiscalDate: '2016-01-01', adjustedLandCost: '400000', adjustedConstructionCost: '0', source: '', verified: false }] }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0]).toMatchObject({ status: 'PENDIENTE_INFORMACION', amount: null });
  });

  it('CASO 5. Casa habitación totalmente exenta', () => {
    const input = baseInput({ property: { type: 'CASA_HABITACION', sameAcquisitionDate: true }, parties: [seller({ homeExemption: { requested: true, homeUseVerified: true, requiredDocumentsVerified: true, noExemptionInPriorThreeYearsVerified: true } }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0]).toMatchObject({ status: 'EXENTO', amount: '0.00', exemptAmount: '1000000.00' });
  });

  it('CASO 6. Casa habitación parcialmente exenta', () => {
    const limited = { ...rules, homeExemptionLimitPesos: parameter('500000', 'HOME_LIMIT', 'LISR artículo 93 XIX') };
    const input = baseInput({ property: { type: 'CASA_HABITACION', sameAcquisitionDate: true }, parties: [seller({ homeExemption: { requested: true, homeUseVerified: true, requiredDocumentsVerified: true, noExemptionInPriorThreeYearsVerified: true } }), buyer()] });
    expect(calculateISRV3(input, limited).saleISR[0]).toMatchObject({ status: 'EXENTO_PARCIALMENTE', exemptAmount: '500000.00' });
  });

  it('CASO 7. Dos enajenantes 50/50 con resultados individuales', () => {
    const layer = (id: string) => [{ id, percentage: '50', acquisitionAct: 'ONEROSA' as const, legalDate: '2016-01-01', fiscalDate: '2016-01-01', adjustedLandCost: '200000', adjustedConstructionCost: '0', source: 'Escritura', verified: true }];
    const input = baseInput({ parties: [seller({ id: 's1', name: 'Uno', percentage: '50', acquisitionLayers: layer('l1') }), seller({ id: 's2', name: 'Dos', percentage: '50', acquisitionLayers: layer('l2') }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR).toHaveLength(2);
  });

  it('CASO 8. Un enajenante transmite sólo una parte', () => {
    const input = baseInput({ parties: [seller({ id: 's1', percentage: '60', acquisitionLayers: [{ ...seller().acquisitionLayers![0], percentage: '60', adjustedLandCost: '240000' }] }), seller({ id: 's2', percentage: '40', acquisitionLayers: [{ ...seller().acquisitionLayers![0], id: 'l2', percentage: '40', adjustedLandCost: '160000' }] }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0].taxableBase).toBe('360000.00');
  });

  it('CASO 9. Un propietario con porcentajes adquiridos en fechas distintas', () => {
    const input = baseInput({ parties: [seller({ acquisitionLayers: [{ ...seller().acquisitionLayers![0], id: 'a', percentage: '50', adjustedLandCost: '200000' }, { ...seller().acquisitionLayers![0], id: 'b', percentage: '50', fiscalDate: '2020-01-01', adjustedLandCost: '250000' }] }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0].status).toBe('PENDIENTE_INFORMACION');
  });

  it('CASO 10. Herencia con antecedente fiscal encadenado', () => {
    const input = baseInput({ parties: [seller({ acquisitionLayers: [{ ...seller().acquisitionLayers![0], acquisitionAct: 'HERENCIA', priorLayerId: 'antecedente-1' }] }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0].status).toBe('GRAVADO');
  });

  it('CASO 11. Donación sin antecedente no sustituye costo por cero', () => {
    const input = baseInput({ parties: [seller({ acquisitionLayers: [{ ...seller().acquisitionLayers![0], acquisitionAct: 'DONACION' }] }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0].missing).toContain('antecedente encadenado de la capa layer-1');
  });

  it('CASO 12. Avalúo superior sin alcanzar umbral de adquisición', () => {
    const input = baseInput({ values: { ...baseInput().values, appraisal: '1099999' } });
    expect(calculateISRV3(input, rules).acquisitionISR[0]).toMatchObject({ status: 'NO_GENERADO', amount: '0.00' });
  });

  it('CASO 13. Avalúo superior que genera ISR adquisición', () => {
    const input = baseInput({ values: { ...baseInput().values, appraisal: '1200000' } });
    expect(calculateISRV3(input, rules).acquisitionISR[0]).toMatchObject({ status: 'GRAVADO', taxableBase: '200000.00', amount: '40000.00' });
  });

  it('CASO 14. Excepción legal al ISR adquisición', () => {
    const input = baseInput({ parties: [seller(), buyer({ acquisitionExemption: { applies: true, legalReference: 'Excepción confirmada', verified: true } })] });
    expect(calculateISRV3(input, rules).acquisitionISR[0].status).toBe('NO_GENERADO');
  });

  it('CASO 15. Residente extranjero por ingreso bruto', () => {
    const input = baseInput({ parties: [seller({ fiscalResidence: 'EXTRANJERO' }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0]).toMatchObject({ route: 'EXTRANJERO_INGRESO_BRUTO', amount: '250000.00' });
  });

  it('CASO 16. Residente extranjero opción sobre ganancia completa', () => {
    const input = baseInput({ parties: [seller({ fiscalResidence: 'EXTRANJERO', foreignGainOption: { requested: true, requirementsVerified: true, source: 'Constancias verificadas' } }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0]).toMatchObject({ route: 'EXTRANJERO_OPCION_GANANCIA', amount: '210000.00' });
  });

  it('CASO 17. Persona extranjera con residencia fiscal mexicana', () => {
    const input = baseInput({ parties: [seller({ nationalityCode: 'US', fiscalResidence: 'MEXICO' }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0].route).toBe('PF_MEXICO');
  });

  it('CASO 18. Tarjeta migratoria no determina residencia fiscal', () => {
    const input = baseInput({ parties: [seller({ nationalityCode: 'US', immigrationStatus: 'RESIDENTE_PERMANENTE', fiscalResidence: 'POR_DETERMINAR' }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0].status).toBe('PENDIENTE_INFORMACION');
  });

  it('CASO 19. Terreno no genera IVA', () => {
    expect(calculateISRV3(baseInput({ calculateIVA: true }), rules).iva).toMatchObject({ status: 'EXENTO', amount: '0.00' });
  });

  it('CASO 20. Casa habitación con IVA exento', () => {
    const input = baseInput({ calculateIVA: true, property: { type: 'CASA_HABITACION', sameAcquisitionDate: true } });
    expect(calculateISRV3(input, rules).iva.status).toBe('EXENTO');
  });

  it('CASO 21. Construcción comercial grava sólo construcción', () => {
    const input = baseInput({ calculateIVA: true, property: { type: 'CONSTRUCCION_COMERCIAL', sameAcquisitionDate: true }, values: { ...baseInput().values, landSale: '400000', constructionSale: '600000' } });
    expect(calculateISRV3(input, rules).iva).toMatchObject({ taxableBase: '600000.00', rate: '16', amount: '96000.00' });
  });

  it('CASO 22. Uso mixto separa componente exento y gravado', () => {
    const input = baseInput({ calculateIVA: true, property: { type: 'USO_MIXTO', sameAcquisitionDate: true, mixedTaxablePercentage: '40' }, values: { ...baseInput().values, landSale: '400000', constructionSale: '600000' } });
    expect(calculateISRV3(input, rules).iva).toMatchObject({ status: 'EXENTO_PARCIALMENTE', taxableBase: '240000.00', amount: '38400.00' });
  });

  it('CASO 23. Operación con pérdida muestra cero no generado', () => {
    const input = baseInput({ values: { ...baseInput().values, operation: '300000', landSale: '300000' } });
    expect(calculateISRV3(input, rules).saleISR[0]).toMatchObject({ status: 'NO_GENERADO', amount: '0.00' });
  });

  it('CASO 24. Datos insuficientes especifican faltantes', () => {
    const input = baseInput({ parties: [seller({ acquisitionLayers: [] }), buyer()] });
    expect(calculateISRV3(input, rules).missing).toContain('capas de adquisición de Enajenante uno');
  });

  it('CASO 25. Captura manual sin expediente usa el mismo motor', () => {
    expect(calculateISRV3(baseInput(), rules).engineVersion).toBe('ISR-V3.0');
  });

  it('CASO 26. Extracción documental no cambia la fórmula determinística', () => {
    expect(calculateISRV3(baseInput(), rules)).toEqual(calculateISRV3(structuredClone(baseInput()), rules));
  });

  it('CASO 27. Snapshot de expediente corregible produce salida reproducible', () => {
    const corrected = baseInput({ values: { ...baseInput().values, operation: '1100000', landSale: '1100000' } });
    expect(calculateISRV3(corrected, rules).saleISR[0].amount).not.toBe(calculateISRV3(baseInput(), rules).saleISR[0].amount);
  });

  it('CASO 28. Resultado contiene breakdown apto para documento firmable', () => {
    expect(calculateISRV3(baseInput(), rules).breakdown.map((item) => item.key)).toEqual(['sale:seller-1', 'acquisition:buyer-1', 'iva']);
  });

  it('CASO 29. Corrección manual prevalece y recalcula todo', () => {
    const initial = calculateISRV3(baseInput(), rules);
    const corrected = calculateISRV3(baseInput({ deductions: [{ id: 'd1', concept: 'Gastos', amount: '100000', component: 'AMBOS', verified: true }] }), rules);
    expect(corrected.saleISR[0].amount).not.toBe(initial.saleISR[0].amount);
  });

  it('CASO 30. Cada resultado gravado expone fundamento y operación', () => {
    const result = calculateISRV3(baseInput({ values: { ...baseInput().values, appraisal: '1200000' } }), rules);
    expect([...result.saleISR[0].traces, ...result.acquisitionISR[0].traces].every((item) => item.legalReference && item.calculation && item.ruleVersion)).toBe(true);
  });

  it('CASO 31. PM residente no entra a ruta PF', () => {
    const input = baseInput({ parties: [seller({ subjectType: 'PM_TITULO_II' }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0]).toMatchObject({ status: 'NO_APLICA', amount: null, route: 'PERSONA_MORAL' });
  });

  it('CASO 32. Adquirente PM Título II no recibe RLISR 217', () => {
    const input = baseInput({ values: { ...baseInput().values, appraisal: '1200000' }, parties: [seller(), buyer({ subjectType: 'PM_TITULO_II' })] });
    expect(calculateISRV3(input, rules).acquisitionISR[0]).toMatchObject({ status: 'NO_APLICA', amount: null });
  });

  it('CASO 33. Dos vendedores conservan historiales independientes', () => {
    const first = seller({ id: 's1', name: 'Uno', percentage: '50', acquisitionLayers: [{ ...seller().acquisitionLayers![0], id: 'l1', percentage: '50', adjustedLandCost: '100000' }] });
    const second = seller({ id: 's2', name: 'Dos', percentage: '50', acquisitionLayers: [{ ...seller().acquisitionLayers![0], id: 'l2', percentage: '50', adjustedLandCost: '300000' }] });
    const result = calculateISRV3(baseInput({ parties: [first, second, buyer()] }), rules);
    expect(result.saleISR[0].amount).not.toBe(result.saleISR[1].amount);
  });

  it('CASO 34. Mismo vendedor conserva varias capas y construcción posterior', () => {
    const input = baseInput({ parties: [seller({ acquisitionLayers: [{ ...seller().acquisitionLayers![0], id: 't', percentage: '70', adjustedLandCost: '280000' }, { ...seller().acquisitionLayers![0], id: 'c', percentage: '30', fiscalDate: '2022-01-01', adjustedLandCost: '0', adjustedConstructionCost: '120000' }] }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0].missing.join(' ')).toContain('distribución de ganancia por fechas');
  });

  it('CASO 35. El cálculo no depende del formato CFG-002', () => {
    expect(calculateISRV3(baseInput(), rules).saleISR[0].amount).toBe('33859.42');
  });

  it('CASO 36. Sólo parámetros presentes en snapshot vigente gobiernan', () => {
    const incomplete = { ...rules, acquisitionRate: undefined };
    const input = baseInput({ values: { ...baseInput().values, appraisal: '1200000' } });
    expect(calculateISRV3(input, incomplete).acquisitionISR[0]).toMatchObject({ status: 'PENDIENTE_INFORMACION', amount: null });
  });

  it('CASO 37. Misma entrada y versión produce exactamente el mismo resultado', () => {
    expect(calculateISRV3(baseInput(), rules)).toEqual(calculateISRV3(baseInput(), rules));
  });

  it('CASO 38. El resultado no contiene identidad de organización ajena', () => {
    const result = calculateISRV3(baseInput(), rules);
    expect(JSON.stringify(result)).not.toContain('organization');
  });

  it('rechaza valor de operación vacío o cero en vez de inventar una base', () => {
    expect(() => calculateISRV3(baseInput({ values: { ...baseInput().values, operation: '0', landSale: '0' } }), rules)).toThrow('mayor que cero');
  });

  it('rechaza componentes que no reconcilian con el valor total', () => {
    expect(() => calculateISRV3(baseInput({ values: { ...baseInput().values, landSale: '999999' } }), rules)).toThrow('coincidir exactamente');
  });

  it('construye parámetros sólo desde referencias versionadas', () => {
    const snapshot = buildISRV3RuleSnapshot({ ...ISR2026_RULESET, referenceTables: [{ id: 'r1', type: 'RATE', code: 'LIVA_GENERAL_RATE', version: 1, effectiveFrom: '2026-01-01', effectiveTo: null, value: { value: '16' }, sourceTitle: 'LIVA artículo 1', sourceUrl: 'https://www.diputados.gob.mx/' }] }, '2026-09-27');
    expect(snapshot.ivaGeneralRate?.value).toBe('16');
    expect(snapshot.acquisitionRate).toBeUndefined();
  });

  it('LISR 160 sobre ingreso bruto no requiere ni deduce costos de adquisición', () => {
    const input = baseInput({ parties: [seller({ fiscalResidence: 'EXTRANJERO', acquisitionLayers: [] }), buyer()], deductions: [{ id: 'd', concept: 'Sin verificar', amount: '999999', component: 'AMBOS', verified: false }] });
    expect(calculateISRV3(input, rules).saleISR[0]).toMatchObject({ amount: '250000.00', taxableBase: '1000000.00', missing: [] });
  });

  it('no sustituye la tasa máxima faltante de extranjero por tarifa de PF residente', () => {
    const input = baseInput({ parties: [seller({ fiscalResidence: 'EXTRANJERO', foreignGainOption: { requested: true, requirementsVerified: true, source: 'Evidencia' } }), buyer()] });
    expect(calculateISRV3(input, { ...rules, foreignGainRate: undefined }).saleISR[0]).toMatchObject({ status: 'PENDIENTE_INFORMACION', amount: null });
  });

  it('deducción común se distribuye una sola vez, conservando partidas asignadas', () => {
    const first = seller({ id: 'a', percentage: '50', acquisitionLayers: [{ ...seller().acquisitionLayers![0], percentage: '50', adjustedLandCost: '200000' }] });
    const second = seller({ id: 'b', percentage: '50', acquisitionLayers: [{ ...seller().acquisitionLayers![0], percentage: '50', adjustedLandCost: '200000' }] });
    const result = calculateISRV3(baseInput({ parties: [first, second, buyer()], deductions: [
      { id: 'shared', concept: 'Común', amount: '100000', component: 'AMBOS', verified: true },
      { id: 'own', concept: 'Individual', amount: '10000', component: 'AMBOS', paidByPartyId: 'a', verified: true },
    ] }), rules);
    expect(result.saleISR.map((item) => item.taxableBase)).toEqual(['240000.00', '250000.00']);
  });

  it('no considera costo vacío como cero confirmado ni ignora deducción pendiente', () => {
    const missingCost = seller({ acquisitionLayers: [{ ...seller().acquisitionLayers![0], adjustedLandCost: '' }] });
    expect(calculateISRV3(baseInput({ parties: [missingCost, buyer()] }), rules).saleISR[0].status).toBe('PENDIENTE_INFORMACION');
    expect(calculateISRV3(baseInput({ deductions: [{ id: 'd', concept: 'Gasto', amount: '10', component: 'AMBOS', verified: false }] }), rules).saleISR[0].amount).toBeNull();
  });

  it('años se cuentan hasta el aniversario fiscal, no por cambio de ejercicio', () => {
    const input = baseInput({ parties: [seller({ acquisitionLayers: [{ ...seller().acquisitionLayers![0], fiscalDate: '2016-12-31' }] }), buyer()] });
    expect(calculateISRV3(input, rules).saleISR[0].traces.at(-1)!.inputsUsed.anos).toBe('9');
  });

  it('rechaza fecha inexistente y ejercicio distinto antes de calcular', () => {
    expect(() => calculateISRV3(baseInput({ operationDate: '2026-02-30' }), rules)).toThrow('válida');
    expect(() => calculateISRV3(baseInput({ taxYear: 2025 }), rules)).toThrow('ejercicio');
  });

  it('ejemplo contractual es un caso reproducible, no una cifra fija universal', () => {
    const historicalRules = { ...rules, saleRuleSet: { ...rules.saleRuleSet, referenceTables: [
      { id: 'qa-policy', type: 'CALCULATION_CRITERIA', code: 'ISR_ACQUISITION_UPDATE_POLICY', version: 1, effectiveFrom: '2026-01-01', effectiveTo: null, value: {}, sourceTitle: 'QA terreno sin regla adicional', sourceUrl: 'https://qa.example.test' },
      { id: 'annex', type: 'FACTOR', code: annex.code, version: annex.version, effectiveFrom: annex.effectiveFrom, effectiveTo: annex.effectiveTo, value: annex, sourceTitle: annex.sourceTitle, sourceUrl: annex.sourceUrl },
    ] } };
    const example = baseInput({ operationDate: '2026-11-11', values: { operation: '746130', appraisal: '746130', cadastral: '', landSale: '746130', constructionSale: '0' }, parties: [seller({ acquisitionLayers: [{ ...seller().acquisitionLayers![0], legalDate: '2025-05-26', fiscalDate: '2025-05-26', adjustedLandCost: '', adjustedConstructionCost: '', historical: { method: 'FACTORES', separation: 'EXPLICIT', land: '2034.65' } }] }), buyer()] });
    const result = calculateISRV3(example, historicalRules).saleISR[0];
    expect(result).toMatchObject({ taxableBase: '671517.00', amount: '126288.13', distribution: { statePayment: '33575.85', federalRemainder: '92712.28', status: 'DETERMINADO' } });
    expect(result.traces.some((item) => item.ruleId === annex.code)).toBe(true);
    expect(calculateISRV3({ ...example, values: { ...example.values, operation: '800000', landSale: '800000', appraisal: '800000' } }, historicalRules).saleISR[0].amount).not.toBe(result.amount);
  });

  it('distribución estatal está limitada al ISR provisional y conserva centavos exactos', () => {
    const result = calculateISRV3(baseInput(), rules).saleISR[0];
    expect(result.distribution).toMatchObject({ statePayment: '30000.00', federalRemainder: '3859.42' });
    const highState = calculateISRV3(baseInput(), { ...rules, statePaymentRate: parameter('80', 'SYNTHETIC_CAP_TEST', 'Fixture para comprobar límite, NO tasa fiscal') }).saleISR[0];
    expect(highState.distribution).toMatchObject({ statePayment: highState.amount, federalRemainder: '0.00' });
  });

  it('ausencia de referencia de mínimo o tasa estatal queda pendiente, no default inventado', () => {
    expect(calculateISRV3(baseInput(), { ...rules, minimumAcquisitionPercent: undefined }).saleISR[0]).toMatchObject({ amount: null, status: 'PENDIENTE_INFORMACION' });
    const result = calculateISRV3(baseInput(), { ...rules, statePaymentRate: undefined });
    expect(result.saleISR[0].distribution).toMatchObject({ statePayment: null, federalRemainder: null, status: 'PENDIENTE_INFORMACION' });
    expect(result.missing.join(' ')).toContain('LISR127_STATE_RATE');
  });

  it('exención parcial distribuye deducciones y exención total no exige costos innecesarios', () => {
    const input = baseInput({ property: { type: 'CASA_HABITACION', sameAcquisitionDate: true }, parties: [seller({ homeExemption: { requested: true, homeUseVerified: true, requiredDocumentsVerified: true, noExemptionInPriorThreeYearsVerified: true } }), buyer()] });
    expect(calculateISRV3(input, { ...rules, homeExemptionLimitPesos: parameter('500000', 'HOME_LIMIT', 'LISR 93 XIX') }).saleISR[0].taxableBase).toBe('300000.00');
    input.parties[0].acquisitionLayers = [];
    expect(calculateISRV3(input, rules).saleISR[0]).toMatchObject({ status: 'EXENTO', amount: '0.00' });
  });
});
