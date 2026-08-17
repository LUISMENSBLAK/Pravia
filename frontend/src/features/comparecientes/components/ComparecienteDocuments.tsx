import { Bot, Download, Eye, FileText, LoaderCircle, Sparkles, Trash2, UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DocumentViewer } from '../../../components/documents/DocumentViewer';
import { comparecientesService } from '../comparecientes.service';
import styles from '../Comparecientes.module.css';

export type WorkspaceDocument = { id: string; name: string; mimeType?: string; size?: number; temporary?: boolean };

type Props = {
  comparecienteId?: string;
  sessionId?: string;
  documents: WorkspaceDocument[];
  canUpload: boolean;
  canDelete: boolean;
  canExtract: boolean;
  busy?: boolean;
  extractionState?: string;
  onUpload(files: File[]): Promise<void>;
  onDelete(document: WorkspaceDocument): Promise<void>;
  onExtract(): Promise<void>;
};

export function ComparecienteDocuments(props: Props) {
  const [dragging,setDragging]=useState(false); const [selected,setSelected]=useState<WorkspaceDocument|null>(null); const [viewerUrl,setViewerUrl]=useState(''); const [viewerState,setViewerState]=useState<'idle'|'loading'|'error'>('idle'); const [deleteTarget,setDeleteTarget]=useState<WorkspaceDocument|null>(null); const [error,setError]=useState(''); const inputRef=useRef<HTMLInputElement>(null);
  useEffect(()=>()=>{ if(viewerUrl) URL.revokeObjectURL(viewerUrl); },[viewerUrl]);
  const openPreview=async(document:WorkspaceDocument)=>{ setSelected(document); setViewerState('loading'); setError(''); if(viewerUrl) URL.revokeObjectURL(viewerUrl); setViewerUrl(''); try { const url=document.temporary ? await comparecientesService.previewAssistedDocument(props.sessionId!,document.id) : await comparecientesService.previewDocument(props.comparecienteId!,document.id); setViewerUrl(url); setViewerState('idle'); } catch { setViewerState('error'); setError('No pudimos preparar la vista previa. Puedes descargar el archivo.'); } };
  const download=async(document:WorkspaceDocument)=>{ setError(''); try { if(document.temporary) await comparecientesService.downloadAssistedDocument(props.sessionId!,document.id,document.name); else await comparecientesService.downloadDocument(props.comparecienteId!,document.id,document.name); } catch { setError('No pudimos descargar el documento.'); } };
  const receive=async(files:FileList|File[])=>{ const list=Array.from(files); if(!list.length)return; setError(''); try{await props.onUpload(list);}catch(err){setError(err instanceof Error?err.message:'No pudimos cargar los documentos.');}finally{if(inputRef.current)inputRef.current.value='';}};
  const confirmDelete=async()=>{if(!deleteTarget)return;setError('');try{await props.onDelete(deleteTarget);setDeleteTarget(null);}catch(err){setError(err instanceof Error?err.message:'No pudimos eliminar el documento.');}};
  return <section className={styles.workspaceDocuments} aria-labelledby="documents-title"><header><div><span>Archivo privado</span><h2 id="documents-title">Documentación</h2><p>{props.documents.length} documento{props.documents.length===1?'':'s'} vinculado{props.documents.length===1?'':'s'}</p></div></header>
    {props.canUpload&&<label className={`${styles.workspaceUpload} ${dragging?styles.workspaceUploadActive:''}`} onDragEnter={(event)=>{event.preventDefault();setDragging(true)}} onDragOver={(event)=>event.preventDefault()} onDragLeave={()=>setDragging(false)} onDrop={(event)=>{event.preventDefault();setDragging(false);void receive(event.dataTransfer.files)}}><UploadCloud/><strong>{props.busy?'Cargando…':'Arrastra archivos aquí'}</strong><span>o selecciona PDF, PNG, JPG, BMP, DOC o DOCX</span><b>Cargar documento</b><input ref={inputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.bmp,.doc,.docx" disabled={props.busy} onChange={(event)=>void receive(event.target.files||[])} /></label>}
    {error&&<p className={styles.workspaceError} role="alert">{error}</p>}
    <div className={styles.workspaceDocumentList}>{props.documents.length===0?<div className={styles.workspaceDocumentEmpty}><FileText/><strong>Sin documentos cargados</strong><p>Puedes comenzar por la documentación; después PRAVIA IA propondrá únicamente datos respaldados.</p></div>:props.documents.map((document)=><article key={document.id}><span><FileText/></span><div><strong>{document.name}</strong><small>{document.temporary?'Pendiente de registrar':'Vinculado al expediente documental'}{document.size?` · ${Math.max(1,Math.round(document.size/1024))} KB`:''}</small></div><nav aria-label={`Acciones de ${document.name}`}><button type="button" onClick={()=>void openPreview(document)} aria-label={`Previsualizar ${document.name}`}><Eye/></button><button type="button" onClick={()=>void download(document)} aria-label={`Descargar ${document.name}`}><Download/></button>{props.canDelete&&<button type="button" onClick={()=>setDeleteTarget(document)} aria-label={`Eliminar ${document.name}`}><Trash2/></button>}</nav></article>)}</div>
    {props.canExtract&&<section className={styles.extractionCard}><span><Sparkles/></span><div><h2>Extracción con IA</h2><p>Analiza todos los documentos y completa un borrador. Nada se guarda sin tu revisión.</p></div><button type="button" disabled={props.busy||!props.documents.length} onClick={()=>void props.onExtract()}>{props.busy?<LoaderCircle className={styles.spin}/>:<Bot/>}{props.extractionState||'Extraer información con IA'}</button></section>}
    <DocumentViewer open={Boolean(selected)} name={selected?.name||''} mimeType={selected?.mimeType} url={viewerUrl} loading={viewerState==='loading'} error={viewerState==='error'?error:undefined} onClose={()=>{setSelected(null);if(viewerUrl)URL.revokeObjectURL(viewerUrl);setViewerUrl('')}} onDownload={selected?()=>void download(selected):undefined}/>
    {deleteTarget&&<div className={styles.dialogBackdrop} role="presentation"><section className={styles.deleteDialog} role="alertdialog" aria-modal="true" aria-labelledby="delete-document-title"><span><Trash2/></span><h2 id="delete-document-title">Eliminar documento</h2><p>Se retirará “{deleteTarget.name}” de esta ficha y se conservará la trazabilidad correspondiente.</p><footer><button type="button" className={styles.secondaryButton} onClick={()=>setDeleteTarget(null)}>Cancelar</button><button type="button" className={styles.dangerButton} onClick={()=>void confirmDelete()}>Eliminar documento</button></footer></section></div>}
  </section>;
}
