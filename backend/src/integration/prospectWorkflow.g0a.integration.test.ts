import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { ProspectWorkflowService } from '../services/prospectWorkflow.service';
import { tenantIsolationMiddleware } from '../config/tenantPrisma';
import { runWithActorContext } from '../auth/actorContext';
import { getAllowedCotizacionTransitions, validateCotizacionTransition } from '../domain/cotizacionWorkflow';

// Deliberately cannot inherit DATABASE_URL or credentials from .env.
const url = 'postgresql://postgres:test@127.0.0.1:55440/pravia_g0a?schema=pravia_os';
const db = new PrismaClient({ datasources: { db: { url } } });
const scoped = new PrismaClient({ datasources: { db: { url } } });
scoped.$use(tenantIsolationMiddleware);
let failAudit = false;
scoped.$use(async (params, next) => {
  if (failAudit && params.model === 'AuditLog' && params.action === 'create') throw new Error('test-audit-failure');
  return next(params);
});
const service = new ProspectWorkflowService(scoped, async (key) => !key.includes('missing'));
type Actor = NonNullable<Request['user']>;
const actor = (n: number): Actor => ({
  id: `20000000-0000-4000-8000-00000000000${n}`, organizationId: `10000000-0000-4000-8000-00000000000${n}`,
  membershipId: `30000000-0000-4000-8000-00000000000${n}`, sessionId: randomUUID(), rol: 'ADMINISTRACION',
  nombre: 'Prueba', apellido: String(n), email: `g0a-${n}@example.test`, scope: 'GLOBAL', requiresPasswordChange: false,
  permissions: ['prospectos.read','prospectos.write','documentos.read','documentos.write','cotizaciones.read','cotizaciones.write','notarias.read'],
});
const a = actor(1), b = actor(2);
const run = <T>(who: Actor, fn: () => T) => runWithActorContext({ userId: who.id, organizationId: who.organizationId,
  membershipId: who.membershipId, sessionId: who.sessionId, role: who.rol, permissions: who.permissions, scope: who.scope }, fn);
const create = (who = a, key = randomUUID()) => run(who, () => service.create(who, { nombre: '  oportunidad   sintética ' }, key)).then((r) => r.prospecto);
const read = (id: string, who = a) => run(who, () => service.read(who, id));
const act = async (id: string, action: string, extra: Record<string, unknown> = {}, who = a) => {
  const p = await db.prospecto.findUniqueOrThrow({ where: { id } });
  return run(who, () => service.act(who, id, { action, expectedVersion: p.version_operativa, confirm: true, idempotencyKey: randomUUID(), ...extra }));
};
const doc = (p: { id: string; organization_id: string | null; user_id: string }, overrides = {}) => db.documento.create({ data: {
  organization_id: p.organization_id, prospecto_id: p.id, subido_por_id: p.user_id, tipo: 'OTRO',
  nombre_original: 'Respuesta sintética.pdf', nombre_interno: randomUUID(), storage_key: `organizations/${p.organization_id}/documentos/${randomUUID()}`,
  mime_type: 'application/pdf', size_bytes: 100, ...overrides,
} });
const ready = async (who = a) => {
  const p = await create(who);
  await run(who, () => service.update(who, p.id, { expectedVersion: p.version_operativa, notaria_id: `40000000-0000-4000-8000-00000000000${who === b ? 2 : 1}` }));
  await act(p.id, 'MARCAR_LISTO', {}, who); return p;
};
const sendPayload = () => ({ effectiveAt: new Date().toISOString(), channel: 'Correo electrónico', recipient: 'notaria@example.test', evidence: 'Envío confirmado por el actor', content: 'Texto revisado', attachmentIds: [] });
const waiting = async () => { const p = await ready(); await act(p.id, 'REGISTRAR_ENVIO', sendPayload()); return p; };
const received = async () => { const p = await waiting(); const d = await doc(p); await act(p.id, 'REGISTRAR_RECEPCION', { documentId: d.id, effectiveAt: new Date().toISOString() }); return { p, d }; };
const mutation = (who: Actor, id: string, payload: Record<string, unknown>) => run(who, () => service.act(who, id, payload));

