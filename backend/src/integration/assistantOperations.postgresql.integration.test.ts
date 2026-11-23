import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import prisma from '../config/prisma';
import {runWithActorContext} from '../auth/actorContext';
import {assistantConversationService} from '../services/assistantConversation.service';
import {prepareOrExecuteAssistantAction,confirmAssistantAction} from '../services/assistantActions.service';

const target=process.env.ASSISTANT_CLIENT_QA_DATABASE_URL;
if(target){const url=new URL(target);if(url.hostname!=='127.0.0.1'||url.port!=='55521'||url.pathname!=='/pravia_client_qa'||url.searchParams.get('schema')!=='pravia_os'||process.env.DATABASE_URL!==target)throw Error('ISOLATED_ASSISTANT_QA_REQUIRED');}
const db=target?new PrismaClient({datasourceUrl:target}):null;
const org=randomUUID(),user=randomUUID(),member=randomUUID(),session=randomUUID();
const permissions=['ai.use','ai.actions.prepare','comparecientes.read','comparecientes.write','documentos.read','documentos.write'];
const actor:any={id:user,organizationId:org,membershipId:member,sessionId:session,rol:'ADMINISTRACION',permissions,scope:'GLOBAL',nombre:'QA',apellido:'SINTÉTICO'};
const run=<T>(fn:()=>Promise<T>)=>runWithActorContext({userId:user,organizationId:org,membershipId:member,sessionId:session,role:'ADMINISTRACION',permissions:permissions as any,scope:'GLOBAL'},fn);
async function setup(){
  const c=await run(()=>assistantConversationService.create(actor,{title:'SYNTHETIC QA atomic chat creation'}));
  const buffer=await readFile('/tmp/pravia-client-qa-20261121.amVOGW/fixtures/chat-persona-sintetica.png');
  const attachment=await run(()=>assistantConversationService.uploadAttachment(actor,c.id,{buffer,size:buffer.length,mimetype:'image/png',originalname:'SYNTHETIC-chat.png'} as Express.Multer.File));
  return {c,attachment};
}
describe.runIf(Boolean(target))('Chat action persistence · physical PostgreSQL/Storage (synthetic facts, no provider)',()=>{
  beforeAll(async()=>{
    expect(process.env.STORAGE_MODE).toBe('local');
    await db!.organization.create({data:{id:org,name:'SYNTHETIC QA chat isolation'}});
    await db!.user.create({data:{id:user,email:`chat-${user}@example.test`,nombre:'QA',apellido:'SINTÉTICO',rol:'ADMINISTRACION',password_hash:'no-login-synthetic'}});
    await db!.organizationMembership.create({data:{id:member,organization_id:org,user_id:user,rol:'ADMINISTRACION'}});
    await db!.tenantEntitlement.create({data:{organization_id:org,included_storage_bytes:10n*1024n*1024n,total_storage_capacity_bytes:10n*1024n*1024n}});
    await db!.tenantStorageUsage.create({data:{organization_id:org}});
  });
  afterAll(async()=>{await db?.$disconnect();});
  it('creates master and promotes original blob atomically; reload, concurrent confirm and retry persist once',async()=>{
    const {c,attachment}=await setup();const original=await db!.assistantAttachment.findUniqueOrThrow({where:{id:attachment.id}});
    const prepared=await run(()=>prepareOrExecuteAssistantAction({actor,conversationId:c.id,messageId:randomUUID(),actionKey:'party.create',args:{tipo_persona:'FISICA',nombre:'ATOMIC QA'},context:{attachmentIds:[attachment.id]},correlationId:randomUUID(),origin:'USER_COMMAND'}));
    expect(await db!.compareciente.count({where:{organization_id:org}})).toBe(0);
    const reloaded=await run(()=>assistantConversationService.get(actor,c.id));expect(reloaded.pending_confirmation?.id).toBe(prepared.confirmation!.id);
    const command={actor,conversationId:c.id,confirmationId:prepared.confirmation!.id,correlationId:randomUUID()};
    const attempts=await Promise.allSettled([run(()=>confirmAssistantAction(command)),run(()=>confirmAssistantAction(command))]);
    expect(attempts.some(r=>r.status==='fulfilled')).toBe(true);
    const party=await db!.compareciente.findFirstOrThrow({where:{organization_id:org,nombre_busqueda:'ATOMIC QA'}});
    expect(await db!.compareciente.count({where:{organization_id:org}})).toBe(1);
    const link=await db!.comparecienteDocumento.findFirstOrThrow({where:{compareciente_id:party.id},include:{documento:true}});
    expect(link.documento.storage_key).toBe(original.storage_key);expect(link.documento.checksum_sha256).toBe(original.sha256);
    const promoted=await db!.assistantAttachment.findUniqueOrThrow({where:{id:attachment.id}});expect(promoted.expires_at).toBeNull();expect(promoted.documento_id).toBe(link.documento_id);
    await run(()=>confirmAssistantAction(command));expect(await db!.comparecienteDocumento.count({where:{compareciente_id:party.id}})).toBe(1);
    expect(await db!.auditLog.count({where:{organization_id:org,accion:'AI_ATTACHMENT_PROMOTED',entidad_id:link.documento_id}})).toBe(1);
  });
  it('invalid second attachment rolls back the master, first link and promotion, preserving the uploaded blob',async()=>{
    const {c,attachment}=await setup();const before=await db!.compareciente.count({where:{organization_id:org}});
    const prepared=await run(()=>prepareOrExecuteAssistantAction({actor,conversationId:c.id,messageId:randomUUID(),actionKey:'party.create',args:{tipo_persona:'FISICA',nombre:'ROLLBACK QA',attachment_ids:[attachment.id,randomUUID()]},correlationId:randomUUID(),origin:'USER_COMMAND'}));
    await expect(run(()=>confirmAssistantAction({actor,conversationId:c.id,confirmationId:prepared.confirmation!.id,correlationId:randomUUID()}))).rejects.toThrow();
    expect(await db!.compareciente.count({where:{organization_id:org}})).toBe(before);
    const original=await db!.assistantAttachment.findUniqueOrThrow({where:{id:attachment.id}});expect(original.source).toBe('TEMPORARY_UPLOAD');expect(original.documento_id).toBeNull();expect(original.storage_key).toBeTruthy();
  });
  it('denies creation with documents when document write permission is absent',async()=>{
    const {c,attachment}=await setup();
    await expect(run(()=>prepareOrExecuteAssistantAction({actor:{...actor,permissions:permissions.filter(p=>p!=='documentos.write')},conversationId:c.id,messageId:randomUUID(),actionKey:'party.create',args:{tipo_persona:'FISICA',nombre:'DENIED QA'},context:{attachmentIds:[attachment.id]},correlationId:randomUUID(),origin:'USER_COMMAND'}))).rejects.toMatchObject({code:'AI_ACTION_DENIED'});
    expect(await db!.compareciente.count({where:{organization_id:org,nombre_busqueda:'DENIED QA'}})).toBe(0);
  });
  it('recovers a post-commit reporting failure without duplicating master, source document or blob',async()=>{
    const {c,attachment}=await setup();
    const prepared=await run(()=>prepareOrExecuteAssistantAction({actor,conversationId:c.id,messageId:randomUUID(),actionKey:'party.create',args:{tipo_persona:'FISICA',nombre:'RECOVERY QA'},context:{attachmentIds:[attachment.id]},correlationId:randomUUID(),origin:'USER_COMMAND'}));
    const command={actor,conversationId:c.id,confirmationId:prepared.confirmation!.id,correlationId:randomUUID()};
    const fail=vi.spyOn(prisma.auditLog,'create').mockRejectedValueOnce(new Error('Synthetic post-commit audit outage'));
    try {await expect(run(()=>confirmAssistantAction(command))).rejects.toThrow('Synthetic post-commit audit outage');} finally {fail.mockRestore();}
    expect(await db!.compareciente.count({where:{organization_id:org,nombre_busqueda:'RECOVERY QA'}})).toBe(1);
    await run(()=>confirmAssistantAction(command));
    expect(await db!.compareciente.count({where:{organization_id:org,nombre_busqueda:'RECOVERY QA'}})).toBe(1);
    const saved=await db!.assistantAttachment.findUniqueOrThrow({where:{id:attachment.id}});
    expect(await db!.comparecienteDocumento.count({where:{documento_id:saved.documento_id!}})).toBe(1);
  });
});
