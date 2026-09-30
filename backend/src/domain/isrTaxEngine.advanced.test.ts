import { describe, expect, it } from 'vitest';
import { calculateISR, calculateLandExemption, determineISRScenario, ISR2026_RULESET, type ISRCalculationInput, type ISRPartyAllocation, type ISRPropertyComponent } from './isrTaxEngine';

const acquisition = (id: string, date: string, historicalAmount: string, updatedAmount = historicalAmount) => ({ id, date, historicalAmount, updatedAmount, adjustmentMethod: 'MANUAL_CONFIRMED' as const, source: `Documento ${id}`, confirmed: true });
const component = (id: string, type: ISRPropertyComponent['type'], saleValue: string, acquisitions: ISRPropertyComponent['acquisitions']): ISRPropertyComponent => ({ id, type, saleValue, acquisitions });
const party = (id: string, role: ISRPartyAllocation['role'], percentage: string, patch: Partial<ISRPartyAllocation> = {}): ISRPartyAllocation => ({ id, role, fullName: `${role} ${id}`, rfc: `RFC${id}0101AAA`, personType: 'FISICA', fiscalResidence: 'MEXICO', participationPercentage: percentage, ...patch });
const criteria = (patch: Partial<NonNullable<ISRCalculationInput['criteria']>> = {}): NonNullable<ISRCalculationInput['criteria']> => ({ adjustmentMethod: 'AUTO', resolvedAdjustmentMethod: 'MANUAL_CONFIRMED', tariffSelection: 'AUTO', landLossOffsetsConstructionGain: true, version: '1', effectiveFrom: '2026-01-01', source: 'https://pravia.test/criterio-isr-1', referenceCode: 'ISR-CRITERIO-1', ...patch });
const scopedDeduction = (patch: Partial<ISRCalculationInput['deductions'][number]> = {}): ISRCalculationInput['deductions'][number] => ({ id: 'd1', concept: 'Gasto confirmado', historicalAmount: '100000', updatedAmount: '100000', expenseDate: '2026-01-01', updateOrigin: 'MANUAL_CONFIRMED', updateMethod: 'Sin actualización', treatment: 'GASTOS_NOTARIALES_IMPUESTOS_DERECHOS_AVALUO_ACTUALIZADOS', included: true, confirmed: true, supportDocumentId: 'doc-1', reason: 'Regla revisada', confirmedBy: 'Revisor', confirmedAt: '2026-06-01T12:00:00Z', appliesTo: 'TERRENO', ...patch });
const base = (patch: Partial<ISRCalculationInput> = {}): ISRCalculationInput => ({
  operationType: 'ENAJENACION_INMUEBLE', taxYear: 2026,
  taxpayer: { fullName: 'Caso avanzado', rfc: 'CAAO800101AA1', personType: 'FISICA', fiscalResidence: 'MEXICO', confirmed: true },
  property: { description: 'Predio de prueba', landAndConstructionSameAcquisitionDate: true },
  acquisitionDate: '2010-01-01', saleDate: '2026-06-01', yearsElapsed: 16, salePrice: '2000000.00', deductions: [],
  exemptionTreatment: 'NO_APLICA_CONFIRMADO', ordinaryCaseConfirmed: true, specialCases: [], criteria: criteria(), ...patch,
});

