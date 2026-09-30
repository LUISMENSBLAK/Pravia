import { Prisma, PresupuestoConceptoCategoria } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { buildComparableProposal, verifiedKnowledgeVersionAt } from './quoteAIProposal.service';

const row=(concepto:string,importe:string,cotizacion_id:string,categoria:PresupuestoConceptoCategoria=PresupuestoConceptoCategoria.HONORARIOS)=>({concepto,categoria,importe:new Prisma.Decimal(importe),cotizacion_id});
describe('COT-IA-001 proposal math',()=>{
  it('usa mediana y no promedio sensible a outliers',()=>expect(buildComparableProposal([row('Honorarios','100','q1'),row('Honorarios','110','q2'),row('Honorarios','9999','q3')])[0]).toMatchObject({importe:110,explanation:{sample_size:3,range:{min:100,median:110,max:9999}}}));
  it('mediana par usa los dos valores centrales',()=>expect(buildComparableProposal([row('Honorarios','100','q1'),row('Honorarios','200','q2')])[0].importe).toBe(150));
  it('no cuenta dos conceptos de la misma cotización como dos comparables',()=>expect(buildComparableProposal([row('Honorarios','100','q1'),row('honorarios','200','q1')])[0].explanation.sample_size).toBe(1));
  it('no mezcla un concepto comercial con un homónimo fiscal',()=>expect(buildComparableProposal([row('Avalúo profesional','100','q1'),row('Avalúo profesional','200','q2',PresupuestoConceptoCategoria.IMPUESTOS_DERECHOS)])).toEqual([expect.objectContaining({importe:100,categoria:PresupuestoConceptoCategoria.HONORARIOS})]));
  it('produce propuesta vacía sin históricos validados',()=>expect(buildComparableProposal([])).toEqual([]));
  it('excluye IVA, impuestos y derechos del histórico porque requieren regla determinística',()=>expect(buildComparableProposal([row('Honorarios','100','q1'),row('IVA','16','q1',PresupuestoConceptoCategoria.IVA_HONORARIOS),row('ISABI','250','q1',PresupuestoConceptoCategoria.IMPUESTOS_DERECHOS)])).toEqual([expect.objectContaining({concepto:'Honorarios',categoria:PresupuestoConceptoCategoria.HONORARIOS})]));
  it('selecciona fundamento verificado y vigente para la fecha jurídicamente relevante',()=>{const date=new Date('2026-09-26T00:00:00.000Z');expect(verifiedKnowledgeVersionAt(date)).toEqual({verification_status:'VERIFICADA',effective_from:{lte:date},OR:[{effective_to:null},{effective_to:{gte:date}}]});});
  it.each([['100.005',100.01],['100.004',100],['0.01',0.01]] as const)('redondea honorario %s a %s',(amount,expected)=>expect(buildComparableProposal([row('Honorarios',amount,'q1')])[0].importe).toBe(expected));
});
