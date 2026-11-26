import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { ExpedienteArtifactsService,type Exp006Actor } from '../services/expedienteArtifacts.service';
const url=process.env.MANUAL_FORMATS_CLIENT_QA_DATABASE_URL;
if(url){const u=new URL(url);if(u.hostname!=='127.0.0.1'||u.port!=='55521'||u.pathname!=='/pravia_client_qa'||u.searchParams.get('schema')!=='pravia_os')throw Error('MANUAL_FORMATS_LOCAL_ONLY');}
const db=url?new PrismaClient({datasources:{db:{url}}}):null;
const org=randomUUID(),otherOrg=randomUUID(),user=randomUUID(),caseId=randomUUID(),artifactId=randomUUID(),partyId=randomUUID(),relationId=randomUUID();
const actor:Exp006Actor={id:user,organizationId:org,membershipId:randomUUID(),sessionId:randomUUID(),rol:'DIRECCION',scope:'GLOBAL',permissions:['documentos.read','documentos.write','expedientes.write']};
let failAudit=false;
db?.$use(async(params,next)=>{if(failAudit&&params.model==='AuditLog'&&params.action==='create')throw Error('QA_MANUAL_AUDIT_FAILURE');return next(params);});
const service=()=>new ExpedienteArtifactsService(db!);
const selection={artifact_id:artifactId,subject_type:'COMPARECIENTE' as const,subject_id:relationId};
const version=async()=>(await db!.expediente.findUniqueOrThrow({where:{id:caseId}})).version;
describe.runIf(Boolean(url))('Formatos manuales · PostgreSQL aislado, sin IA ni Storage físico',()=>{
 beforeAll(async()=>{
  for(const id of [org,otherOrg])await db!.organization.create({data:{id,name:'SINTETICO QA FORMATOS'}});
  await db!.user.create({data:{id:user,email:`manual-formats-${user}@example.test`,nombre:'SINTETICO',apellido:'QA',rol:'DIRECCION',password_hash:'no-login-synthetic'}});
  await db!.organizationMembership.create({data:{organization_id:org,user_id:user,rol:'DIRECCION'}});
  await db!.expediente.create({data:{id:caseId,organization_id:org,numero_pravia:`EXP-QA-${randomUUID()}`,abogado_id:user,creador_id:user}});
  const role=await db!.caracterCompareciente.create({data:{organization_id:org,clave:`QA-${randomUUID()}`,nombre:'COMPARECIENTE QA'}});
  await db!.compareciente.create({data:{id:partyId,organization_id:org,nombre_busqueda:'PERSONA SINTETICA QA',creado_por_id:user}});
  await db!.expedienteCompareciente.create({data:{id:relationId,organization_id:org,expediente_id:caseId,compareciente_id:partyId,caracter_id:role.id,creado_por_id:user}});
  await db!.catalogoArtefacto.create({data:{id:artifactId,organization_id:org,tipo:'FORMATO',propietario_tipo:'ORGANIZACION',nombre:'FORMATO SINTETICO QA',creado_por_id:user,actualizado_por_id:user,versiones:{create:{organization_id:org,version:1,origen:'QA_METADATA_ONLY',creado_por_id:user,nombre_original:'qa-no-generar.docx',storage_key:`organizations/${org}/qa-metadata-only.docx`,mime_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size_bytes:1,checksum_sha256:'a'.repeat(64)}}}});
  await db!.catalogoArtefactoDestino.create({data:{organization_id:org,artefacto_id:artifactId,destino:'EXPEDIENTE_DOCUMENTO_GENERICO',creado_por_id:user,actualizado_por_id:user}});
 });
 afterAll(async()=>db?.$disconnect());
 it('lista persona aún no vinculada a un acto y crea pendientes sin inventar regla maestra',async()=>{
  const options=await service().manualOptions(actor,caseId);expect(options.subjects).toEqual(expect.arrayContaining([expect.objectContaining({id:relationId})]));
  await service().selectManual(actor,caseId,{expected_version:options.version,selections:[selection],reason:'QA selección explícita'});
  const pending=await db!.expedienteArtefactoPendiente.findFirstOrThrow({where:{expediente_id:caseId,en_alcance:true}});
  expect(pending.regla_id).toBeNull();expect(await db!.catalogoArtefactoRegla.count({where:{artefacto_id:artifactId}})).toBe(0);expect(pending.estado).toBe('PENDIENTE');
 });
 it('dos cambios con el mismo snapshot producen un éxito y un stale, no last-write-wins',async()=>{
  const expected=await version();const results=await Promise.allSettled([1,2].map(n=>service().selectManual(actor,caseId,{expected_version:expected,selections:[selection],reason:`QA concurrencia ${n}`})));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'EXP006_MANUAL_STALE'}});
  expect(await db!.expedienteArtefactoPendiente.count({where:{expediente_id:caseId}})).toBe(1);
 });
 it('fallar auditoría revierte versión, selección y materialización',async()=>{
  const before=await db!.expediente.findUniqueOrThrow({where:{id:caseId}});failAudit=true;
  try{await expect(service().selectManual(actor,caseId,{expected_version:before.version,selections:[],reason:'QA fallo'})).rejects.toThrow('QA_MANUAL_AUDIT_FAILURE');}finally{failAudit=false;}
  const after=await db!.expediente.findUniqueOrThrow({where:{id:caseId}});expect(after.version).toBe(before.version);expect(after.datos_operacion).toEqual(before.datos_operacion);expect(await db!.expedienteArtefactoPendiente.count({where:{expediente_id:caseId,en_alcance:true}})).toBe(1);
 });
 it('otro tenant y lector no pueden seleccionar formatos',async()=>{
  await expect(service().manualOptions({...actor,organizationId:otherOrg},caseId)).rejects.toMatchObject({status:403});
  await expect(service().selectManual({...actor,permissions:['documentos.read']},caseId,{expected_version:await version(),selections:[],reason:'QA intento'})).rejects.toMatchObject({status:403});
 });
 it('retirar pendiente sin trabajo lo conserva y actualizar no lo resucita',async()=>{
  await service().selectManual(actor,caseId,{expected_version:await version(),selections:[],reason:'QA retiro explícito'});
  const snapshot=await service().read(actor,caseId);await service().materialize(actor,caseId,snapshot.preview.revision);
  expect(await db!.expedienteArtefactoPendiente.findFirstOrThrow({where:{expediente_id:caseId}})).toMatchObject({en_alcance:false,estado:'NO_APLICA'});
 });
});
