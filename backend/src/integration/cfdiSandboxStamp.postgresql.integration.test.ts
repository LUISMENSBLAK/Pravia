import { randomUUID, createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CfdiSandboxStampService } from '../services/cfdiSandboxStamp.service';
import { FinanceFiscalService, type FiscalActor } from '../services/financeFiscal.service';
import { FacturamaSandboxError } from '../services/facturamaSandboxProvider';
import { downloadFile } from '../services/supabase.service';
import type { CfdiProviderDraft } from '../services/cfdiProvider';
import { runWithActorContext } from '../auth/actorContext';

const target = process.env.CFDI_SANDBOX_QA_DATABASE_URL;
if (target) {
  for (const raw of [target, process.env.DATABASE_URL || '']) {
    const url = new URL(raw); if (url.hostname !== '127.0.0.1' || url.port !== '55521' || url.pathname !== '/pravia_client_qa' || url.searchParams.get('schema') !== 'pravia_os') throw Error('ISOLATED_CFDI_SANDBOX_QA_DATABASE_REQUIRED');
  }
}
const db = target ? new PrismaClient({ datasourceUrl: target }) : null;
const org = randomUUID(), user = randomUUID(), entityId = randomUUID();
const actor: FiscalActor = { id: user, organizationId: org, rol: 'ADMINISTRACION', permissions: ['finanzas.validate', 'finanzas.write', 'documentos.write', 'documentos.read'] };
const runStamp = (service: CfdiSandboxStampService, who: FiscalActor, id: string, input: Record<string, unknown>) => runWithActorContext({ userId: who.id, organizationId: who.organizationId,
  membershipId: user, sessionId: 'synthetic-sandbox-qa', role: who.rol, permissions: who.permissions, scope: 'GLOBAL' }, () => service.stamp(who, id, input));
