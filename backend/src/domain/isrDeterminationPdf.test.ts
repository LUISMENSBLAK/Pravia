import { describe, expect, it } from 'vitest';
import { calculateISR, ISR2026_RULESET } from './isrTaxEngine';
import { renderISRDeterminationPdf } from './isrDeterminationPdf';

const input:any={operationType:'ENAJENACION_INMUEBLE',taxYear:2026,taxpayer:{fullName:'Persona Controlada',rfc:'AAAA800101AA1',personType:'FISICA',fiscalResidence:'MEXICO',confirmed:true},property:{description:'Inmueble controlado',landAndConstructionSameAcquisitionDate:true},acquisitionDate:'2016-01-01',saleDate:'2026-08-17',yearsElapsed:10,salePrice:'2000000.00',deductions:[{id:'d1',concept:'Costo actualizado',historicalAmount:'1000000.00',updatedAmount:'1200000.00',expenseDate:'2016-01-01',updateOrigin:'MANUAL_CONFIRMED',updateMethod:'Manual',treatment:'COSTO_ADQUISICION_ACTUALIZADO',included:true,confirmed:true,supportDocumentId:'doc-1',reason:'LISR',confirmedBy:'user-1',confirmedAt:'2026-08-17T00:00:00Z'}],exemptionTreatment:'NO_APLICA_CONFIRMADO',ordinaryCaseConfirmed:true,specialCases:[],iva:{applies:false,suggestedFromProperty:false}};

describe('PDF ISR-001',()=>{
  it('presenta exactamente el resultado inmutable sin ejecutar otra fórmula fiscal',()=>{const result=calculateISR(input,ISR2026_RULESET);const pdf=renderISRDeterminationPdf({folio:'ISR-2026-TEST',version:1,generatedDate:'2026-08-31',input,result,formatSource:'CONFIGURACION:formato-1:V2'}).toString('latin1');expect(pdf.startsWith('%PDF-1.4')).toBe(true);expect(pdf).toContain('46659.42');expect(pdf).toContain('CONFIGURACION:formato-1:V2');expect(pdf).toContain(result.ruleSet.version);});
});
