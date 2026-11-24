import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { expedienteAccessWhere, expedienteReadWhere } from '../middleware/auth.middleware';
import { functionalDestinationService } from './functionalDestination.service';
import { CatalogConfigurationError } from './configurationCatalogError';
import { renderConfiguredFunctionalDocument, FunctionalDocumentRenderError } from './functionalDocumentRenderer.service';
import { uploadFile, deleteFile, getSignedUrl } from '../storage/storage.service';
type Actor = NonNullable<Request['user']>;
export class CaseSheetError extends Error { constructor(readonly status:number,readonly code:string,message:string){super(message);} }
export class CaseSheetService {
  constructor(private readonly db: PrismaClient) {}
  private async source(actor:Actor,id:string,write=false,db:PrismaClient|Prisma.TransactionClient=this.db) {
    const item=await db.expediente.findFirst({where:{id,organization_id:actor.organizationId,archived_at:null,...(write?expedienteAccessWhere(actor):expedienteReadWhere(actor))},select:{id:true,numero_pravia:true,version:true,updated_at:true,fecha_apertura:true,cliente_compareciente:{select:{id:true,nombre_busqueda:true}},abogado:{select:{id:true,nombre:true,apellido:true}},actos:{where:{estatus:'ACTIVO',removed_at:null},orderBy:{created_at:'asc'},select:{tipo_acto:{select:{nombre:true}}}},valor_operacion:true}});
    if(!item)throw new CaseSheetError(403,'CASE_SHEET_ACCESS_DENIED','No tienes acceso a este expediente.');return item;
  }
  async read(actor:Actor,id:string) {
    await this.source(actor,id);
    const versions=await this.db.expedienteDocumento.findMany({where:{organization_id:actor.organizationId,expediente_id:id,source_context:'FICHA_EXPEDIENTE'},include:{documento:{select:{id:true,nombre_original:true,mime_type:true,checksum_sha256:true}}},orderBy:{fecha_vinculo:'desc'}});
    let format: {available:boolean;name?:string;reason?:string}={available:false};
    try {const selected=await functionalDestinationService.resolve(actor,'EXPEDIENTE_FICHA');format={available:true,name:selected.artifact.nombre};}
    catch(error){if(!(error instanceof CatalogConfigurationError))throw error;format={available:false,reason:'Configura una versión activa con destino Ficha de expediente en CFG-002.'};}
    return {format,versions:versions.map(item=>({id:item.id,documento:item.documento,created_at:item.fecha_vinculo,provenance:item.provenance}))};
  }
  async generate(actor:Actor,id:string,key:string) {
    if(!actor.permissions.includes('expedientes.write')||!actor.permissions.includes('documentos.write'))throw new CaseSheetError(403,'CASE_SHEET_WRITE_DENIED','No puedes generar la ficha del expediente.');
    if(!key||key.length>96)throw new CaseSheetError(400,'CASE_SHEET_KEY_REQUIRED','Indica una clave de operación válida.');
    const source=await this.source(actor,id,true),operation=`case-sheet:${key}`;
    const existing=await this.db.expedienteDocumento.findFirst({where:{organization_id:actor.organizationId,expediente_id:id,idempotency_key:operation},include:{documento:true}});
    if(existing)return {item:existing,idempotent:true};
    const selected=await functionalDestinationService.resolve(actor,'EXPEDIENTE_FICHA');
    const fields={'expediente.folio':source.numero_pravia,'expediente.cliente':source.cliente_compareciente?.nombre_busqueda??null,'expediente.abogado':[source.abogado?.nombre,source.abogado?.apellido].filter(Boolean).join(' '),'expediente.fecha_apertura':source.fecha_apertura.toISOString().slice(0,10),'expediente.actos':source.actos.map(row=>row.tipo_acto.nombre).join(', '),'expediente.valor_operacion':source.valor_operacion?.toFixed(2)??null};
    const rendered=await renderConfiguredFunctionalDocument(selected.version,fields,selected.data_mapping,{strictMapping:true});
    const sha=createHash('sha256').update(rendered.buffer).digest('hex'),storageKey=`organizations/${actor.organizationId}/expedientes/${id}/fichas/${randomUUID()}.${rendered.extension}`;
    await uploadFile(rendered.buffer,storageKey,rendered.mimeType);
    try {
      const result=await this.db.$transaction(async tx=>{
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`case-sheet:${actor.organizationId}:${id}`}))`);
        const repeated=await tx.expedienteDocumento.findFirst({where:{organization_id:actor.organizationId,expediente_id:id,idempotency_key:operation},include:{documento:true}});if(repeated)return {item:repeated,idempotent:true};
        const current=await this.source(actor,id,true,tx);
        const format=await functionalDestinationService.resolve(actor,'EXPEDIENTE_FICHA');
        if(current.version!==source.version||current.updated_at.getTime()!==source.updated_at.getTime()||format.version.id!==selected.version.id)throw new CaseSheetError(409,'CASE_SHEET_SOURCE_CHANGED','El expediente o el formato cambió. Reconsulta antes de generar.');
        const version=await tx.expedienteDocumento.count({where:{organization_id:actor.organizationId,expediente_id:id,source_context:'FICHA_EXPEDIENTE'}})+1;
        const document=await tx.documento.create({data:{organization_id:actor.organizationId,expediente_id:id,nombre_original:`Ficha_${source.numero_pravia}_v${version}.${rendered.extension}`,nombre_interno:storageKey,storage_key:storageKey,tipo:'FICHA_EXPEDIENTE',categoria:'OTROS',estatus:'VIGENTE',mime_type:rendered.mimeType,size_bytes:rendered.buffer.length,checksum_sha256:sha,subido_por_id:actor.id,datos_extraidos:{source:'CFG-002',format_version_id:selected.version.id,format_checksum:rendered.sourceChecksum,case_version:source.version,version,review_required:true}}});
        const item=await tx.expedienteDocumento.create({data:{organization_id:actor.organizationId,expediente_id:id,documento_id:document.id,tipo_vinculo:'FICHA_EXPEDIENTE',creado_por_id:actor.id,origen:'EXPEDIENTE',source_entity_type:'Expediente',source_entity_id:id,source_context:'FICHA_EXPEDIENTE',source_key:`FICHA:${document.id}`,document_version:sha,idempotency_key:operation,provenance:{version,format_version_id:selected.version.id,case_version:source.version,review_required:true}},include:{documento:true}});
        await tx.auditLog.create({data:{organization_id:actor.organizationId,user_id:actor.id,accion:'CASE_SHEET_GENERATED',entidad:'Expediente',entidad_id:id,valores_nuevos:{documento_id:document.id,sha256:sha,version,format_version_id:selected.version.id}}});return {item,idempotent:false};
      });
      if(result.idempotent)await deleteFile(storageKey);return result;
    }catch(error){await deleteFile(storageKey).catch(()=>undefined);throw error;}
  }
  async automatic(actor:Actor,id:string,key:string) {
    try {const result=await this.generate(actor,id,key);return {status:'GENERATED',document_id:result.item.documento_id};}
    catch(error){const configured=error instanceof CatalogConfigurationError||error instanceof FunctionalDocumentRenderError;
      await this.db.auditLog.create({data:{organization_id:actor.organizationId,user_id:actor.id,accion:'CASE_SHEET_PENDING',entidad:'Expediente',entidad_id:id,valores_nuevos:{status:configured?'CONFIGURATION_REQUIRED':'FAILED',code:error instanceof CaseSheetError||error instanceof FunctionalDocumentRenderError||error instanceof CatalogConfigurationError?error.code:'CASE_SHEET_GENERATION_FAILED'}}}).catch(()=>{console.error('[CASE_SHEET_PENDING_AUDIT_FAILED]',{expedienteId:id});});
      return {status:configured?'CONFIGURATION_REQUIRED':'FAILED',message:'El expediente se creó; su ficha sigue pendiente. Revisa Plantillas y formatos.'};}
  }
  async url(actor:Actor,id:string,documentId:string){await this.source(actor,id);const link=await this.db.expedienteDocumento.findFirst({where:{organization_id:actor.organizationId,expediente_id:id,source_context:'FICHA_EXPEDIENTE',documento_id:documentId},include:{documento:true}});if(!link)throw new CaseSheetError(404,'CASE_SHEET_NOT_FOUND','Ficha no encontrada.');return {url:await getSignedUrl(link.documento.storage_key,600),filename:link.documento.nombre_original,mimeType:link.documento.mime_type};}
}
