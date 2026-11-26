import { createHash, randomUUID } from 'crypto';
import { PDFParse } from 'pdf-parse';
import { Prisma, PrismaClient } from '@prisma/client';
import { DOCUMENT_UPLOAD_MAX_BYTES } from '../config/uploadLimits';
import { uploadFile, deleteFile, getSignedUrl } from '../storage/storage.service';
import { extractDocxText } from './docxText';
import { DOCX_MIME } from './functionalDocumentRenderer.service';
import { canonicalUploadedDocumentMime } from './documentUploadValidation';
import { KnowledgeValidationError, normalizeInventoryRow, splitLegalArticles } from './knowledge.service';

type Actor = { id:string; organizationId:string };
export async function legalDocumentText(file: Express.Multer.File) {
  if (!file?.buffer?.length || file.buffer.length > DOCUMENT_UPLOAD_MAX_BYTES) throw new KnowledgeValidationError('KNOW_FILE_SIZE', 'Selecciona un archivo dentro del límite permitido.');
  let mime: string;
  if (/\.txt$/i.test(file.originalname) && ['text/plain','application/octet-stream'].includes(file.mimetype)) {
    if (file.buffer.includes(0)) throw new KnowledgeValidationError('KNOW_FILE_INVALID', 'El archivo TXT contiene datos binarios.');
    mime='text/plain';
  } else {
    try { mime=canonicalUploadedDocumentMime(file); }
    catch { throw new KnowledgeValidationError('KNOW_FILE_INVALID', 'El contenido del archivo no corresponde a un documento válido.'); }
  }
  if (mime===DOCX_MIME) return {mime,text:await extractDocxText(file.buffer)};
  if (mime==='text/plain') return {mime,text:file.buffer.toString('utf8')};
  if (mime!=='application/pdf') throw new KnowledgeValidationError('KNOW_FILE_TYPE', 'Carga PDF, DOCX o TXT.');
  const parser=new PDFParse({data:file.buffer});
  try {
    const info=await parser.getInfo();
    if(info.total>1500) throw new KnowledgeValidationError('KNOW_FILE_PAGES','El archivo supera 1500 páginas; divídelo en volúmenes.');
    return {mime,text:(await parser.getText({pageJoiner:''})).text};
  } catch(error) {
    if(error instanceof KnowledgeValidationError) throw error;
    throw new KnowledgeValidationError('KNOW_FILE_INVALID','No se pudo leer el PDF. Comprueba que no esté dañado ni protegido.');
  } finally {await parser.destroy();}
}