describe('motor ISR avanzado en la ruta canónica', () => {
  it.each([
    { name: 'sólo terreno', components: [component('t','TERRENO','2000000',[acquisition('a','2010-01-01','900000')])], expected: 'TERRENO' },
    { name: 'sólo construcción', components: [component('c','CONSTRUCCION','2000000',[acquisition('a','2010-01-01','900000')])], expected: 'CONSTRUCCION' },
    { name: 'misma fecha', components: [component('t','TERRENO','1000000',[acquisition('a','2010-01-01','400000')]),component('c','CONSTRUCCION','1000000',[acquisition('b','2010-01-01','500000')])], expected: 'TERRENO_CONSTRUCCION_MISMA_FECHA' },
    { name: 'fechas diferentes', components: [component('t','TERRENO','1000000',[acquisition('a','2010-01-01','400000')]),component('c','CONSTRUCCION','1000000',[acquisition('b','2018-02-01','500000')])], expected: 'TERRENO_CONSTRUCCION_FECHAS_DIFERENTES' },
  ])('$name determina escenario', ({ components, expected }) => expect(determineISRScenario(components)).toBe(expected));

  it('calcula componentes con múltiples adquisiciones sin límite artificial', () => {
    const components = [component('t','TERRENO','2000000',[acquisition('a','2001-01-01','300000','400000'),acquisition('b','2010-01-01','350000','500000')])];
    const result = calculateISR(base({ components }), ISR2026_RULESET);
    expect(result.advanced).toMatchObject({ scenario: 'TERRENO', adjustedAcquisition: '900000.00', components: [{ acquisitionCount: 2, gain: '1100000.00' }] });
  });

  it.each([['1999-01-01','100000'],['2005-06-30','250000'],['2020-02-29','399999.99']] as const)('conserva fecha y Decimal para adquisición %s', (date, amount) => {
    const result = calculateISR(base({ components: [component('t','TERRENO','2000000',[acquisition('a',date,amount)])] }), ISR2026_RULESET);
    expect(result.advanced?.adjustedAcquisition).toBe(Number(amount).toFixed(2));
  });

  it('rechaza la suma de componentes distinta al precio total', () => expect(()=>calculateISR(base({components:[component('t','TERRENO','1',[acquisition('a','2010-01-01','0')])]}),ISR2026_RULESET)).toThrow(/coincidir/));
  it('rechaza componente sin adquisición', () => expect(()=>calculateISR(base({components:[component('t','TERRENO','2000000',[])]}),ISR2026_RULESET)).toThrow(/adquisición/));
  it('rechaza adquisición no confirmada', () => expect(()=>calculateISR(base({components:[component('t','TERRENO','2000000',[{...acquisition('a','2010-01-01','100'),confirmed:false}])]}),ISR2026_RULESET)).toThrow(/requiere fecha/));
  it('rechaza INPC sin referencia', () => expect(()=>calculateISR(base({criteria:criteria({adjustmentMethod:'INPC',resolvedAdjustmentMethod:'INPC'}),components:[component('t','TERRENO','2000000',[{...acquisition('a','2010-01-01','100'),adjustmentMethod:'INPC'}])]}),ISR2026_RULESET)).toThrow(/snapshot/));
  it('rechaza factor inconsistente', () => expect(()=>calculateISR(base({criteria:criteria({adjustmentMethod:'FACTORES',resolvedAdjustmentMethod:'FACTORES'}),components:[component('t','TERRENO','2000000',[{...acquisition('a','2010-01-01','100','250'),adjustmentMethod:'FACTORES',factor:'2',referenceCode:'FAC-2010'}])]}),ISR2026_RULESET)).toThrow(/no coincide/));
  it('acepta factor exacto y deja traza', () => {
    const result=calculateISR(base({criteria:criteria({adjustmentMethod:'FACTORES',resolvedAdjustmentMethod:'FACTORES'}),components:[component('t','TERRENO','2000000',[{...acquisition('a','2010-01-01','100','200'),adjustmentMethod:'FACTORES',factor:'2',referenceCode:'FAC-2010'}])]}),ISR2026_RULESET);
    expect(result.advanced?.calculationTrace.map((node) => node.node)).toEqual(['taxable-income', 'gain', 'criteria', 'federal-provisional']);
  });

  it('bloquea componentes sin criterio fiscal versionado', () => expect(() => calculateISR(base({ criteria: undefined, components: [component('t','TERRENO','2000000',[acquisition('a','2010-01-01','900000')])] }), ISR2026_RULESET)).toThrow(/criterio versionado/));
  it('aplica la política que impide compensar pérdida de terreno con ganancia de construcción', () => {
    const components = [component('t','TERRENO','500000',[acquisition('a','2010-01-01','700000')]), component('c','CONSTRUCCION','1500000',[acquisition('b','2010-01-01','500000')])];
    const offset = calculateISR(base({ components, criteria: criteria({ landLossOffsetsConstructionGain: true }) }), ISR2026_RULESET);
    const isolated = calculateISR(base({ components, criteria: criteria({ landLossOffsetsConstructionGain: false }) }), ISR2026_RULESET);
    expect(offset.gain).toBe('800000.00');
    expect(isolated.gain).toBe('1000000.00');
    expect(isolated.advanced?.calculationTrace.some((node) => node.node === 'criteria' && node.rule === 'ISR-CRITERIO-1@1')).toBe(true);
  });
  it('asigna una deducción exclusivamente al terreno', () => {
    const result = calculateISR(base({ components: [component('t','TERRENO','1000000',[acquisition('a','2010-01-01','400000')]), component('c','CONSTRUCCION','1000000',[acquisition('b','2010-01-01','500000')])], deductions: [scopedDeduction()] }), ISR2026_RULESET);
    expect(result.advanced?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'TERRENO', allocatedDeductions: '100000.00', gain: '500000.00' }),
      expect.objectContaining({ type: 'CONSTRUCCION', allocatedDeductions: '0.00', gain: '500000.00' }),
    ]));
  });
  it('requiere regla versionada al distribuir una deducción entre ambos componentes', () => expect(() => calculateISR(base({ components: [component('t','TERRENO','1000000',[acquisition('a','2010-01-01','400000')]), component('c','CONSTRUCCION','1000000',[acquisition('b','2010-01-01','500000')])], deductions: [scopedDeduction({ appliesTo: 'AMBOS' })] }), ISR2026_RULESET)).toThrow(/regla de distribución/));
  it('distribuye a ambos sólo con porcentajes al 100%, versión y fuente', () => {
    const result = calculateISR(base({ components: [component('t','TERRENO','1000000',[acquisition('a','2010-01-01','400000')]), component('c','CONSTRUCCION','1000000',[acquisition('b','2010-01-01','500000')])], deductions: [scopedDeduction({ appliesTo: 'AMBOS', allocationRule: { landPercentage: '25', constructionPercentage: '75', code: 'DIST-1', version: '1', source: 'Criterio fiscal interno aprobado', confirmed: true } })] }), ISR2026_RULESET);
    expect(result.advanced?.components.map((item) => item.allocatedDeductions)).toEqual(['25000.00','75000.00']);
  });
  it('valida el factor de depreciación de construcción', () => {
    const deduction = scopedDeduction({ appliesTo: 'CONSTRUCCION', historicalAmount: '100000', updatedAmount: '80000', depreciateConstructionComponent: true, depreciationRule: { factor: '0.8', code: 'DEP-1', version: '2026.1', source: 'Regla verificada', confirmed: true } });
    const result = calculateISR(base({ components: [component('c','CONSTRUCCION','2000000',[acquisition('a','2010-01-01','500000')])], deductions: [deduction] }), ISR2026_RULESET);
    expect(result.advanced?.components[0]).toMatchObject({ allocatedDeductions: '80000.00', gain: '1420000.00' });
  });
  it('bloquea depreciación cuyo factor no reproduce el importe', () => expect(() => calculateISR(base({ components: [component('c','CONSTRUCCION','2000000',[acquisition('a','2010-01-01','500000')])], deductions: [scopedDeduction({ appliesTo: 'CONSTRUCCION', depreciateConstructionComponent: true, depreciationRule: { factor: '0.5', code: 'DEP-1', version: '1', source: 'Regla', confirmed: true } })] }), ISR2026_RULESET)).toThrow(/factor de depreciación/));
  it('requiere autorización completa para tarifa manual', () => expect(() => calculateISR(base({ components: [component('t','TERRENO','2000000',[acquisition('a','2010-01-01','900000')])], criteria: criteria({ tariffSelection: 'MANUAL_AUTHORIZED' }) }), ISR2026_RULESET)).toThrow(/autorización/));

  it.each([['50','50'],['33.33','66.67'],['10','90']] as const)('distribuye vendedores %s/%s y conserva total', (first, second) => {
    const result = calculateISR(base({ parties: [party('1','ENAJENANTE',first),party('2','ENAJENANTE',second)] }), ISR2026_RULESET);
    expect(result.advanced?.partyResults).toHaveLength(2);
    expect(result.advanced!.partyResults.reduce((sum,item)=>sum+Number(item.provisionalFederalISR),0)).toBeCloseTo(Number(result.provisionalFederalISR),2);
  });
  it('valida exactamente 100% de vendedores', () => expect(()=>calculateISR(base({parties:[party('1','ENAJENANTE','99.99')]}),ISR2026_RULESET)).toThrow(/100%/));
  it('valida exactamente 100% de compradores', () => expect(()=>calculateISR(base({parties:[party('1','ENAJENANTE','100'),party('2','ADQUIRENTE','60'),party('3','ADQUIRENTE','30')]}),ISR2026_RULESET)).toThrow(/adquirentes/));
  it('acepta múltiples compradores al 100%', () => expect(calculateISR(base({parties:[party('1','ENAJENANTE','100'),party('2','ADQUIRENTE','60'),party('3','ADQUIRENTE','40')]}),ISR2026_RULESET).advanced?.partyResults).toHaveLength(1));
  it('no fabrica RFC faltante', () => expect(()=>calculateISR(base({parties:[party('1','ENAJENANTE','100',{rfc:''})]}),ISR2026_RULESET)).toThrow(/no generará uno ficticio/));
  it('bloquea extranjero sin tratamiento vigente', () => expect(()=>calculateISR(base({parties:[party('1','ENAJENANTE','100',{fiscalResidence:'EXTRANJERO'})]}),ISR2026_RULESET)).toThrow(/tratamiento fiscal/));
  it('calcula extranjero sólo con regla y fuente confirmadas', () => {
    const result=calculateISR(base({parties:[party('1','ENAJENANTE','100',{fiscalResidence:'EXTRANJERO',foreignTreatment:{rate:'25',ruleCode:'LISR-160-V2026',source:'DOF oficial',confirmed:true}})]}),ISR2026_RULESET);
    expect(result.advanced?.partyResults[0]).toMatchObject({treatment:'FOREIGN_WITHHOLDING',provisionalFederalISR:'500000.00'});
  });
  it('aplica exención individual sin contagiar a otro vendedor', () => {
    const result=calculateISR(base({exemptionTreatment:'SOLICITADA',parties:[party('1','ENAJENANTE','50',{exemption:{amount:'100000',confirmed:true,source:'LISR versión 2026'}}),party('2','ENAJENANTE','50')]}),ISR2026_RULESET);
    expect(result.exemptIncome).toBe('100000.00'); expect(result.advanced?.partyResults.map((item)=>item.exemptIncome)).toEqual(['100000.00','0.00']);
  });

  it('calcula área exenta con regla versionada', () => expect(calculateLandExemption({enabled:true,coveredAreaM2:'100',totalAreaM2:'1000',exemptMultiplier:'3',ruleCode:'AREA-V1',ruleVersion:'2026.1',source:'DOF',confirmed:true},'500000','1000000')).toMatchObject({exemptAreaM2:'300.00',nonExemptAreaM2:'700.00',acquisitionNonExempt:'350000.00',saleNonExempt:'700000.00'}));
  it('limita área exenta al total', () => expect(calculateLandExemption({enabled:true,coveredAreaM2:'500',totalAreaM2:'600',exemptMultiplier:'5',ruleCode:'AREA-V1',ruleVersion:'2026.1',source:'DOF',confirmed:true},'500000','1000000')?.nonExemptAreaM2).toBe('0.00'));
  it('rechaza área cubierta mayor al terreno', () => expect(()=>calculateLandExemption({enabled:true,coveredAreaM2:'700',totalAreaM2:'600',exemptMultiplier:'3',ruleCode:'AREA-V1',ruleVersion:'2026.1',source:'DOF',confirmed:true},'500000','1000000')).toThrow(/superficies/));
  it('requiere versión y fuente para área exenta', () => expect(()=>calculateLandExemption({enabled:true,coveredAreaM2:'100',totalAreaM2:'600',exemptMultiplier:'3',ruleCode:'',ruleVersion:'',source:'',confirmed:true},'500000','1000000')).toThrow(/versionada/));
  it('integra área exenta en el cálculo y traza la regla', () => {
    const result=calculateISR(base({exemptionTreatment:'SOLICITADA',components:[component('t','TERRENO','2000000',[acquisition('a','2010-01-01','400000')])],landExemption:{enabled:true,coveredAreaM2:'100',totalAreaM2:'1000',exemptMultiplier:'2',ruleCode:'AREA-V1',ruleVersion:'2026.1',source:'DOF',confirmed:true}}),ISR2026_RULESET);
    expect(result.advanced?.landExemption?.ruleCode).toBe('AREA-V1'); expect(result.exemptIncome).toBe('400000.00');
  });

  it('suma N liquidaciones con catálogos y fuente', () => {
    const result=calculateISR(base({payments:[{id:'p1',paymentDate:'2026-01-01',paymentFormCode:'03',monetaryInstrumentCode:'TRANSFER',currencyCode:'MXN',amount:'100.10',source:'Estado de cuenta'},{id:'p2',paymentDate:'2026-01-02',paymentFormCode:'03',monetaryInstrumentCode:'TRANSFER',currencyCode:'MXN',amount:'200.20',source:'Estado de cuenta'}]}),ISR2026_RULESET);
    expect(result.advanced?.paymentTotal).toBe('300.30');
  });
  it('bloquea liquidación sin catálogo controlado', () => expect(()=>calculateISR(base({payments:[{id:'p1',paymentDate:'2026-01-01',paymentFormCode:'',monetaryInstrumentCode:'',currencyCode:'MXN',amount:'100',source:''}]}),ISR2026_RULESET)).toThrow(/catálogos controlados/));
  it('snapshot de reglas no se muta con escenarios avanzados', () => { const before=JSON.stringify(ISR2026_RULESET); calculateISR(base({parties:[party('1','ENAJENANTE','100')]}),ISR2026_RULESET); expect(JSON.stringify(ISR2026_RULESET)).toBe(before); });
});
