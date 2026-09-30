import fs from 'fs/promises';
import JSZip from 'jszip';
import { normalizeInventoryRow } from './knowledge.service';

const decode = (value: string) => value.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const text = (xml: string) => decode([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match)=>match[1]).join(''));
const column = (ref: string) => [...ref.replace(/\d/g,'')].reduce((result,char)=>result*26+char.charCodeAt(0)-64,0)-1;

export async function readKnowledgeInventoryXlsx(path: string) {
  const zip=await JSZip.loadAsync(await fs.readFile(path));
  const sharedEntry=zip.file('xl/sharedStrings.xml'); const shared=sharedEntry?await sharedEntry.async('string'):'';
  const strings=[...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match)=>text(match[1]));
  const workbook=await zip.file('xl/workbook.xml')?.async('string'); const rels=await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if(!workbook||!rels) throw new Error('El XLSX no contiene un libro válido.');
  const attr=(tag:string,name:string)=>new RegExp(`${name}="([^"]+)"`).exec(tag)?.[1]||'';
  const sheetTag=[...workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)].map((match)=>match[0]).find((tag)=>decode(attr(tag,'name')).toUpperCase()==='FUENTES');
  if(!sheetTag) throw new Error('El XLSX no contiene la hoja FUENTES.');
  const sheetRelationId=attr(sheetTag,'r:id');
  const relationTag=[...rels.matchAll(/<Relationship\b[^>]*>/g)].map((match)=>match[0]).find((tag)=>attr(tag,'Id')===sheetRelationId);
  const relation=relationTag?{target:attr(relationTag,'Target')}:null;
  if(!relation) throw new Error('No se pudo resolver la hoja FUENTES.');
  const sheetPath=`xl/${relation.target.replace(/^\//,'').replace(/^xl\//,'')}`; const worksheet=await zip.file(sheetPath)?.async('string');
  if(!worksheet) throw new Error('No se pudo leer la hoja FUENTES.');
  const rows=[...worksheet.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)].map((row)=>{
    const values:string[]=[];
    for(const cell of row[1].matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g)){
      const ref=/\br="([^"]+)"/.exec(cell[1])?.[1]||''; const type=/\bt="([^"]+)"/.exec(cell[1])?.[1]||'';
      const raw=/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(cell[2])?.[1]; const inline=/<(?:\w+:)?is>([\s\S]*?)<\/(?:\w+:)?is>/.exec(cell[2])?.[1];
      values[column(ref)]=type==='s'?strings[Number(raw)]||'':type==='inlineStr'?text(inline||''):decode(raw||'');
    }
    return values;
  });
  const data=rows.slice(1).filter((row)=>row[0]).map((row)=>normalizeInventoryRow({
    inventory_code:row[0], jurisdiction:row[1], priority:row[2], category:row[3], title:row[4], authority:row[8], source_url:row[10],
    applicability: JSON.stringify({ materia:row[5]||null, uso_en_pravia:row[6]||null, reforma_corte:row[7]||null, publicacion_oficial:row[9]||null, accion:row[11]||null, observaciones:row[12]||null }),
    ingestion_status: row[11]==='OBTENER ORIGINAL OFICIAL'?'PENDIENTE_ORIGINAL':row[11]==='OBTENER TEXTO OFICIAL'?'PENDIENTE_TEXTO_OFICIAL':row[11]==='INGESTAR'?'LISTA_PARA_INGESTA':'INVENTARIADA',
  }));
  return data;
}