/** Originals stay private. Uploading does not assert authenticity or activate legal knowledge. */
export class KnowledgeDocumentService {
  constructor(private db:PrismaClient) {}
  async upload(actor:Actor,input:Record<string,unknown>,file:Express.Multer.File) {
    const parsed=await legalDocumentText(file);
    const supplied=String(input.content_text||'').trim();
    const text=(supplied||parsed.text).trim();
    if(text.length>5_000_000) throw new KnowledgeValidationError('KNOW_TEXT_LIMIT','El texto supera el límite de 5 millones de caracteres. Divide el documento.');
    const sourceId=String(input.source_id||'');
    const label=String(input.label||'').trim();
    if(!label||label.length>160)throw new KnowledgeValidationError('KNOW_VERSION_LABEL','Indica la edición o etiqueta de versión (máximo 160 caracteres).');
    const source=sourceId?await this.db.knowledgeSource.findFirst({where:{id:sourceId,organization_id:actor.organizationId,active:true}}):null;
    if(sourceId&&!source)throw new KnowledgeValidationError('KNOW_SOURCE_NOT_FOUND','La fuente no está disponible en esta organización.',404);
    const row=source?null:normalizeInventoryRow({...input,inventory_code:input.inventory_code||`DOC-${randomUUID()}`,ingestion_status:'PENDIENTE_TEXTO_OFICIAL'});
    if(row?.source_url){let url:URL;try{url=new URL(row.source_url);}catch{throw new KnowledgeValidationError('KNOW_URL_INVALID','La URL de procedencia no es válida.');}if(!['https:','http:'].includes(url.protocol))throw new KnowledgeValidationError('KNOW_URL_INVALID','Usa una URL HTTP o HTTPS.');}
    const key=`organizations/${actor.organizationId}/knowledge/${randomUUID()}`;
    await uploadFile(file.buffer,key,parsed.mime);
    try {
      return await this.db.$transaction(async tx=>{
        // One lock for creation/version allocation in this tenant. No inventory upsert overwrites metadata.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`knowledge-upload:${actor.organizationId}`}))`;
        const current=source||await tx.knowledgeSource.create({data:{...row!,organization_id:actor.organizationId,created_by_id:actor.id}});
        const latest=await tx.knowledgeSourceVersion.aggregate({where:{source_id:current.id,organization_id:actor.organizationId},_max:{version:true}});
        const version=await tx.knowledgeSourceVersion.create({data:{organization_id:actor.organizationId,source_id:current.id,version:(latest._max.version||0)+1,label,
          verification_status:'PENDIENTE',legal_status:'PENDIENTE_VERIFICAR',review_required:true,content_text:text||null,
          checksum_sha256:createHash('sha256').update(file.buffer).digest('hex'),created_by_id:actor.id,
          provenance:{storage_key:key,file_name:file.originalname,mime_type:parsed.mime,size_bytes:file.buffer.length,text_method:supplied?'TRANSCRIPCION_ADMINISTRATIVA':'TEXTO_NATIVO',text_sha256:text?createHash('sha256').update(text).digest('hex'):null}}});
        const provider=await tx.storageProviderRecord.findUniqueOrThrow({where:{code:'runtime-primary'},select:{id:true}});
        const location=await tx.storageBlobLocation.findFirstOrThrow({where:{organization_id:actor.organizationId,object_key:key,provider_id:provider.id},select:{id:true,blob_id:true}});
        await tx.$queryRaw`SELECT id FROM storage_blob_locations WHERE id = ${location.id}::uuid FOR UPDATE`;
        const available=await tx.storageBlobLocation.findFirst({where:{id:location.id,organization_id:actor.organizationId,status:'AVAILABLE'}});
        if(!available)throw new KnowledgeValidationError('KNOW_STORAGE_UNAVAILABLE','No se pudo acreditar el original almacenado.',409);
        await tx.storageBlobReference.create({data:{organization_id:actor.organizationId,blob_id:location.blob_id,owner_type:'KnowledgeSourceVersion',owner_id:version.id}});
        if(text)await tx.knowledgeArticle.createMany({data:splitLegalArticles(text).map(article=>({...article,organization_id:actor.organizationId,version_id:version.id}))});
        await tx.auditLog.create({data:{organization_id:actor.organizationId,user_id:actor.id,accion:'CARGAR_DOCUMENTO_JURIDICO',entidad:'KnowledgeSourceVersion',entidad_id:version.id,detalles:{source_id:current.id,version:version.version,sha256:version.checksum_sha256,text_available:Boolean(text),auto_verified:false}}});
        return {source_id:current.id,version_id:version.id,version:version.version,text_available:Boolean(text),verification_status:'PENDIENTE',message:text?'Archivo cargado. Revisa texto, procedencia y vigencia antes de verificarlo.':'Original conservado. No tiene texto recuperable: agrega una transcripción revisada antes de verificarlo.'};
      },{timeout:25000});
    } catch(error){await deleteFile(key).catch(()=>undefined);if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw new KnowledgeValidationError('KNOW_INVENTORY_DUPLICATE','El código de fuente ya existe. Selecciona esa fuente y usa Agregar versión.',409);throw error;}
  }
  async detail(actor:Actor,sourceId:string,versionId:string){
    const version=await this.db.knowledgeSourceVersion.findFirst({where:{id:versionId,source_id:sourceId,organization_id:actor.organizationId},select:{id:true,content_text:true,provenance:true,verification_status:true,checksum_sha256:true}});
    if(!version)throw new KnowledgeValidationError('KNOW_VERSION_NOT_FOUND','La versión no existe en esta organización.',404);
    const p=version.provenance&&typeof version.provenance==='object'&&!Array.isArray(version.provenance)?version.provenance as Record<string,unknown>:{};
    const key=typeof p.storage_key==='string'?p.storage_key:'';
    if(key&&!key.startsWith(`organizations/${actor.organizationId}/knowledge/`))throw new KnowledgeValidationError('KNOW_FILE_SCOPE_DENIED','El archivo no pertenece a esta organización.',403);
    return {...version,provenance:undefined,url:key?await getSignedUrl(key,600):null,file_name:p.file_name||null};
  }
}