const d = (n: string) => new Prisma.Decimal(n);
async function makeDraft() {
  return db!.documentoCfdi.create({ data: { organization_id: org, entidad_fiscal_id: entityId, direccion: 'EMITIDO', tipo: 'I', estado: 'DRAFT', source: 'LOCAL_DRAFT', internal_folio: `QA-${randomUUID()}`,
    emisor_rfc: 'EKU9003173C9', emisor_nombre: 'ESCUELA KEMPER URGATE', receptor_rfc: 'URE180429TM6', receptor_nombre: 'UNIVERSIDAD ROBOTICA ESPAÑOLA', receptor_regimen: '601', receptor_codigo_postal: '86991', uso_cfdi: 'G03', metodo_pago: 'PPD', forma_pago: '99', moneda: 'MXN', subtotal: d('100'), impuestos_trasladados: d('16'), total: d('116'), saldo: d('116'), idempotency_key: randomUUID(), created_by_id: user,
    draft_payload: { fiscal_comprobante: { lugar_expedicion: '42501', exportacion: '01', regimen_emisor: '601' }, concepts: [{ clave_prod_serv: '80121601', clave_unidad: 'E48', descripcion: 'CONTRACT FIXTURE SYNTHETIC — NOT A PROVIDER RESULT', cantidad: '1', valor_unitario: '100', subtotal: '100', total: '116', objeto_impuesto: '02', iva: '16', iva_tasa: '0.16', iva_retencion: '0', isr_retencion: '0' }] } } });
}
// Deliberately synthetic contract result, never used as external certification.
const result = (draft: CfdiProviderDraft) => {
  const uuid = randomUUID(), p = draft.facturamaPayload!;
  return { uuid, providerReference: `synthetic-${randomUUID()}`, pdf: Buffer.from('%PDF-1.7 SYNTHETIC CONTRACT FILE'),
    xml: Buffer.from(`<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Folio="${p.Folio}" Fecha="${p.Date}" SubTotal="100.00" Total="116.00" Moneda="MXN" TipoDeComprobante="I"><cfdi:Emisor Rfc="EKU9003173C9" Nombre="ESCUELA KEMPER URGATE"/><cfdi:Receptor Rfc="URE180429TM6" Nombre="UNIVERSIDAD ROBOTICA ESPAÑOLA"/><cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="${uuid}" FechaTimbrado="${p.Date}"/></cfdi:Complemento></cfdi:Comprobante>`) };
};
const provider = () => ({ id: 'FACTURAMA_SANDBOX', configured: true, stamp: vi.fn(async (draft: CfdiProviderDraft) => result(draft)), cancel: vi.fn(), recover: vi.fn() });
describe.runIf(Boolean(target))('CFDI sandbox canonical orchestration · physical local PostgreSQL/Storage', () => {
  beforeAll(async () => {
    expect(process.env.STORAGE_MODE).toBe('local');expect(process.env.CFDI_PROVIDER).toBe('FACTURAMA_SANDBOX');
    await db!.organization.create({ data: { id: org, name: 'SYNTHETIC QA sandbox orchestration' } });
    await db!.tenantEntitlement.create({ data: { organization_id: org, included_storage_bytes: 1024n * 1024n, total_storage_capacity_bytes: 1024n * 1024n } });
    await db!.tenantStorageUsage.create({ data: { organization_id: org } });
    await db!.user.create({ data: { id: user, email: `sandbox-${user}@example.test`, nombre: 'QA', apellido: 'Sintético', password_hash: 'no-login-synthetic', rol: 'ADMINISTRACION' } });
    await db!.organizationMembership.create({ data: { organization_id: org, user_id: user, rol: 'ADMINISTRACION' } });
    await db!.entidadFiscalCfdi.create({ data: { id: entityId, organization_id: org, rfc: 'EKU9003173C9', razon_social: 'ESCUELA KEMPER URGATE', regimen_fiscal: '601', codigo_postal: '42501', created_by_id: user } });
  });
  afterAll(async () => { await db?.$disconnect(); });
  it('commits snapshot before provider, persists files/checksums/audit, reload and repeated request use same document', async () => {
    const row = await makeDraft(), p = provider();
    p.stamp.mockImplementationOnce(async (draft) => {
      const current = await db!.documentoCfdi.findUniqueOrThrow({ where: { id: row.id } });
      expect(current.estado).toBe('TIMBRANDO_SANDBOX');expect((current.draft_payload as any).sandbox_stamp.payload).toEqual(draft.facturamaPayload);
      return result(draft);
    });
    const service = new CfdiSandboxStampService(db!, p);
    const first = await runStamp(service,actor, row.id, { expected_updated_at: row.updated_at.toISOString() });
    const saved = await db!.documentoCfdi.findUniqueOrThrow({ where: { id: row.id }, include: { xmlDocumento: true, pdfDocumento: true } });
    expect(saved.estado).toBe('TIMBRADO_SANDBOX');expect(saved.uuid_fiscal).toBe(first.cfdi.uuid_fiscal);
    for (const file of [saved.xmlDocumento!, saved.pdfDocumento!]) expect(createHash('sha256').update(await downloadFile(file.storage_key)).digest('hex')).toBe(file.checksum_sha256);
    const repeated=await runStamp(service,actor, row.id, {});
    expect(repeated).toMatchObject({ idempotent: true, fiscalValidity: false });expect(p.stamp).toHaveBeenCalledTimes(1);
    expect(()=>JSON.stringify(repeated)).not.toThrow();expect(repeated.cfdi).not.toHaveProperty('entidadFiscal');
    expect(await db!.auditLog.count({ where: { organization_id: org, entidad_id: row.id, accion: 'COMPLETE_SANDBOX_CFDI' } })).toBe(1);
    expect(await db!.movimientoFinanciero.count({ where: { organization_id: org } })).toBe(0);
    expect(await db!.cuentaPorCobrarCfdi.count({ where: { cfdi_id: row.id } })).toBe(0);
    await expect(new FinanceFiscalService(db!).updateDraft(actor, row.id, { total: '1' })).rejects.toMatchObject({ code: 'CFDI_FISCAL_IMMUTABLE' });
    await expect(new FinanceFiscalService(db!).deleteDraft(actor, row.id)).rejects.toMatchObject({ code: 'CFDI_FISCAL_IMMUTABLE' });
    await expect(new FinanceFiscalService(db!).applyPayment(actor, row.id, { monto: '1', movimiento_id: randomUUID(), idempotency_key: randomUUID() })).rejects.toMatchObject({ code: 'CFDI_SANDBOX_PAYMENT_FORBIDDEN' });
    expect(await new FinanceFiscalService(db!).prepareRep(actor, row.id)).toMatchObject({ eligible: false, providerCall: false });
  });
  it('two simultaneous requests allow exactly one provider POST', async () => {
    const row = await makeDraft(), p = provider();let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});
    p.stamp.mockImplementationOnce(async (draft)=>{await wait;return result(draft);});
    const service=new CfdiSandboxStampService(db!,p);const first=runStamp(service,actor,row.id,{expected_updated_at:row.updated_at.toISOString()});
    await vi.waitFor(()=>expect(p.stamp).toHaveBeenCalledTimes(1));
    await expect(runStamp(service,actor,row.id,{expected_updated_at:row.updated_at.toISOString()})).rejects.toMatchObject({code:'CFDI_STAMP_IN_PROGRESS'});release();await first;expect(p.stamp).toHaveBeenCalledTimes(1);
  });
  it('unknown response stays durable and cannot trigger another POST', async () => {
    const row=await makeDraft(),p=provider();p.stamp.mockRejectedValueOnce(new FacturamaSandboxError('FACTURAMA_OUTCOME_UNKNOWN','Unknown result'));
    const service=new CfdiSandboxStampService(db!,p);await expect(runStamp(service,actor,row.id,{expected_updated_at:row.updated_at.toISOString()})).rejects.toMatchObject({code:'FACTURAMA_OUTCOME_UNKNOWN'});
    expect((await db!.documentoCfdi.findUniqueOrThrow({where:{id:row.id}})).estado).toBe('RECUPERAR_SANDBOX');
    p.recover.mockRejectedValueOnce(new FacturamaSandboxError('FACTURAMA_RECONCILIATION_PENDING','No unique reference',409));
    await expect(runStamp(service,actor,row.id,{})).rejects.toMatchObject({code:'FACTURAMA_RECONCILIATION_PENDING'});expect(p.stamp).toHaveBeenCalledTimes(1);expect(p.recover).toHaveBeenCalledTimes(1);
  });
  it('known provider reference recovers XML/PDF without restamping or changing folio/date',async()=>{
    const row=await makeDraft(),p=provider();let prior!:ReturnType<typeof result>;
    p.stamp.mockImplementationOnce(async draft=>{prior=result(draft);throw new FacturamaSandboxError('FACTURAMA_PDF_RECOVERY_REQUIRED','Recover PDF',502,prior.providerReference);});
    p.recover.mockImplementationOnce(async (_draft,reference)=>{expect(reference).toBe(prior.providerReference);return prior;});
    const service=new CfdiSandboxStampService(db!,p);await expect(runStamp(service,actor,row.id,{expected_updated_at:row.updated_at.toISOString()})).rejects.toThrow();
    const pending=await db!.documentoCfdi.findUniqueOrThrow({where:{id:row.id}});const snapshot=(pending.draft_payload as any).sandbox_stamp.payload;
    await runStamp(service,actor,row.id,{});expect(p.stamp).toHaveBeenCalledTimes(1);expect(p.recover).toHaveBeenCalledTimes(1);expect(p.recover.mock.calls[0][0].facturamaPayload).toEqual(snapshot);
  });
  it('rejects unauthorized, cross-tenant, stale snapshot and customer RFC before provider',async()=>{
    const row=await makeDraft(),p=provider(),service=new CfdiSandboxStampService(db!,p);
    await expect(runStamp(service,{...actor,permissions:[]},row.id,{})).rejects.toMatchObject({status:403});
    await expect(runStamp(service,{...actor,organizationId:randomUUID()},row.id,{})).rejects.toMatchObject({status:404});
    await expect(runStamp(service,actor,row.id,{expected_updated_at:'2020-01-01'})).rejects.toMatchObject({code:'CFDI_DRAFT_CHANGED'});
    const changed=await db!.documentoCfdi.update({where:{id:row.id},data:{receptor_rfc:'REAL010101AA1'}});
    await expect(runStamp(service,actor,row.id,{expected_updated_at:changed.updated_at.toISOString()})).rejects.toThrow();expect(p.stamp).not.toHaveBeenCalled();
  });
  it('does not accept an assigned-object user merely because the invoice is in the same organization',async()=>{
    const row=await makeDraft(),p=provider(),service=new CfdiSandboxStampService(db!,p);
    const expediente=await db!.expediente.create({data:{organization_id:org,numero_pravia:`QA-SANDBOX-${randomUUID()}`,creador_id:user,abogado_id:user}});
    const linked=await db!.documentoCfdi.update({where:{id:row.id},data:{expediente_id:expediente.id}});
    await expect(runStamp(service,{...actor,id:randomUUID(),rol:'ABOGADO'},row.id,{expected_updated_at:linked.updated_at.toISOString()})).rejects.toMatchObject({status:404});
    expect(p.stamp).not.toHaveBeenCalled();
  });
  it('a Storage failure retains the provider reference, then restores files without another POST',async()=>{
    const row=await makeDraft(),p=provider(),service=new CfdiSandboxStampService(db!,p);let stamped!:ReturnType<typeof result>;
    p.stamp.mockImplementationOnce(async(draft)=>{stamped=result(draft);return stamped;});
    await db!.tenantEntitlement.update({where:{organization_id:org},data:{included_storage_bytes:0n,total_storage_capacity_bytes:0n}});
    try { await expect(runStamp(service,actor,row.id,{expected_updated_at:row.updated_at.toISOString()})).rejects.toMatchObject({code:'CFDI_SANDBOX_RECOVERY_REQUIRED'}); }
    finally {await db!.tenantEntitlement.update({where:{organization_id:org},data:{included_storage_bytes:1024n*1024n,total_storage_capacity_bytes:1024n*1024n}});}
    const pending=await db!.documentoCfdi.findUniqueOrThrow({where:{id:row.id}});expect(pending.provider_reference).toBe(stamped.providerReference);expect(pending.xml_documento_id).toBeNull();
    p.recover.mockResolvedValueOnce(stamped);await runStamp(service,actor,row.id,{});expect(p.stamp).toHaveBeenCalledTimes(1);expect(p.recover).toHaveBeenCalledTimes(1);
  });
  it('a stale in-flight claim is reconciled by GET, never sent again for stamping',async()=>{
    const row=await makeDraft(),p=provider(),service=new CfdiSandboxStampService(db!,p);
    p.stamp.mockRejectedValueOnce(new FacturamaSandboxError('FACTURAMA_OUTCOME_UNKNOWN','Unknown result'));
    await expect(runStamp(service,actor,row.id,{expected_updated_at:row.updated_at.toISOString()})).rejects.toThrow();
    const pending=await db!.documentoCfdi.findUniqueOrThrow({where:{id:row.id}});const saved=pending.draft_payload as any;
    saved.sandbox_stamp={...saved.sandbox_stamp,status:'IN_FLIGHT',started_at:new Date(Date.now()-240000).toISOString()};
    await db!.documentoCfdi.update({where:{id:row.id},data:{estado:'TIMBRANDO_SANDBOX',draft_payload:saved}});
    p.recover.mockImplementationOnce(async draft=>result(draft));await runStamp(service,actor,row.id,{});expect(p.stamp).toHaveBeenCalledTimes(1);expect(p.recover).toHaveBeenCalledTimes(1);
  });
});