describe.runIf(process.env.G0A_RUN_ISOLATED === '1')('G0-A PostgreSQL aislado · hechos, carreras y migración', () => {
  beforeAll(async () => {
    const [database] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(database.name).toBe('pravia_g0a');
  });
  afterAll(async () => { await Promise.all([db.$disconnect(), scoped.$disconnect()]); });

  it('baseline → latest: 30 migraciones y cero registros históricos alterados', async () => {
    const count = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pravia_os._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(Number(count[0].count)).toBe(30);
    const before = await db.$queryRaw<Array<{ entity: string; row: Record<string, unknown> }>>`SELECT * FROM public.g0a_before`;
    expect(before).toHaveLength(50);
    for (const item of before) {
      // Table names derive exclusively from the static synthetic fixture, never HTTP input.
      expect(['prospectos','prospecto_seguimientos','cotizaciones','expedientes','documentos','organizations','audit_logs']).toContain(item.entity);
      const [current] = await db.$queryRawUnsafe<Array<{ row: Record<string, unknown> }>>(`SELECT to_jsonb(t) AS row FROM pravia_os.${item.entity} t WHERE id=$1::uuid`, item.row.id);
      expect(current.row).toMatchObject(item.row);
    }
    // Verify the exact 11 UUIDs without inferring stage dates from any legacy timestamp.
    const rows = await db.prospecto.findMany({ where: { id: { in: Array.from({ length: 11 }, (_, i) => `50000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`) } } });
    expect(rows).toHaveLength(11);
    expect(rows.every((r) => r.etapa_contractual === null && r.transicion_actual_id === null && r.folio === null && r.version_operativa === 0)).toBe(true);
  });
  it('alta mínima → Nuevo, folio, evento, actor, tenant y auditoría atómicos', async () => {
    const p = await create(); const w = await read(p.id);
    expect(p.nombre).toBe('OPORTUNIDAD SINTÉTICA'); expect(p.folio).toMatch(/^PRO-\d{4}-\d{4}$/);
    expect(w.stage).toBe('NUEVO'); expect(w.events).toHaveLength(1);
    expect(w.stageEnteredAt?.getTime()).toBe(w.events[0].effectiveAt.getTime());
    const e = await db.prospectoTransicion.findFirstOrThrow({ where: { prospecto_id: p.id } });
    expect(e).toMatchObject({ organization_id: a.organizationId, actor_id: a.id, etapa_anterior: null, accion: 'CREAR', procedencia: 'CREACION_CANONICA' });
    expect(await db.auditLog.count({ where: { entidad_id: p.id, organization_id: a.organizationId, event_id: e.id } })).toBe(1);
  });
  it('retry HTTP tras respuesta perdida no duplica creación', async () => {
    const key = randomUUID(); const first = await create(a,key); const second = await create(a,key);
    expect(first.id).toBe(second.id); expect((await read(first.id)).events).toHaveLength(1);
  });
  it('mismo key con contenido diferente rechaza creación', async () => {
    const key = randomUUID(); await create(a,key);
    await expect(run(a, () => service.create(a,{nombre:'Otro'},key))).rejects.toMatchObject({ status:409 });
  });
  it('altas concurrentes reservan folios distintos y un hecho por alta', async () => {
    const rows = await Promise.all(Array.from({length:8}, () => create()));
    expect(new Set(rows.map((p)=>p.folio)).size).toBe(8);
  });
  it('fallo de AuditLog revierte prospecto y evento, sin hecho parcial', async () => {
    const key = randomUUID(); failAudit = true;
    try { await expect(create(a,key)).rejects.toThrow('test-audit-failure'); } finally { failAudit = false; }
    expect(await db.prospecto.count({where:{creation_key:key}})).toBe(0);
    expect(await db.prospectoTransicion.count({where:{idempotency_key:key}})).toBe(0);
  });
  it('edición, seguimiento y carga general no alteran fecha/etapa', async () => {
    const p = await create(), first = await read(p.id);
    await run(a,()=>service.update(a,p.id,{expectedVersion:p.version_operativa,nombre:'Editado',etapa_operativa_codigo:'ANTECEDENTES_RECIBIDOS'}));
    await db.prospectoSeguimiento.create({data:{organization_id:a.organizationId,prospecto_id:p.id,usuario_id:a.id,tipo:'NOTA',contenido:'Documentos disponibles'}});
    await doc(p); const current = await read(p.id);
    expect(current.stageEnteredAt).toEqual(first.stageEnteredAt); expect(current.events).toHaveLength(1); expect(current.stage).toBe('NUEVO');
  });
  it('Recabando y Listo son acciones explícitas sin umbral documental', async () => {
    const p = await create(); await act(p.id,'RECABAR'); expect((await read(p.id)).wait.type).toBe('CLIENTE_DOCUMENTOS');
    await act(p.id,'MARCAR_LISTO'); expect((await read(p.id)).wait.type).toBe('INTERNA_SOLICITUD');
    expect(await db.documento.count({where:{prospecto_id:p.id}})).toBe(0);
  });
  it.each(['etapa_contractual','transicion_actual_id','organization_id','actor_id','folio','version_operativa'])('bloquea mass assignment %s',async(field)=>{
    const p=await create(); await expect(run(a,()=>service.update(a,p.id,{expectedVersion:p.version_operativa,[field]:'inyectado'}))).rejects.toMatchObject({status:400});
  });
  it('rechaza transición inválida y falta de confirmación',async()=>{
    const p=await create(); await expect(act(p.id,'REGISTRAR_RECEPCION')).rejects.toMatchObject({status:409});
    await expect(act(p.id,'MARCAR_LISTO',{confirm:false})).rejects.toMatchObject({status:400});
  });
  it.each(['no-fecha','2100-01-01T00:00:00Z','2000-01-01T00:00:00Z'])('rechaza fecha inválida, futura o inversa: %s',async(effectiveAt)=>{
    const p=await ready(); await expect(act(p.id,'REGISTRAR_ENVIO',{...sendPayload(),effectiveAt})).rejects.toMatchObject({status:400});
  });
  it('preparar con adjuntos autorizados no envía ni crea eventos',async()=>{
    const p=await ready(), d=await doc(p), before=await read(p.id);
    const prepared=await run(a,()=>service.prepare(a,p.id,{expectedVersion:before.version,attachmentIds:[d.id]}));
    expect(prepared).toMatchObject({preparedOnly:true,deliveryConfirmedByProvider:false,attachmentIds:[d.id]});
    expect(prepared.content).toContain(d.nombre_original); expect((await read(p.id)).events).toEqual(before.events);
  });
  it('envío exige notaría y evidencia; no existe simulación de proveedor',async()=>{
    const p=await create(); await act(p.id,'MARCAR_LISTO');
    await expect(act(p.id,'REGISTRAR_ENVIO',sendPayload())).rejects.toMatchObject({code:'PRO001_NOTARY_REQUIRED'});
    const readyP=await ready(); await expect(act(readyP.id,'REGISTRAR_ENVIO',{effectiveAt:new Date().toISOString()})).rejects.toMatchObject({code:'PRO001_SEND_EVIDENCE_REQUIRED'});
  });
  it('envío = un hecho, hito enviado e inicio de espera simultáneos; retry idéntico',async()=>{
    const p=await ready(); const version=(await read(p.id)).version;
    const payload={action:'REGISTRAR_ENVIO',expectedVersion:version,confirm:true,idempotencyKey:randomUUID(),...sendPayload()};
    const first=await mutation(a,p.id,payload); const second=await mutation(a,p.id,payload);
    expect(second.idempotent).toBe(true); expect(first.eventId).toBe(second.eventId);
    const event=await db.prospectoTransicion.findUniqueOrThrow({where:{id:first.eventId!}});
    expect(event).toMatchObject({etapa_nueva:'EN_ESPERA_COTIZACION',hito_intermedio:'SOLICITUD_ENVIADA_NOTARIA'});
    expect(event.effective_at.toISOString()).toBe(payload.effectiveAt);
    expect((await read(p.id)).stageEnteredAt).toEqual(event.effective_at);
    await expect(mutation(a,p.id,{...payload,evidence:'Otro contenido'})).rejects.toMatchObject({status:409});
  });
  it('dos envíos simultáneos con keys distintos: un éxito y un stale',async()=>{
    const p=await ready(), version=(await read(p.id)).version;
    const results=await Promise.allSettled([1,2].map(()=>mutation(a,p.id,{action:'REGISTRAR_ENVIO',expectedVersion:version,confirm:true,idempotencyKey:randomUUID(),...sendPayload()})));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(await db.prospectoTransicion.count({where:{prospecto_id:p.id,accion:'REGISTRAR_ENVIO'}})).toBe(1);
  });
  it('carrera listo/envío no permite enviar sobre versión antigua',async()=>{
    const p=await create(), version=p.version_operativa;
    const results=await Promise.allSettled([
      mutation(a,p.id,{action:'MARCAR_LISTO',expectedVersion:version,confirm:true,idempotencyKey:randomUUID()}),
      mutation(a,p.id,{action:'REGISTRAR_ENVIO',expectedVersion:version,confirm:true,idempotencyKey:randomUUID(),...sendPayload()}),
    ]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1); expect((await read(p.id)).stage).toBe('LISTO_PARA_SOLICITAR');
  });
  it('dos pestañas listo/recabando: el perdedor no sobrescribe',async()=>{
    const p=await create();
    const results=await Promise.allSettled(['MARCAR_LISTO','RECABAR'].map(action=>mutation(a,p.id,{action,expectedVersion:p.version_operativa,confirm:true,idempotencyKey:randomUUID()})));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1); expect((await read(p.id)).events).toHaveLength(2);
  });
  it('edición stale es rechazada sin borrar el cambio de etapa',async()=>{
    const p=await create(); await act(p.id,'MARCAR_LISTO');
    await expect(run(a,()=>service.update(a,p.id,{expectedVersion:p.version_operativa,nombre:'Stale'}))).rejects.toMatchObject({code:'PRO001_STALE_VERSION'});
    expect((await read(p.id)).stage).toBe('LISTO_PARA_SOLICITAR');
  });
  it('archivo genérico no registra recepción; recepción explícita sí',async()=>{
    const p=await waiting(), d=await doc(p);
    expect((await read(p.id)).source).toBeNull(); expect((await read(p.id)).stage).toBe('EN_ESPERA_COTIZACION');
    const effectiveAt=new Date().toISOString(); await act(p.id,'REGISTRAR_RECEPCION',{documentId:d.id,effectiveAt});
    const w=await read(p.id); expect(w.stage).toBe('COTIZACION_RECIBIDA'); expect(w.source).toMatchObject({organization_id:a.organizationId,actor_id:a.id,prospecto_id:p.id,documento_id:d.id});
    expect(w.source!.received_at.toISOString()).toBe(effectiveAt);
  });
  it('blob no resoluble no admite recepción ni conversión',async()=>{
    const p=await waiting(), d=await doc(p,{storage_key:`test-missing-${randomUUID()}`});
    await expect(act(p.id,'REGISTRAR_RECEPCION',{documentId:d.id,effectiveAt:new Date().toISOString()})).rejects.toMatchObject({code:'PRO001_DOCUMENT_UNAVAILABLE'});
    expect((await read(p.id)).source).toBeNull();
  });
  it('dos recepciones simultáneas no duplican la primera fuente',async()=>{
    const p=await waiting(), docs=await Promise.all([doc(p),doc(p)]), version=(await read(p.id)).version;
    const results=await Promise.allSettled(docs.map(d=>mutation(a,p.id,{action:'REGISTRAR_RECEPCION',expectedVersion:version,confirm:true,idempotencyKey:randomUUID(),documentId:d.id,effectiveAt:new Date().toISOString()})));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1); expect((await read(p.id)).sourceHistory).toHaveLength(1);
  });
  it('recepción concurrente con reenvío no reinicia la espera',async()=>{
    const p=await waiting(), d=await doc(p), version=(await read(p.id)).version;
    const results=await Promise.allSettled([
      mutation(a,p.id,{action:'REGISTRAR_RECEPCION',expectedVersion:version,confirm:true,idempotencyKey:randomUUID(),documentId:d.id,effectiveAt:new Date().toISOString()}),
      mutation(a,p.id,{action:'REGISTRAR_ENVIO',expectedVersion:version,confirm:true,idempotencyKey:randomUUID(),...sendPayload()}),
    ]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1); expect((await read(p.id)).stage).toBe('COTIZACION_RECIBIDA');
  });
  it('sustitución versionada conserva primera recepción, etapa y eventos; retry seguro',async()=>{
    const {p}=await received(), original=await read(p.id), replacement=await doc(p);
    const payload={action:'SUSTITUIR_FUENTE',expectedVersion:original.version,confirm:true,idempotencyKey:randomUUID(),documentId:replacement.id,reason:'Corrección de documento recibida'};
    await mutation(a,p.id,payload); expect((await mutation(a,p.id,payload)).idempotent).toBe(true);
    const current=await read(p.id); expect(current.sourceHistory).toHaveLength(2); expect(current.source!.received_at).toEqual(original.source!.received_at);
    expect(current.stageEnteredAt).toEqual(original.stageEnteredAt); expect(current.events).toEqual(original.events);
    await expect(act(p.id,'SUSTITUIR_FUENTE',{documentId:replacement.id,reason:'Duplicado'})).rejects.toMatchObject({code:'PRO001_SOURCE_DUPLICATE'});
  });
  it('eventos y fuentes son inmutables incluso por escritura SQL directa',async()=>{
    const {p}=await received(), w=await read(p.id);
    await expect(db.prospectoFuenteNotarial.update({where:{id:w.source!.id},data:{received_at:new Date()}})).rejects.toThrow();
    await expect(db.prospectoTransicion.delete({where:{id:w.events[0].id}})).rejects.toThrow();
  });
  it('sin fuente no hay conversión',async()=>{
    const p=await waiting(); await expect(act(p.id,'CONVERTIR')).rejects.toMatchObject({status:409});
    expect(await db.cotizacion.count({where:{prospecto_id:p.id}})).toBe(0);
  });
  it('dos conversiones: única cotización, fuente heredada, folio y hecho atómicos',async()=>{
    const {p,d}=await received(), version=(await read(p.id)).version;
    const payload={action:'CONVERTIR',expectedVersion:version,confirm:true,idempotencyKey:randomUUID()};
    const results=await Promise.all([mutation(a,p.id,payload),mutation(a,p.id,payload)]);
    expect(results[0].quoteId).toBe(results[1].quoteId);
    const quote=await db.cotizacion.findUniqueOrThrow({where:{prospecto_id:p.id}});
    expect(quote.numero_cotizacion).toMatch(/^COT-\d{4}-\d{4}$/); expect(quote.fuente_notarial_id).not.toBeNull();
    expect((await read(p.id)).stage).toBe('CONVERTIDO_COTIZACION');
    expect(await db.cotizacionDocumento.count({where:{cotizacion_id:quote.id,documento_id:d.id}})).toBe(1);
    await expect(act(p.id,'CONVERTIR')).rejects.toMatchObject({status:409});
    expect(getAllowedCotizacionTransitions(quote.estado,true)).toEqual(['EN_REVISION_ABOGADO']);
    expect(()=>validateCotizacionTransition({current:quote.estado,next:'ENVIADA_NOTARIA',hasNotaria:true,hasApprovedVersion:true,hasCanonicalNotarySource:true})).toThrow();
    expect(getAllowedCotizacionTransitions('BORRADOR')).toEqual(['ENVIADA_NOTARIA']);
  });
  it('fallo de auditoría en conversión revierte cotización, vínculo y etapa',async()=>{
    const {p}=await received(); failAudit=true;
    try { await expect(act(p.id,'CONVERTIR')).rejects.toThrow('test-audit-failure'); } finally { failAudit=false; }
    expect(await db.cotizacion.count({where:{prospecto_id:p.id}})).toBe(0); expect((await read(p.id)).stage).toBe('COTIZACION_RECIBIDA');
  });
  it('desvincular documento general no borra ni invalida la fuente histórica',async()=>{
    const {p,d}=await received(); await db.documento.update({where:{id:d.id},data:{prospecto_id:null}});
    expect((await read(p.id)).source!.documento.id).toBe(d.id); await act(p.id,'CONVERTIR');
    expect(await db.documento.count({where:{id:d.id}})).toBe(1);
  });
  it('legacy desconocido mantiene NULL y no crea fecha/evento por lectura',async()=>{
    const w=await read('50000000-0000-4000-8000-000000000003');
    expect(w).toMatchObject({knowledge:'UNKNOWN_LEGACY',stage:null,stageEnteredAt:null,events:[],folio:null});
    expect(w.wait.knowledge).toBe('UNKNOWN_LEGACY');
  });
  it('tenant A no lee/convierte prospecto ni fuente B mediante ID válido',async()=>{
    const p=await create(b); await expect(read(p.id,a)).rejects.toMatchObject({status:404});
    await expect(act(p.id,'CONVERTIR',{},a)).rejects.toMatchObject({status:404});
    const event=await db.prospectoTransicion.findFirstOrThrow({where:{prospecto_id:p.id}});
    expect(await run(a,async()=>await scoped.prospectoTransicion.findUnique({where:{id:event.id}}))).toBeNull();
  });
  it('notaría y documento ajenos no pueden usarse como fuente',async()=>{
    const p=await create(); await expect(run(a,()=>service.update(a,p.id,{expectedVersion:p.version_operativa,notaria_id:'40000000-0000-4000-8000-000000000002'}))).rejects.toMatchObject({status:404});
    const foreign=await create(b), foreignDoc=await doc(foreign), own=await waiting();
    await expect(act(own.id,'REGISTRAR_RECEPCION',{documentId:foreignDoc.id,effectiveAt:new Date().toISOString()})).rejects.toMatchObject({status:409});
  });
  it('RBAC rechaza escritura, recepción y conversión sin permisos respectivos',async()=>{
    const p=await create(), readonly={...a,permissions:['prospectos.read']} as Actor;
    await expect(act(p.id,'MARCAR_LISTO',{},readonly)).rejects.toMatchObject({status:403});
    const {p:receivedP}=await received(), noQuote={...a,permissions:a.permissions.filter(p=>p!=='cotizaciones.write')};
    await expect(act(receivedP.id,'CONVERTIR',{},noQuote)).rejects.toMatchObject({status:403});
  });
  it('object-level rechaza abogado del mismo tenant no asignado',async()=>{
    const p=await create(), outsider={...a,id:randomUUID(),rol:'ABOGADO',scope:'ASSIGNED_OBJECTS'} as Actor;
    await expect(read(p.id,outsider)).rejects.toMatchObject({status:404});
    await expect(act(p.id,'MARCAR_LISTO',{},outsider)).rejects.toMatchObject({status:404});
  });
  it('constraints impiden etapa sin evento y evento sin etapa',async()=>{
    const p=await create();
    await expect(db.prospecto.update({where:{id:p.id},data:{etapa_contractual:'COTIZACION_RECIBIDA'}})).rejects.toThrow();
    await expect(db.prospectoTransicion.create({data:{organization_id:a.organizationId,prospecto_id:p.id,actor_id:a.id,
      etapa_anterior:'NUEVO',etapa_nueva:'RECABANDO_INFORMACION',effective_at:new Date(),recorded_at:new Date(),
      accion:'RECABAR',procedencia:'CONFIRMACION_HUMANA',evidencia:{},version:999,idempotency_key:randomUUID(),payload_hash:'a'.repeat(64)}})).rejects.toThrow();
  });
});
