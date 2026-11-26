import { PDFDocument } from 'pdf-lib';
import { DOCX_MIME, renderFunctionalDocumentBuffer } from './functionalDocumentRenderer.service';
import { generateOperationalArtifactWithOpenAI, planLiteralProjectPatchesWithOpenAI } from './openaiDocument.service';
import { completeLiteralProjectPatchPlan, docxLiteralSegments, renderLiteralProjectTemplate } from './projectGeneration.service';
import { PlatformDomainError } from '../platform/platform.errors';

type Input=Parameters<typeof generateOperationalArtifactWithOpenAI>[0];
/** Keep each master intact. Never replace a nonfillable PDF with a generic summary. */
export async function renderOperationalFormat(source:Buffer,mime:string,input:Input){
 let variables=[...new Set([...input.masterText.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g)].map(m=>m[1]))];
 if(mime==='application/pdf'){
  const pdf=await PDFDocument.load(source);
  const fields=pdf.getForm().getFields();
  if(fields.some(f=>f.constructor.name==='PDFSignature'))throw new PlatformDomainError('EXP006_SIGNED_MASTER','No se modifica una plantilla con campos de firma. Configura una copia sin firma para rellenado.',422);
  if(fields.some(f=>f.constructor.name!=='PDFTextField'))throw new PlatformDomainError('EXP006_PDF_SPECIAL_FIELDS','Este PDF contiene casillas o campos especiales que requieren mapeo específico antes de generar.',422);
  variables=fields.map(f=>f.getName());
 }
 if(variables.length>100)throw new PlatformDomainError('EXP006_MAPPING_LIMIT','El formato supera 100 variables. Divide el formato en secciones.',422);
 if(!variables.length&&mime===DOCX_MIME){
  const segments=await docxLiteralSegments(source);
  if(!segments.length||segments.length>600)throw new PlatformDomainError('EXP006_LITERAL_LIMIT','El formato Word requiere entre 1 y 600 párrafos legibles para rellenado literal.',422);
  const planned=await planLiteralProjectPatchesWithOpenAI({purpose:'OPERATIONAL_FORM',templateName:input.artifactName,templateSegments:segments,canonicalFacts:input.structuredData,
   sourceDocuments:input.currentPartyDocuments.map(d=>({...d,extracted:{}})),
   instructions:`Rellena solamente este formato, preservando etiquetas, títulos, avisos jurídicos, tabla y redacción fija. Política de fuentes: ${input.sourcePolicy||'SAME_PARTY_CURRENT_ONLY'}. No asignes a una persona los datos de otra. Datos no acreditados = pendiente concreto. No inventes declaraciones de voluntad, firmas, calidad, autorizaciones ni respuestas a cuestionarios.`,economicContext:input.economicContext});
  const completed=completeLiteralProjectPatchPlan(planned,segments);
  const result=await renderLiteralProjectTemplate(source,completed,input.currentPartyDocuments.map(d=>d.id));
  return {buffer:result.buffer,mimeType:DOCX_MIME,extension:'docx',missing_fields:completed.missing_fields,conflicts:completed.conflicts,model:completed.model,possible_residues:completed.possible_residues};
 }
 if(!variables.length)throw new PlatformDomainError('EXP006_MAPPING_REQUIRED','Este PDF no tiene campos rellenables. Configura campos o una versión Word; no se alteró el original ni se inventó un formato sustituto.',422);
 const generation=await generateOperationalArtifactWithOpenAI({...input,variables});
 const values=Object.fromEntries(variables.map(field=>[field,generation.mapped_fields?.find(f=>f.field===field)?.value??null]));
 const result=await renderFunctionalDocumentBuffer(source,mime,values,undefined,{strictMapping:true});
 const absent=variables.filter(field=>values[field]===null);
 return {...result,missing_fields:[...new Set([...generation.missing_fields,...absent])],conflicts:generation.conflicts,model:generation.model,possible_residues:[]};
}
