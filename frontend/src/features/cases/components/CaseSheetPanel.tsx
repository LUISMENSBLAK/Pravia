import { useEffect, useState } from 'react';
import { FileText, LoaderCircle, RefreshCw } from 'lucide-react';
import { apiRequest } from '../../../services/api/client';
import { DocumentViewer } from '../../../components/documents/DocumentViewer';
import { downloadPrivateUrl } from '../../../components/documents/documentDownload';
import styles from '../Expedientes.module.css';
type Sheet={documento:{id:string;nombre_original:string;mime_type:string;checksum_sha256:string};created_at:string};
type Data={format:{available:boolean;name?:string;reason?:string};versions:Sheet[]};
export function CaseSheetPanel({id,canWrite}:{id:string;canWrite:boolean}) {
  const [data,setData]=useState<Data>();const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [viewer,setViewer]=useState<{name:string;mimeType:string;url:string}>();
  const load=()=>apiRequest<Data>(`/expedientes/${encodeURIComponent(id)}/ficha`).then(setData);
  useEffect(()=>{const controller=new AbortController();void apiRequest<Data>(`/expedientes/${encodeURIComponent(id)}/ficha`,{signal:controller.signal}).then(setData).catch(()=>{if(!controller.signal.aborted)setError('No pudimos consultar la ficha del expediente.');});return()=>controller.abort();},[id]);
  const generate=async()=>{setBusy(true);setError('');try{await apiRequest(`/expedientes/${encodeURIComponent(id)}/ficha`,{method:'POST',body:JSON.stringify({idempotency_key:crypto.randomUUID()})});await load();}catch(reason){setError(reason instanceof Error?reason.message:'No pudimos generar la ficha.');}finally{setBusy(false);}};
  const open=async(sheet:Sheet)=>{try{const file=await apiRequest<{url:string}>(`/expedientes/${encodeURIComponent(id)}/ficha/${encodeURIComponent(sheet.documento.id)}/url`);setViewer({name:sheet.documento.nombre_original,mimeType:sheet.documento.mime_type,url:file.url});}catch{setError('No pudimos abrir la ficha privada.');}};
  return <section className={styles.sectionCard} aria-label="Ficha de expediente"><header><div><h2>Ficha de expediente</h2><p>Usa el formato activo de CFG-002. Regenerar crea una versión nueva con datos actuales; las anteriores se conservan.</p></div>{canWrite&&<button type="button" className={styles.secondaryButton} disabled={busy||!data?.format.available} onClick={()=>void generate()}>{busy?<LoaderCircle className={styles.spin}/>:<RefreshCw/>}{busy?'Generando ficha…':'Generar ficha actualizada'}</button>}</header>{error&&<p role="alert">{error}</p>}{data&&!data.format.available&&<p role="status">{data.format.reason} No se genera una ficha ficticia.</p>}{data?.versions.map(sheet=><button type="button" key={sheet.documento.id} className={styles.secondaryButton} onClick={()=>void open(sheet)}><FileText/>{sheet.documento.nombre_original}</button>)}{data?.format.available&&!data.versions.length&&<p>No hay una ficha generada todavía.</p>}{viewer&&<DocumentViewer open name={viewer.name} mimeType={viewer.mimeType} url={viewer.url} onClose={()=>setViewer(undefined)} onDownload={()=>void downloadPrivateUrl(viewer.url,viewer.name)}/>}</section>;
}
