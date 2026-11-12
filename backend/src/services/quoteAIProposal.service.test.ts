import { Prisma, PresupuestoConceptoCategoria } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { approvedInternalBudgetRows, buildComparableProposal, verifiedKnowledgeVersionAt, QuoteAIProposalService } from './quoteAIProposal.service';
import { readQuoteTerritory, territoryApplies } from '../domain/quoteTerritory';

const territory = { jurisdiction: 'NAYARIT', state: 'NAYARIT', municipality: 'TEPIC', confirmedById: 'qa', confirmedAt: '2026-11-11T12:00:00Z' };

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
  it('usa sólo el arancel interno explícito, revisado, aprobado, vigente y aplicable al acto',()=>{
    const rows=approvedInternalBudgetRows([
      {id:'c1',code:'ARI-001',title:'Honorarios compraventa',scope:{kind:'ARANCEL_PROPIO',jurisdiction:'NAYARIT',state:'NAYARIT',municipality:'TEPIC',approval_status:'APROBADO',review_status:'REVISADO',act:'COMPRAVENTA',effective_from:'2026-01-01',fixed_honorarium:'12500.00',version:2}},
      {id:'c2',code:'BOR-001',title:'Borrador',scope:{kind:'ARANCEL_PROPIO',approval_status:'BORRADOR',review_status:'PENDIENTE',act:'COMPRAVENTA',fixed_honorarium:'99999.00'}},
      {id:'c3',code:'OTRO-001',title:'Otro acto',scope:{kind:'ARANCEL_PROPIO',approval_status:'APROBADO',review_status:'REVISADO',act:'DONACIÓN',fixed_honorarium:'5000.00'}},
    ],'compraventa',new Date('2026-11-10T12:00:00Z'),territory);
    expect(rows).toEqual([expect.objectContaining({concepto:'Honorarios compraventa',importe:12500,
      explanation:expect.objectContaining({layer:'CRITERIO_INTERNO_APROBADO',version:2})})]);
  });
});

describe('territorio confirmado y aplicabilidad conservadora', () => {
  it.each([null, {}, { ...territory, confirmedById: '' }, { ...territory, confirmedAt: 'invalid' }, { ...territory, state: '' }])('no inventa territorio ni confirmación: %j', (value) => expect(readQuoteTerritory(value)).toBeNull());
  it('acepta dato explícito sin municipio, pero no un ámbito municipal', () => {
    const value = readQuoteTerritory({ ...territory, municipality: null });
    expect(territoryApplies({ jurisdiction: 'Nayarit', state: 'Nayarit' }, value)).toBe(true);
    expect(territoryApplies({ jurisdiction: 'Nayarit', municipality: 'Tepic' }, value)).toBe(false);
  });
  it('ignora sólo diferencias de acentos, caja y espacios, no infiere equivalencias', () => {
    expect(territoryApplies({ jurisdiction: '  nayárit ', state: 'nayarit', municipality: 'tépíc' }, territory)).toBe(true);
    expect(territoryApplies({ jurisdiction: 'MÉXICO' }, territory)).toBe(false);
  });
  it.each([{ jurisdiction: 'JALISCO' }, { jurisdiction: 'NAYARIT', state: 'JALISCO' }, { jurisdiction: 'NAYARIT', municipality: 'BAHÍA DE BANDERAS' }, {}, { jurisdiction: 'NAYARIT', municipality: 123 }])('rechaza ámbito diferente o indeterminado %j', (scope) => expect(territoryApplies(scope, territory)).toBe(false));
  it('no aplica ningún arancel sin territorio confirmado', () => {
    expect(approvedInternalBudgetRows([{ id:'x',code:'x',title:'x',scope:{ kind:'ARANCEL_PROPIO',jurisdiction:'NAYARIT',approval_status:'APROBADO',review_status:'REVISADO',fixed_honorarium:'100' } }], 'COMPRAVENTA')).toEqual([]);
  });
});

