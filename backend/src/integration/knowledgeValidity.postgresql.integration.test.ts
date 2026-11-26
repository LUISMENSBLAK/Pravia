import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KnowledgeService } from '../services/knowledge.service';

const url=process.env.KNOWLEDGE_VALIDITY_QA_DATABASE_URL;
if(url){const u=new URL(url);if(u.hostname!=='127.0.0.1'||u.port!=='55521'||u.pathname!=='/pravia_client_qa'||u.searchParams.get('schema')!=='pravia_os')throw Error('KNOWLEDGE_VALIDITY_LOCAL_ONLY');}
const db=url?new PrismaClient({datasources:{db:{url}}}):null;
const actor={id:randomUUID(),organizationId:randomUUID()},sourceId=randomUUID(),versions=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
let failAudit=false,winner='';
db?.$use(async(params,next)=>{if(failAudit&&params.model==='AuditLog'&&params.action==='create')throw Error('QA_KNOWLEDGE_AUDIT_FAILURE');return next(params);});
const service=()=>new KnowledgeService(db!);

describe.runIf(Boolean(url))('Biblioteca · vigencias serializadas en PostgreSQL QA',()=>{
  beforeAll(async()=>{
    await db!.organization.create({data:{id:actor.organizationId,name:'SINTETICO QA VIGENCIAS'}});
    await db!.user.create({data:{id:actor.id,email:`validity-${actor.id}@example.test`,nombre:'SINTETICO',apellido:'QA',rol:'DIRECCION',password_hash:'no-login-synthetic'}});
    await db!.organizationMembership.create({data:{organization_id:actor.organizationId,user_id:actor.id,rol:'DIRECCION'}});
    await db!.knowledgeSource.create({data:{id:sourceId,organization_id:actor.organizationId,inventory_code:'QA-VIGENCIA',title:'Fuente sintética sin validez',jurisdiction:'FEDERAL',category:'LEY',source_url:'https://example.test/qa-no-law',created_by_id:actor.id}});
    for(const [index,id] of versions.entries())await db!.knowledgeSourceVersion.create({data:{id,organization_id:actor.organizationId,source_id:sourceId,version:index+1,label:`QA ${index+1}`,content_text:`vigenciaqafinal versión sintética ${index+1}`,provenance:{fixture:true},created_by_id:actor.id}});
  });
  afterAll(async()=>db?.$disconnect());
  it('verifica el primer intervalo mediante una acción auditada',async()=>{
    await service().verifyVersion(actor,sourceId,versions[0],'2026-01-01');
    expect(await db!.auditLog.count({where:{organization_id:actor.organizationId,entidad_id:versions[0]}})).toBe(1);
  });
  it('dos versiones con la misma fecha no se activan simultáneamente ni se mezclan al consultar',async()=>{
    const results=await Promise.allSettled(versions.slice(1,3).map(id=>service().verifyVersion(actor,sourceId,id,'2027-01-01')));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'KNOW_VALIDITY_CONFLICT'}});
    const current=await db!.knowledgeSourceVersion.findMany({where:{source_id:sourceId,verification_status:'VERIFICADA'}});expect(current).toHaveLength(1);winner=current[0].id;
    expect(await db!.knowledgeSourceVersion.findUniqueOrThrow({where:{id:versions[0]}})).toMatchObject({verification_status:'SUPERADA',effective_to:new Date('2026-12-31T00:00:00Z')});
    const old=await service().retrieve(actor,{query:'vigenciaqafinal',legal_date:'2026-11-26'}),future=await service().retrieve(actor,{query:'vigenciaqafinal',legal_date:'2027-01-02'});
    expect(old.evidence.map(item=>item.version)).toEqual([1]);expect(future.evidence.map(item=>item.version)).toEqual([current[0].version]);
    await service().verifyVersion(actor,sourceId,winner,'2027-01-01');
    expect(await db!.auditLog.count({where:{organization_id:actor.organizationId,entidad_id:winner}})).toBe(1);
  });
  it('no introduce una versión retroactiva solapada ni altera la anterior',async()=>{
    const before=await db!.knowledgeSourceVersion.findMany({where:{source_id:sourceId},orderBy:{version:'asc'}});
    await expect(service().verifyVersion(actor,sourceId,versions[3],'2025-01-01')).rejects.toMatchObject({code:'KNOW_VALIDITY_CONFLICT'});
    expect(await db!.knowledgeSourceVersion.findMany({where:{source_id:sourceId},orderBy:{version:'asc'}})).toEqual(before);
  });
  it('un error de auditoría revierte el cierre de la versión anterior y la nueva verificación',async()=>{
    failAudit=true;
    try{await expect(service().verifyVersion(actor,sourceId,versions[3],'2028-01-01')).rejects.toThrow('QA_KNOWLEDGE_AUDIT_FAILURE');}finally{failAudit=false;}
    expect(await db!.knowledgeSourceVersion.findUniqueOrThrow({where:{id:winner}})).toMatchObject({verification_status:'VERIFICADA',effective_to:null});
    expect(await db!.knowledgeSourceVersion.findUniqueOrThrow({where:{id:versions[3]}})).toMatchObject({verification_status:'PENDIENTE',effective_from:null});
  });
});
