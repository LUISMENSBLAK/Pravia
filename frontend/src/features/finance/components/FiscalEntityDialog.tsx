import { Download, LoaderCircle, UploadCloud, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../../services/api/client';
import { financeService, type CsfExtraction } from '../finance.service';
import type { FiscalEntity } from '../finance.types';
import styles from '../Finance.module.css';

type CatalogItem = { clave: string; descripcion: string; tipo: string };
type Phase = 'idle' | 'uploading' | 'stored' | 'extracting' | 'review' | 'saving';

const errorText = (reason: unknown) => {
  if (!(reason instanceof Error)) return 'No se pudo completar la operación fiscal.';
  if (!(reason instanceof ApiError)) return reason.message;
  const payload = reason.payload && typeof reason.payload === 'object' ? reason.payload as Record<string, unknown> : {};
  return `${reason.message}${payload.correlation_id ? ` Código de referencia: ${payload.correlation_id}.` : ''}`;
};

function Modal({title,subtitle,onClose,children}:{title:string;subtitle:string;onClose:()=>void;children:ReactNode}) {
  return <div className={styles.fiscalOverlay} role="presentation"><section role="dialog" aria-modal="true" aria-label={title}
    className={`${styles.fiscalDialog} ${styles.fiscalDialogWide}`}>
    <header><div><small>Facturación local</small><h2>{title}</h2><p>{subtitle}</p></div>
      <button type="button" onClick={onClose} aria-label="Cerrar"><X/></button></header>{children}</section></div>;
}
function Field({label,children}:{label:string;children:ReactNode}) {
  return <label className={styles.fiscalField}><span>{label}</span>{children}</label>;
}

export function FiscalEntityDialog({onClose,onSaved,replacingEntity}:{onClose:()=>void;onSaved:()=>void;replacingEntity?:FiscalEntity|null}) {
  const [file,setFile]=useState<File|null>(null);
  const [documentId,setDocumentId]=useState('');
  const [sha256,setSha256]=useState('');
  const [filename,setFilename]=useState('');
  const [size,setSize]=useState(0);
  const [progress,setProgress]=useState<number|null>(null);
  const [phase,setPhase]=useState<Phase>('idle');
  const [extraction,setExtraction]=useState<CsfExtraction|null>(null);
  const [catalog,setCatalog]=useState<CatalogItem[]>([]);
  const [catalogQuery,setCatalogQuery]=useState('');
  const [fields,setFields]=useState({rfc:'',razon_social:'',codigo_postal:'',domicilio_fiscal:'',serie:''});
  const [literalChoices,setLiteralChoices]=useState<Record<number,string>>({});
  const [primaryRegime,setPrimaryRegime]=useState('');
  const [reviewed,setReviewed]=useState(false);
  const [manualReview,setManualReview]=useState(false);
  const [manualReason,setManualReason]=useState('');
  const [error,setError]=useState('');

  const applyExtraction=(result:CsfExtraction)=>{
    setExtraction(result);setPhase('review');
    setManualReview(result.regimenes_fiscales.length===0&&result.regimenes_documentales.length===0);
    setReviewed(false);
    setFields(current=>({...current,rfc:result.rfc||'',razon_social:result.razon_social||'',
      codigo_postal:result.codigo_postal||'',domicilio_fiscal:result.domicilio_fiscal||''}));
    const codes=[...result.regimenes_fiscales.map(item=>item.clave),
      ...result.regimenes_documentales.flatMap(item=>item.match?[item.match.clave]:[])];
    setPrimaryRegime(codes.length===1?codes[0]:'');setLiteralChoices({});
  };
  useEffect(()=>{
    let active=true;
    void Promise.all([financeService.fiscalRegimes(),financeService.pendingFiscalEntityCsf()]).then(([nextCatalog,pending])=>{
      if(!active)return;
      setCatalog(nextCatalog.items);
      if(pending){setDocumentId(pending.id);setSha256(pending.sha256);setFilename(pending.filename);setSize(pending.size_bytes);
        if(pending.extraction)applyExtraction(pending.extraction);else setPhase('stored');}
    }).catch(reason=>{if(active)setError(errorText(reason));});
    return()=>{active=false;};
  },[]);

  const extract=async(id:string)=>{
    setPhase('extracting');setError('');
    try{applyExtraction(await financeService.extractFiscalEntityCsf(id));}
    catch(reason){setPhase('stored');setError(`La constancia quedó almacenada, pero no se pudo extraer. ${errorText(reason)}`);}
  };
  const upload=async(next:File|null)=>{
    if(!next)return;
    setFile(next);setError('');setExtraction(null);setReviewed(false);setManualReview(false);
    if(!next.name.toLowerCase().endsWith('.pdf')||(next.type&&next.type!=='application/pdf')){
      setError('Selecciona una Constancia de Situación Fiscal en PDF.');return;
    }
    setPhase('uploading');setProgress(null);
    try{
      const saved=await financeService.uploadFiscalEntityCsf(next,(loaded,total)=>setProgress(Math.round(100*loaded/total)));
      setDocumentId(saved.id);setSha256(saved.sha256);setFilename(saved.filename);setSize(saved.size_bytes);
      setPhase('stored');await extract(saved.id);
    }catch(reason){setPhase('idle');setError(errorText(reason));}
  };
  const mappedCodes=[...new Set([...(extraction?.regimenes_fiscales.map(item=>item.clave)||[]),
    ...(extraction?.regimenes_documentales.flatMap((item,index)=>item.match?[item.match.clave]:literalChoices[index]?[literalChoices[index]]:[])||[]),
    ...(manualReview&&primaryRegime?[primaryRegime]:[])])]
    .filter(code=>catalog.some(item=>item.clave===code));
  const visibleCatalog=catalog.filter(item=>`${item.clave} ${item.descripcion}`.normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(catalogQuery.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()));
  const unmapped=extraction?.regimenes_documentales.filter((item,index)=>!item.match&&!literalChoices[index])||[];
  const correctedFields=Boolean(extraction&&(['rfc','razon_social','codigo_postal'] as const).some(key=>
    extraction[key]&&String(extraction[key]).trim().toUpperCase()!==fields[key].trim().toUpperCase()));
  const update=(key:keyof typeof fields,value:string)=>setFields(current=>({...current,[key]:value}));
  const save=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setError('');
    if(!documentId||!sha256){setError('Carga primero la constancia fiscal.');return;}
    if(!reviewed){setError('Confirma los datos fiscales antes de guardar.');return;}
    if(unmapped.length){setError('Relaciona cada régimen literal con una clave verificada.');return;}
    if(!primaryRegime||!mappedCodes.includes(primaryRegime)){setError('Selecciona un régimen principal confirmado.');return;}
    if((manualReview||Object.values(literalChoices).some(Boolean)||correctedFields)&&manualReason.trim().length<20){
      setError('Explica la revisión manual o correspondencia fiscal (mínimo 20 caracteres).');return;
    }
    setPhase('saving');
    try{
      const payload={...fields,regimen_fiscal:primaryRegime,
        regimenes_fiscales:mappedCodes.map(clave=>({clave})),csf_documento_id:documentId,
        csf_sha256:sha256,csf_reviewed:true,manual_exception_reason:manualReason.trim()};
      if(replacingEntity)await financeService.replaceFiscalEntityCsf(replacingEntity.id,payload);
      else await financeService.createFiscalEntity(payload);
      onSaved();
    }catch(reason){setPhase('review');setError(errorText(reason));}
  };
  return <Modal title={replacingEntity?'Sustituir CSF':'Agregar entidad fiscal'} subtitle={replacingEntity?`Nueva versión para ${replacingEntity.razon_social}; la anterior permanecerá disponible.`:'Carga primero la CSF; revisa y confirma antes de guardar.'} onClose={onClose}>
    <form onSubmit={event=>void save(event)}>
      <div className={styles.fiscalCsfDrop} onDragOver={event=>event.preventDefault()}
        onDrop={event=>{event.preventDefault();void upload(event.dataTransfer.files[0]||null);}}>
        <UploadCloud/><strong>Cargar Constancia de Situación Fiscal</strong><span>PDF privado · selecciona o arrastra el archivo</span>
        <input aria-label="Cargar Constancia de Situación Fiscal" type="file" accept=".pdf,application/pdf"
          disabled={['uploading','extracting','saving'].includes(phase)} onChange={event=>void upload(event.target.files?.[0]||null)}/>
      </div>
      {(file||filename)&&<p className={styles.fiscalHint}>{filename||file?.name} · {((size||file?.size||0)/1024).toFixed(1)} KB</p>}
      {phase==='uploading'&&<div role="status" className={styles.fiscalCsfStatus}>Subiendo constancia… {progress===null?'conectando':`${progress}%`}{progress!==null&&<progress value={progress} max={100}/>}</div>}
      {phase==='stored'&&<div role="status" className={styles.fiscalCsfStatus}>Constancia almacenada de forma privada.
        <button type="button" onClick={()=>void extract(documentId)}>Reintentar extracción</button>
        <button type="button" onClick={()=>{setManualReview(true);setPhase('review');}}>Revisión manual justificada</button></div>}
      {phase==='extracting'&&<p role="status" className={styles.fiscalCsfStatus}><LoaderCircle className={styles.invoiceSpinner}/> Extrayendo datos fiscales del PDF guardado…</p>}
      {(phase==='review'||phase==='saving')&&<>
        <fieldset className={styles.fiscalEditorSection}><legend>Datos fiscales · desde la CSF</legend>
          <p className={styles.fiscalHint}>{extraction?`Extracción ${extraction.status} · ${extraction.source}. Revisa cada campo; los ausentes no se inventan.`:'La extracción no concluyó. Completa sólo tras revisar el PDF original.'}</p>
          <div className={styles.fiscalFormGrid}>
            <Field label="RFC"><input required value={fields.rfc} onChange={event=>update('rfc',event.target.value.toUpperCase())}/></Field>
            <Field label="Nombre o razón social"><input required value={fields.razon_social} onChange={event=>update('razon_social',event.target.value)}/></Field>
            <Field label="Código postal fiscal"><input required inputMode="numeric" maxLength={5} value={fields.codigo_postal} onChange={event=>update('codigo_postal',event.target.value)}/></Field>
            <Field label="Domicilio fiscal detectado"><input value={fields.domicilio_fiscal} onChange={event=>update('domicilio_fiscal',event.target.value)}/></Field>
          </div>
          {extraction?.fecha_csf&&<p className={styles.fiscalHint}>Fecha detectada: {extraction.fecha_csf}</p>}
          {extraction?.conflicts.length?<p role="alert" className={styles.fiscalError}>Discrepancias: {extraction.conflicts.join('; ')}</p>:null}
          <Field label="Buscar régimen SAT por clave o descripción"><input type="search" value={catalogQuery}
            onChange={event=>setCatalogQuery(event.target.value)} placeholder="Ej. 612 o actividades empresariales"/></Field>
          {extraction?.regimenes_documentales.map((item,index)=><Field key={`${item.descripcion}-${index}`} label={`Régimen detectado: ${item.descripcion}${item.fecha_inicio?` · desde ${item.fecha_inicio}`:''}`}>
            {item.match?<input readOnly value={`${item.match.clave} — ${item.match.descripcion} · catálogo SAT`}/>:
              <select value={literalChoices[index]||''} onChange={event=>setLiteralChoices(current=>({...current,[index]:event.target.value}))}>
                <option value="">Confirmar clave desde catálogo</option>{catalog.filter(option=>visibleCatalog.includes(option)||option.clave===literalChoices[index]).map(option=><option key={option.clave} value={option.clave}>{option.clave} — {option.descripcion}</option>)}</select>}
          </Field>)}
          {manualReview&&<Field label="Régimen confirmado por revisión humana"><select value={primaryRegime} onChange={event=>setPrimaryRegime(event.target.value)}><option value="">Seleccionar clave verificada</option>{catalog.filter(item=>visibleCatalog.includes(item)||item.clave===primaryRegime).map(item=><option key={item.clave} value={item.clave}>{item.clave} — {item.descripcion}</option>)}</select></Field>}
          {!manualReview&&mappedCodes.length>0&&<Field label="Régimen principal para la emisión"><select required value={primaryRegime} onChange={event=>setPrimaryRegime(event.target.value)}><option value="">Elegir régimen confirmado</option>{mappedCodes.map(code=><option key={code} value={code}>{code} — {catalog.find(item=>item.clave===code)?.descripcion}</option>)}</select></Field>}
          {extraction?.actividades_economicas.length?<p className={styles.fiscalHint}>Actividades detectadas: {extraction.actividades_economicas.map(item=>item.descripcion).join('; ')}</p>:null}
          {(manualReview||Object.values(literalChoices).some(Boolean)||correctedFields)&&<Field label="Motivo de correspondencia o corrección manual"><input required minLength={20} value={manualReason} onChange={event=>setManualReason(event.target.value)}/></Field>}
        </fieldset>
        <fieldset className={styles.fiscalEditorSection}><legend>Configuración de emisión · separada de la CSF</legend>
          <p className={styles.fiscalHint}>La serie es opcional. CSD y PAC no son necesarios para guardar entidad, borrador o prefactura; sin ellos no hay timbrado.</p>
          <Field label="Serie opcional"><input value={fields.serie} onChange={event=>update('serie',event.target.value)}/></Field>
        </fieldset>
        <label className={styles.fiscalCsfConfirm}><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/> Revisé la constancia y confirmo los datos fiscales.</label>
      </>}
      {error&&<p className={styles.fiscalError} role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Cerrar</button><button type="submit" className={styles.fiscalPrimary}
        disabled={phase!=='review'||!reviewed||!documentId||!primaryRegime||unmapped.length>0}>{phase==='saving'?'Guardando constancia…':replacingEntity?'Guardar nueva versión':'Guardar entidad fiscal'}</button></footer>
    </form>
  </Modal>;
}

export function FiscalEntityDetailDialog({entity,canReadDocument,canReplace,onReplace,onClose}:{entity:FiscalEntity;canReadDocument:boolean;canReplace:boolean;onReplace:()=>void;onClose:()=>void}) {
  const [error,setError]=useState('');
  const [versions,setVersions]=useState<Awaited<ReturnType<typeof financeService.fiscalEntityCsfVersions>>>([]);
  useEffect(()=>{if(canReadDocument)void financeService.fiscalEntityCsfVersions(entity.id).then(setVersions).catch(reason=>setError(errorText(reason)));},[canReadDocument,entity.id]);
  const open=async(download:boolean,version?:number)=>{
    const preview=download?null:window.open('','_blank');
    try{
    const file=version?await financeService.fiscalEntityCsfVersionUrl(entity.id,version):await financeService.fiscalEntityCsfUrl(entity.id);
    if(download){const response=await fetch(file.url);if(!response.ok)throw new Error('La constancia no está disponible.');
      const blob=await response.blob();const url=URL.createObjectURL(blob);const anchor=document.createElement('a');
      anchor.href=url;anchor.download=file.filename;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),60_000);
    }else if(preview)preview.location.href=file.url;
    else window.location.href=file.url;
  }catch(reason){preview?.close();setError(errorText(reason));}};
  return <Modal title="Ficha de entidad fiscal" subtitle="Datos confirmados de la organización activa" onClose={onClose}>
    <div className={styles.fiscalEntityDetail}><h3>{entity.razon_social}</h3><p>RFC {entity.rfc} · CP {entity.codigo_postal}</p>
      <p>Regímenes: {(entity.regimenes_fiscales?.length?entity.regimenes_fiscales:[{clave:entity.regimen_fiscal,descripcion:'Histórico'}]).map(item=>`${item.clave} ${item.descripcion}`).join('; ')}</p>
      <p>Régimen principal: {entity.regimen_fiscal} · Serie: {entity.serie||'sin configurar'}</p>
      <p>Timbrado: {entity.csd_key_configured&&entity.csd_password_configured&&entity.pac_secret_configured?'referencias registradas':'no disponible · falta PAC/CSD'}</p>
      {entity.csf_documento_id&&canReadDocument&&<div><button type="button" onClick={()=>void open(false)}>Ver CSF original</button><button type="button" onClick={()=>void open(true)}><Download/> Descargar CSF</button></div>}
      {canReplace&&<button type="button" onClick={onReplace}>Sustituir CSF</button>}
      {versions.length>0&&<section aria-label="Historial de constancias fiscales"><h4>Versiones de la CSF</h4><ul>{versions.map(item=><li key={item.id}>
        <span>v{item.version} · {item.documento.nombre_original} · {new Date(item.confirmed_at).toLocaleString('es-MX')} · SHA-256 {item.documento.checksum_sha256?.slice(0,12)}…</span>
        <button type="button" onClick={()=>void open(false,item.version)}>Ver v{item.version}</button>
        <button type="button" onClick={()=>void open(true,item.version)}>Descargar v{item.version}</button>
      </li>)}</ul></section>}
      {error&&<p role="alert" className={styles.fiscalError}>{error}</p>}
      <button type="button" onClick={onClose}>Cerrar</button>
    </div>
  </Modal>;
}