describe('decisión de propuesta: revisión, concurrencia y permisos', () => {
  const actor: any = { id:'u',organizationId:'org',rol:'DIRECCION',scope:'GLOBAL',permissions:['cotizaciones.write','ai.use'] };
  const now = new Date('2026-11-11T12:00:00Z');
  const scope = { kind:'ARANCEL_PROPIO',jurisdiction:'NAYARIT',state:'NAYARIT',municipality:'TEPIC',approval_status:'APROBADO',review_status:'REVISADO',fixed_honorarium:'100',version:2,act:'COMPRAVENTA' };
  const setup = (overrides: Record<string, any> = {}) => {
    const quote = { id:'q',updated_at:now,territorio_operacion:territory,prospecto:{ tipo_acto:'COMPRAVENTA' },etapa_contractual:'EN_ELABORACION',...overrides.quote };
    const proposal = { id:'p',status:'PENDIENTE',model_version:'PRAVIA-COT-IA-001/layered-v3',
      evidence_packet:{ quote_updated_at:now.toISOString(),operation_territory:territory,layers:{ internal_policy:[{ criterion_id:'c',scope }] } },
      proposal:{ concepts:[{ categoria:'HONORARIOS',concepto:'QA',importe:100 }] },...overrides.proposal };
    const tx:any = { $executeRaw:vi.fn(),cotizacion:{ findFirst:vi.fn().mockResolvedValue(quote),update:vi.fn() },
      cotizacionIAProposal:{ findFirst:vi.fn().mockResolvedValue(proposal),update:vi.fn().mockImplementation(({data})=>({...proposal,...data})),updateMany:vi.fn() },
      cotizacionConcepto:{ deleteMany:vi.fn(),createMany:vi.fn() },knowledgeCriterion:{ findMany:vi.fn().mockResolvedValue(overrides.criteria ?? [{ id:'c',code:'c',title:'QA',scope }]) },auditLog:{ create:vi.fn() } };
    const db:any = { ...tx,$transaction:vi.fn((cb)=>cb(tx)) };
    return { tx,service:new QuoteAIProposalService(db) };
  };
  it.each([{ proposal:{ model_version:'PRAVIA-COT-IA-001/layered-v2' } },{ quote:{ updated_at:new Date('2026-11-11T12:00:01Z') } },{ quote:{ territorio_operacion:{...territory,municipality:'OTRO'} } }])('rechaza snapshot obsoleto sin cambiar conceptos %j', async (overrides) => {
    const {tx,service}=setup(overrides);
    await expect(service.decide(actor,'q','p',{action:'APLICAR'})).rejects.toMatchObject({ code:'QUOTE_AI_STALE',status:409 });
    expect(tx.cotizacionConcepto.deleteMany).not.toHaveBeenCalled();
  });
  it.each([[],[{ id:'c',code:'c',title:'QA',scope:{...scope,version:3} }],[{ id:'c',code:'c',title:'QA',scope:{...scope,municipality:'OTRO'} }],[{ id:'c',code:'c',title:'QA',scope:{...scope,effective_to:'2026-01-01'} }]].map((criteria) => ({ criteria })))('revalida aprobación, territorio y versión al aplicar %j', async ({ criteria }) => {
    const {tx,service}=setup({ criteria });
    await expect(service.decide(actor,'q','p',{action:'APLICAR'})).rejects.toMatchObject({ code:'QUOTE_AI_POLICY_CHANGED',status:409 });
    expect(tx.cotizacionConcepto.deleteMany).not.toHaveBeenCalled();
  });
  it('aplica sólo snapshot vigente y conserva una decisión idempotente', async () => {
    const {tx,service}=setup();
    expect(await service.decide(actor,'q','p',{action:'APLICAR'})).toMatchObject({ applied:true,idempotent:false });
    expect(tx.cotizacionConcepto.createMany).toHaveBeenCalledWith({ data:expect.arrayContaining([expect.objectContaining({ organization_id:'org',cotizacion_id:'q',importe:'100.00' }),expect.objectContaining({ categoria:'IVA_HONORARIOS',importe:'16.00' })]) });
    tx.cotizacionIAProposal.findFirst.mockResolvedValue({id:'p',status:'APLICADA'});
    expect(await service.decide(actor,'q','p',{action:'APLICAR'})).toMatchObject({applied:true,idempotent:true});
    expect(tx.cotizacionConcepto.deleteMany).toHaveBeenCalledTimes(1);
  });
  it('no expone una propuesta idempotente antes de comprobar object access', async () => {
    const {tx,service}=setup();tx.cotizacion.findFirst.mockResolvedValue(null);
    await expect(service.generate(actor,'q',{idempotency_key:'known-key'})).rejects.toMatchObject({ status:404 });
    expect(tx.cotizacionIAProposal.findFirst).not.toHaveBeenCalled();
  });
  it('rechaza falta de permiso antes de acceder a la base', async () => {
    const {tx,service}=setup();
    await expect(service.decide({...actor,permissions:[]},'q','p',{action:'APLICAR'})).rejects.toMatchObject({ status:403 });
    expect(tx.cotizacion.findFirst).not.toHaveBeenCalled();
  });
});
