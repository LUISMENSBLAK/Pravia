import { describe, expect, it } from 'vitest';
import { buildFiscalExportPayload, calculateAdditionalTax, calculateReferredValue, calculateSurcharges, validateFiscalExportProfile, type FiscalReferenceSnapshot } from './isrFiscalUtilities';

const ref=(type:string,code:string,value:Record<string,unknown>={}):FiscalReferenceSnapshot=>({id:`${type}-${code}`,type,code,version:1,effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',value,sourceTitle:'Fuente oficial',sourceUrl:'https://example.test/oficial'});
const surchargePolicy = () => ref('ISR_SURCHARGE_POLICY', 'CFF17A_21_POLICY', { period_mode: 'ANNIVERSARY', rate_month: 'PERIOD_START', max_months: 60, factor_decimals: 4, factor_rounding: 'DOWN', synthetic_fixture: true });
const inpc = (last = '100') => ref('INPC', 'ISR_INPC_SERIES', { base: 'SYNTHETIC_QA', months: { '2025-12': '100', '2026-01': '100', '2026-02': last }, synthetic_fixture: true });
const surchargeInput = () => ({ principal: '1000', originDate: '2026-01-01', dueDate: '2026-01-31', paymentDate: '2026-03-15', monthlyRates: [surchargePolicy(), inpc(), ref('RECARGO', '2026-02', { rate: '1.5' }), ref('RECARGO', '2026-03', { rate: '2' })] });
describe('utilidades fiscales determinísticas',()=>{
  it('calcula valor referido Decimal con snapshot',()=>expect(calculateReferredValue({amount:'1000.25',factor:'1.12345678',valuationDate:'2026-08-01',targetDate:'2020-01-01',reference:ref('INPC','INPC-2020-2026')})).toMatchObject({referredValue:'1123.74',rounding:'HALF_UP_CENT'}));
  it('rechaza referencia no fiscal',()=>expect(()=>calculateReferredValue({amount:'1',factor:'1',valuationDate:'2026-01-01',targetDate:'2020-01-01',reference:ref('OTRA','X')})).toThrow(/referencia fiscal/));
  it('rechaza referencia hacia el futuro',()=>expect(()=>calculateReferredValue({amount:'1',factor:'1',valuationDate:'2020-01-01',targetDate:'2026-01-01',reference:ref('INPC','X')})).toThrow(/posterior/));
  it.each([['1','0.01'],['1.5','0.01'],['2','0.01']] as const)('redondea HALF_UP referido %s de un centavo a %s',(factor,expected)=>expect(calculateReferredValue({amount:'0.005',factor,valuationDate:'2026-01-01',targetDate:'2020-01-01',reference:ref('FACTOR','X')}).referredValue).toBe(expected));
  it('calcula recargos mes por mes con cada fuente e INPC realmente sin variación',()=>{const result=calculateSurcharges(surchargeInput());expect(result).toMatchObject({delayMonths:2,updateAmount:'0.00',surcharges:'35.00',total:'1035.00'});expect(result.applied).toHaveLength(2);});
  it('bloquea mes faltante',()=>expect(()=>calculateSurcharges({...surchargeInput(),monthlyRates:surchargeInput().monthlyRates.filter(item=>item.code!=='2026-03')})).toThrow(/2026-03/));
  it('INPC faltante o política ausente no se presentan como cero', () => {
    expect(() => calculateSurcharges({ ...surchargeInput(), monthlyRates: surchargeInput().monthlyRates.filter(item => item.type !== 'INPC') })).toThrowError(expect.objectContaining({ code: 'SURCHARGE_INPC_MISSING' }));
    expect(() => calculateSurcharges({ ...surchargeInput(), monthlyRates: [] })).toThrowError(expect.objectContaining({ code: 'SURCHARGE_POLICY_REQUIRED' }));
  });
  it('actualiza el principal y aplica recargos al actualizado, no al original', () => {
    const input = surchargeInput(); input.monthlyRates[1] = inpc('110'); const saved = JSON.stringify(input);
    expect(calculateSurcharges(input)).toMatchObject({ updatedPrincipal: '1100.00', updateFactor: '1.1', updateAmount: '100.00', surcharges: '38.50', total: '1138.50', delayMonths: 2 });
    expect(JSON.stringify(input)).toBe(saved);
  });
  it('un día de mora dentro del mismo mes no desaparece y no necesita inventar INPC', () => {
    const input = { ...surchargeInput(), dueDate: '2026-01-17', paymentDate: '2026-01-18', monthlyRates: [surchargePolicy(), ref('RECARGO', '2026-01', { rate: '1.5' })] };
    expect(calculateSurcharges(input)).toMatchObject({ delayMonths: 1, updateAmount: '0.00', surcharges: '15.00' });
  });
  it.each([['2026-02-17', 1], ['2026-02-18', 2]] as const)('mes completo/fracción hasta %s = %s', (date, months) => {
    expect(calculateSurcharges({ ...surchargeInput(), dueDate: '2026-01-17', paymentDate: date, monthlyRates: [surchargePolicy(), inpc(), ref('RECARGO', '2026-01', { rate: '1.5' }), ref('RECARGO', '2026-02', { rate: '1.5' })] }).delayMonths).toBe(months);
  });
  it('pago puntual es cero real, sin depender de catálogo de mora', () => {
    expect(calculateSurcharges({ ...surchargeInput(), paymentDate: '2026-01-31', monthlyRates: [] })).toMatchObject({ updateAmount: '0.00', surcharges: '0.00', total: '1000.00', delayMonths: 0 });
  });
  it('factor inferior a uno no reduce la contribución', () => {
    const input = surchargeInput(); input.monthlyRates[1] = inpc('90'); expect(calculateSurcharges(input).updateFactor).toBe('1');
  });
  it('los centavos mostrados concilian exactamente principal + actualización + recargos = total', () => {
    const input = surchargeInput(); input.principal = '126288.13'; input.monthlyRates[1] = inpc('110');
    expect(calculateSurcharges(input)).toMatchObject({ principal: '126288.13', updatedPrincipal: '138916.94', updateAmount: '12628.81', surcharges: '4862.09', total: '143779.03' });
  });
  it('no permite fechas inexistentes ni tasas negativas', () => {
    expect(() => calculateSurcharges({ ...surchargeInput(), dueDate: '2026-02-30' })).toThrowError(expect.objectContaining({ code: 'SURCHARGE_DATE_INVALID' }));
    const input = surchargeInput(); input.monthlyRates[2] = ref('RECARGO', '2026-02', { rate: '-1' });
    expect(() => calculateSurcharges(input)).toThrowError(expect.objectContaining({ code: 'SURCHARGE_RATE_INVALID' }));
  });
  it('no trunca a escondidas una mora que excede el criterio aprobado', () => {
    const input = surchargeInput(); input.monthlyRates[0].value.max_months = 1;
    expect(() => calculateSurcharges(input)).toThrowError(expect.objectContaining({ code: 'SURCHARGE_PERIOD_REQUIRES_REVIEW' }));
  });
  it('conserva procedencia y usa la revisión de tasa más reciente, no el orden del array', () => {
    const input = surchargeInput(); input.monthlyRates.push({ ...ref('RECARGO', '2026-02', { rate: '2.5' }), version: 2 });
    expect(calculateSurcharges(input)).toMatchObject({ surcharges: '45.00', applied: [expect.objectContaining({ version: 2, from: '2026-02-01', to: '2026-02-28' }), expect.objectContaining({ from: '2026-03-01', to: '2026-03-15' })] });
  });
  it('bloquea fechas invertidas',()=>expect(()=>calculateSurcharges({principal:'1000',originDate:'2026-04-01',dueDate:'2026-03-01',paymentDate:'2026-02-01',monthlyRates:[]})).toThrow(/orden/));
  it('calcula impuesto adicional sólo con tasa versionada y deja la traza',()=>expect(calculateAdditionalTax({taxableBase:'1500000',reference:ref('ADQUISICION','NAY-2026',{rate:'2'})})).toMatchObject({type:'ADQUISICION',taxableBase:'1500000.00',rate:'2.00000000',tax:'30000.00',totalWithTax:'1530000.00',formula:'taxableBase × verifiedRate / 100'}));
  it('rechaza una tasa adicional fuera de rango',()=>expect(()=>calculateAdditionalTax({taxableBase:'1',reference:ref('IVA','BAD',{rate:'101'})})).toThrow(/tasa configurada/));
  it('valida perfil sin transformar ni inventar',()=>expect(validateFiscalExportProfile({input:{taxpayer:{rfc:'ABC'}}},{code:'SAT-2026',version:1,target:'SAT',fields:[{path:'input.taxpayer.rfc',required:true}]})).toMatchObject({valid:true,transformedValues:false,fictitiousValues:false}));
  it('bloquea campo obligatorio ausente con mensaje explícito',()=>expect(validateFiscalExportProfile({input:{taxpayer:{}}},{code:'UIF-2026',version:1,target:'UIF',fields:[{path:'input.taxpayer.rfc',required:true}]})).toMatchObject({valid:false,errors:[{code:'MISSING_REQUIRED',field:'input.taxpayer.rfc'}]}));
  it('rechaza códigos que no pertenecen al catálogo controlado del perfil',()=>expect(validateFiscalExportProfile({input:{operation:{instrumentTypeCode:'INVENTADO'}}},{code:'UIF-2026',version:1,target:'UIF',fields:[{path:'input.operation.instrumentTypeCode',required:true,catalog:'instrument_types'}],catalogs:{instrument_types:[{code:'ESCRITURA_PUBLICA',label:'Escritura pública'}]}})).toMatchObject({valid:false,errors:[{code:'VALUE_OUTSIDE_CATALOG',field:'input.operation.instrumentTypeCode'}]}));
  it('bloquea un perfil que declara catálogo pero no configura sus valores',()=>expect(validateFiscalExportProfile({input:{operation:{instrumentTypeCode:'ESCRITURA_PUBLICA'}}},{code:'UIF-2026',version:1,target:'UIF',fields:[{path:'input.operation.instrumentTypeCode',required:true,catalog:'instrument_types'}]})).toMatchObject({valid:false,errors:[{code:'PROFILE_CATALOG_MISSING',field:'input.operation.instrumentTypeCode'}]}));
  it('genera exactamente el mismo payload desde el mismo snapshot y respeta el mapeo de salida',()=>{const snapshot={input:{taxpayer:{rfc:'ABC010101ABC'}},calculation:{provisionalFederalISR:'123.45'}};const profile={code:'SAT-2026',version:3,target:'SAT',fields:[{path:'input.taxpayer.rfc',outputPath:'contribuyente.rfc',required:true},{path:'calculation.provisionalFederalISR',outputPath:'resultado.isr',required:true}]};const first=buildFiscalExportPayload(snapshot,profile);const second=buildFiscalExportPayload(snapshot,profile);expect(first).toEqual(second);expect(first).toMatchObject({data:{contribuyente:{rfc:'ABC010101ABC'},resultado:{isr:'123.45'}},transformedValues:false,fictitiousValues:false});});
  it.each(['rfc','curp','representative.rfc','property.registry','payments.0.form'])('no fabrica %s',(path)=>{const result=validateFiscalExportProfile({}, {code:'SAFE',version:1,target:'SAT',fields:[{path,required:true}]});expect(result.valid).toBe(false);expect(result.fictitiousValues).toBe(false);});
});
