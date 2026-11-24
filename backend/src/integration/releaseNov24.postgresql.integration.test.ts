import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ArchivoService } from '../services/archivo.service';
import { ExpedienteFinanceService } from '../services/expedienteFinance.service';
import { runWithActorContext } from '../auth/actorContext';
import { permissionsForRole } from '../auth/permissions';
import { CaseSheetService } from '../services/caseSheet.service';
import { ExpedienteArtifactsService } from '../services/expedienteArtifacts.service';
import { uploadFile,downloadFile } from '../storage/storage.service';
import { Document,Packer,Paragraph } from 'docx';
import PizZip from 'pizzip';
import { createHash } from 'node:crypto';
import { DOCX_MIME } from '../services/functionalDocumentRenderer.service';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

const enabled = process.env.NOV24_QA_POSTGRES === '1';
const raw = process.env.QA_CLIENT_CASE_DATABASE_URL || '';
if (enabled) {
  const url = new URL(raw);
  if (url.hostname !== '127.0.0.1' || url.port !== '55521' || url.pathname !== '/pravia_client_qa' || url.searchParams.get('schema') !== 'pravia_os' || process.env.STORAGE_MODE !== 'local' || process.env.DATABASE_URL !== raw) throw Error('NOV24_LOCAL_QA_ONLY');
}
const db = new PrismaClient({ datasourceUrl: raw || 'postgresql://invalid/blocked' });
const org = '21110000-0000-4000-8000-000000000001', exp = '2d49eeef-6757-4c35-84f5-9a046b47b982';
let actor: any, original: any;
let publicIncome:string;const fixtures:string[]=[];const destinations:Array<{id:string;activo:boolean}>=[];
const temporaryMemberships:string[]=[];
const run = <T>(work: () => T) => runWithActorContext({ userId: actor.id, organizationId: org, membershipId: actor.membershipId, role: actor.rol, scope: actor.scope, sessionId: actor.sessionId, permissions: actor.permissions }, work);
describe.runIf(enabled)('Release Nov24: physical recipient, protocol and archive pagination', () => {
  beforeAll(async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: 'documentos.qa@pravia.test' } });
    const membership = await db.organizationMembership.findFirstOrThrow({ where: { organization_id: org, user_id: user.id, status: 'ACTIVE' } });
    actor = { id: user.id, organizationId: org, membershipId: membership.id, sessionId: randomUUID(), rol: membership.rol, scope: 'GLOBAL', permissions: permissionsForRole(membership.rol) };
    original = (await db.organization.findUniqueOrThrow({ where: { id: org } })).archive_protocol_config;
  });
  afterAll(async () => {
    if(temporaryMemberships.length)await db.organizationMembership.updateMany({where:{id:{in:temporaryMemberships}},data:{status:'INACTIVE'}});
    if(fixtures.length)await db.catalogoArtefactoDestino.updateMany({where:{artefacto_id:{in:fixtures}},data:{activo:false}});
    for(const item of destinations)await db.catalogoArtefactoDestino.update({where:{id:item.id},data:{activo:item.activo}});
    if(fixtures.length)await db.catalogoArtefacto.updateMany({where:{id:{in:fixtures}},data:{activo:false}});
    if (actor) await db.organization.update({ where: { id: org }, data: { archive_protocol_config: original ?? Prisma.DbNull } });
    await db.$disconnect();
  });
  it('persists explicit public recipient without an invented party, CFDI, payment or application', async () => {
    const finance = new ExpedienteFinanceService(db), data = await readFile('../frontend/public/icons/pravia-192.png');
    const movementCount = await db.movimientoFinanciero.count({ where: { organization_id: org } });
    const cfdiCount = await db.documentoCfdi.count({ where: { organization_id: org } });
    const key = `QA-NOV24-PUBLIC-${randomUUID()}`;
    const input = { idempotency_key: key, facturar_publico_general: true, factura_pendiente: false, forma_pago: 'EFECTIVO', concepto_contexto: 'SINTÉTICO QA · ingreso público sin validez fiscal', monto_reportado: '125.50' };
    const files = { receipt: { buffer: data, originalname: 'SINTETICO-QA-sin-validez.png', mimetype: 'image/png', size: data.length } };
    const result = await run(() => finance.reportIncome(actor, exp, input, files));
    const stored = await db.expedienteIngresoReportado.findUniqueOrThrow({ where: { id: result.item.id } });
    publicIncome=stored.id;
    expect(stored).toMatchObject({ facturar_publico_general: true, facturar_a_vinculo_id: null, facturar_a_compareciente_id: null, factura_estado: null, factura_completada_at: null, movimiento_id: null });
    expect(stored.monto_reportado?.toFixed(2)).toBe('125.50');
    const repeated = await run(() => finance.reportIncome(actor, exp, input, files)); expect(repeated.item.id).toBe(stored.id); expect(repeated.idempotent).toBe(true);
    expect(await db.movimientoFinanciero.count({ where: { organization_id: org } })).toBe(movementCount);
    expect(await db.documentoCfdi.count({ where: { organization_id: org } })).toBe(cfdiCount);
    expect(await db.auditLog.count({ where: { organization_id: org, entidad_id: stored.id, accion: 'EXP008_REPORT_INCOME' } })).toBe(1);
  });
  it('rejects public plus an existing party rather than silently choosing one', async () => {
    await expect(run(() => new ExpedienteFinanceService(db).reportIncome(actor, exp, { idempotency_key: randomUUID(), facturar_publico_general: true, facturar_a_vinculo_id: randomUUID(), forma_pago: 'EFECTIVO' }, { receipt: {} as any }))).rejects.toMatchObject({ code: 'EXP008_RECIPIENT_CONFLICT', status: 400 });
  });
  it('protocol configuration persists, audits, detects stale writes and does not alter history', async () => {
    const archive = new ArchivoService(db);
    const history = await db.archivoRegistro.findMany({ where: { organization_id: org }, orderBy: { id: 'asc' } });
    const previous = original as any;
    const input = { revision: previous?.revision ?? 0, anchor_folio:'1',anchor_libro:1,anchor_tomo:1,tomos_por_libro:3,folios_por_tomo:40,reason:'QA sintético: comprobar configuración explícita, no regla legal universal' };
    const saved = await archive.configureProtocol(actor, input);
    expect(saved.revision).toBe(input.revision + 1);
    const view = await archive.overview(actor); expect(view.protocol?.config).toEqual(saved); expect(view.libro_tomo_configured).toBe(true);
    await expect(archive.configureProtocol(actor, input)).rejects.toMatchObject({ code:'ARCHIVO_PROTOCOL_STALE', status:409 });
    expect(await db.archivoRegistro.findMany({ where: { organization_id: org }, orderBy: { id:'asc' } })).toEqual(history);
    expect(await db.auditLog.count({ where: { organization_id:org,accion:'ARCHIVO_PROTOCOL_CONFIGURED' } })).toBeGreaterThan(0);
  });
  it('denies unprivileged protocol writes in the service, not only in UI', async () => {
    await expect(new ArchivoService(db).configureProtocol({...actor,permissions:['expedientes.read']},{})).rejects.toMatchObject({status:403,code:'ARCHIVO_PROTOCOL_DENIED'});
  });
  it('uses complete counts independent of page limits and tenant-scoped exact deed search', async () => {
    const archive = new ArchivoService(db);
    const all = await archive.listRecords(actor,{page:1,pageSize:1}); expect(all.data.length).toBeLessThanOrEqual(1);
    expect(all.total).toBe(await db.archivoRegistro.count({where:{organization_id:org,clase:'INSTRUMENTO',expediente:{is:{organization_id:org}}}}));
    if(all.data[0]) { const one=await archive.listRecords(actor,{search:all.data[0].numero_escritura,page:1,pageSize:25}); expect(one.total).toBe(1); expect(one.data[0].id).toBe(all.data[0].id); }
    const other = await archive.listRecords({...actor,organizationId:'21110000-0000-4000-8000-000000000011'},{page:1,pageSize:25}); expect(other.data.every(row=>row.organization_id!==org)).toBe(true);
    await expect(archive.listRecords(actor,{page:0})).rejects.toMatchObject({status:400}); await expect(archive.listRecords(actor,{search:'otro texto'})).rejects.toMatchObject({status:400});
  });
  it('paginates nonempty real instrument assignments, exact search and missing note configuration safely',async()=>{
    const ownOrg=randomUUID();await db.organization.create({data:{id:ownOrg,name:'SINTÉTICO QA Archivo NOV24'}});
    const membership=await db.organizationMembership.create({data:{organization_id:ownOrg,user_id:actor.id,rol:'ADMINISTRACION'}});temporaryMemberships.push(membership.id);
    const who={...actor,organizationId:ownOrg};
    const archive=new ArchivoService(db);const caseIds:string[]=[];
    for(let index=0;index<4;index++){
      const id=randomUUID();caseIds.push(id);await db.expediente.create({data:{id,organization_id:ownOrg,numero_pravia:`EXP-SINTETICO-NOV24-${id}`,cliente_alias:'SINTÉTICO SIN VALIDEZ',abogado_id:actor.id,creador_id:actor.id}});
      await archive.assign(who,{expediente_id:id,numero_escritura:String(101+index),folio_inicio:String(1001+index),folio_fin:String(1001+index),fecha_instrumento:'2026-11-24',libro_tomo:'QA Libro 7 / Tomo 2'});
    }
    const first=await archive.listRecords(who,{page:1,pageSize:2}),second=await archive.listRecords(who,{page:2,pageSize:2});
    expect(first.total).toBe(4);expect(first.pages).toBe(2);expect(second.data).toHaveLength(2);expect(new Set([...first.data,...second.data].map(item=>item.id)).size).toBe(4);
    const exact=await archive.listRecords(who,{search:'102'});expect(exact.total).toBe(1);expect(exact.data[0].expediente_id).toBe(caseIds[1]);
    expect((await archive.listRecords(actor,{search:'102'})).data.every(item=>item.organization_id===org)).toBe(true);
    await expect(runWithActorContext({userId:actor.id,organizationId:ownOrg,membershipId:actor.membershipId,sessionId:actor.sessionId,role:actor.rol,scope:'GLOBAL',permissions:actor.permissions},()=>archive.generateNote(who,caseIds[0],{idempotency_key:randomUUID()}))).rejects.toMatchObject({code:'FUNCTIONAL_DESTINATION_MISSING',status:409});
  });
  const configure=async(destination:any,paragraphs:string[])=>run(async()=>{
    const previous=await db.catalogoArtefactoDestino.findMany({where:{organization_id:org,destino:destination},select:{id:true,activo:true}});destinations.push(...previous);
    await db.catalogoArtefactoDestino.updateMany({where:{id:{in:previous.map(item=>item.id)}},data:{activo:false}});
    const bytes=await Packer.toBuffer(new Document({sections:[{children:paragraphs.map(text=>new Paragraph(text))}]}));
    const id=randomUUID(),key=`organizations/${org}/qa/release-nov24/${id}.docx`;
    await uploadFile(bytes,key,DOCX_MIME);
    const artifact=await db.catalogoArtefacto.create({data:{id,organization_id:org,tipo:'FORMATO',propietario_tipo:'ORGANIZACION',nombre:`SINTÉTICO QA ${destination} SIN VALIDEZ`,creado_por_id:actor.id,actualizado_por_id:actor.id,versiones:{create:{organization_id:org,version:1,nombre_original:'SINTETICO-QA.docx',storage_key:key,mime_type:DOCX_MIME,size_bytes:bytes.length,checksum_sha256:createHash('sha256').update(bytes).digest('hex'),origen:'QA_SINTETICO',creado_por_id:actor.id}}},include:{versiones:true}});
    fixtures.push(artifact.id);
    await db.catalogoArtefactoDestino.create({data:{organization_id:org,artefacto_id:id,destino:destination,predeterminado:true,creado_por_id:actor.id,actualizado_por_id:actor.id}});
    return {artifact,bytes};
  });
  it('generates a real receipt from the applied income, retains proof, decodes QR and replays once',async()=>{
    await configure('FINANZAS_RECIBO_PAGO',['RECIBO SINTÉTICO SIN VALIDEZ FISCAL','{{comprobante.folio}}','{{expediente.folio}}','{{comprobante.importe}}','{{comprobante.qr}}','No es CFDI']);
    const finance=new ExpedienteFinanceService(db),account=await db.cuentaFinanciera.create({data:{organization_id:org,institucion:'SINTÉTICO QA',alias:`Recibos ${randomUUID()}`,tipo:'EFECTIVO',moneda:'MXN',creada_por_id:actor.id}});
    await db.categoriaFinanciera.upsert({where:{clave:'HONORARIOS'},update:{},create:{organization_id:org,clave:'HONORARIOS',nombre:'Honorarios QA',naturaleza:'DESPACHO',direccion:'INGRESO',activa:true}});
    const applied=await run(()=>finance.applyIncome(actor,exp,publicIncome,{idempotency_key:randomUUID(),monto_validado:'125.50',honorarios:'125.50',impuestos_derechos:'0',cuenta_id:account.id,forma_pago:'EFECTIVO'}));
    const key=randomUUID(),result=await run(()=>finance.generatePraviaReceipt(actor,exp,applied.item.movimiento_id!,{idempotency_key:key}));
    expect(result.item.movimiento_id).toBe(applied.item.movimiento_id);expect(result.item.ingreso_reportado_id).toBeNull();
    const bytes=await run(()=>downloadFile(result.item.documento.storage_key)),zip=new PizZip(bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(result.item.documento.checksum_sha256);
    const png=PNG.sync.read(zip.file('word/media/pravia-receipt-qr.png')!.asNodeBuffer());
    const url=jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data;expect(url).toMatch(/^http:\/\/127\.0\.0\.1:3011\/api\/expedientes\/comprobantes-pravia\/verificar\//);
    expect(await run(()=>finance.verifyReceipt(actor,url!.split('/').at(-1)!))).toMatchObject({valid:true});
    expect((await run(()=>finance.generatePraviaReceipt(actor,exp,applied.item.movimiento_id!,{idempotency_key:key}))).item.id).toBe(result.item.id);
    const read=await run(()=>finance.read(actor,exp));const income=read.ingresosReportados.find(item=>item.id===publicIncome)!;
    expect(income.documentos.some(item=>item.tipo==='COMPROBANTE_INGRESO')).toBe(true);expect(income.documentos.some(item=>item.tipo==='COMPROBANTE_PRAVIA')).toBe(true);expect(income.factura_estado).toBeNull();
    await expect(run(()=>finance.verifyReceipt({...actor,organizationId:'21110000-0000-4000-8000-000000000011'},url!.split('/').at(-1)!))).rejects.toMatchObject({status:404});
  });
  it('persists versioned case sheets, reuses bytes on replay and preserves earlier versions',async()=>{
    const {bytes:source}=await configure('EXPEDIENTE_FICHA',['FICHA SINTÉTICA SIN VALIDEZ','{{expediente.folio}}','{{expediente.cliente}}','{{expediente.valor_operacion}}']);
    const sheets=new CaseSheetService(db),key=randomUUID(),first=await run(()=>sheets.generate(actor,exp,key));
    const bytes=await run(()=>downloadFile(first.item.documento.storage_key));expect(new PizZip(bytes).file('word/styles.xml')!.asText()).toBe(new PizZip(source).file('word/styles.xml')!.asText());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(first.item.documento.checksum_sha256);
    expect((await run(()=>sheets.generate(actor,exp,key))).item.documento_id).toBe(first.item.documento_id);
    const next=await run(()=>sheets.generate(actor,exp,randomUUID()));expect(next.item.documento_id).not.toBe(first.item.documento_id);
    expect((await run(()=>sheets.read(actor,exp))).versions.some(item=>item.documento.id===first.item.documento_id)).toBe(true);
    expect(await run(()=>downloadFile(first.item.documento.storage_key))).toEqual(bytes);
    await expect(run(()=>sheets.generate({...actor,permissions:['expedientes.read']},exp,randomUUID()))).rejects.toMatchObject({status:403});
    await expect(run(()=>sheets.url({...actor,organizationId:'21110000-0000-4000-8000-000000000011'},exp,first.item.documento_id))).rejects.toMatchObject({status:403});
  });
  it('manual institution selection is versioned, tenant-checked and auditable without modifying masters',async()=>{
    const service=new ExpedienteArtifactsService(db),id=randomUUID();
    await db.catalogoInstitucion.create({data:{id,organization_id:org,nombre:`BANCO SINTÉTICO QA ${id}`,tipo:'BANCO'}});
    const before=await service.institutions(actor,exp),input={ids:[id],expected_version:before.version,reason:'QA selección manual explícita, no inferencia jurídica'};
    await run(()=>service.selectInstitutions(actor,exp,input));expect((await service.institutions(actor,exp)).selected).toContain(id);
    await expect(run(()=>service.selectInstitutions(actor,exp,input))).rejects.toMatchObject({status:409});
    await expect(service.selectInstitutions({...actor,permissions:['expedientes.read']},exp,input)).rejects.toMatchObject({status:403});
    const current=await service.institutions(actor,exp);
    await expect(run(()=>service.selectInstitutions(actor,exp,{...input,ids:[randomUUID()],expected_version:current.version}))).rejects.toMatchObject({code:'EXP006_INSTITUTION_UNAVAILABLE'});
    expect(await db.auditLog.count({where:{organization_id:org,entidad_id:exp,accion:'EXP006_INSTITUTIONS_CHANGE'}})).toBeGreaterThan(0);
  });
});
