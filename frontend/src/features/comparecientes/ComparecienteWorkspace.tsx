import { AlertTriangle, ArrowLeft, Check, ChevronRight, LoaderCircle, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { useAuth } from '../auth/AuthProvider';
import { comparecientesService } from './comparecientes.service';
import type { ComparecienteDetail, NewComparecienteDraft } from './comparecientes.types';
import { ComparecienteDocuments, type WorkspaceDocument } from './components/ComparecienteDocuments';
import { ComparecienteForm } from './components/ComparecienteForm';
import styles from './Comparecientes.module.css';

const initialDraft: NewComparecienteDraft = {
  tipo_persona:'FISICA', nombre:'', apellido_paterno:'', apellido_materno:'', razon_social:'', nombre_comercial:'', tipo_societario:'',
  rfc:'',curp:'',nacionalidad:'Mexicana',pais_nacimiento:'México',pep_estado:'PENDIENTE',telefono:'',correo:'',aliases:'',
  dom_particular_pais:'México',dom_fiscal_pais:'México',tipo_identificacion:'INE',pais_emisor:'México',observaciones:'',
};
const dateValue=(value?:unknown)=>value?new Date(String(value)).toISOString().slice(0,10):'';
const text=(value:unknown)=>value===null||value===undefined?'':String(value);

function detailToDraft(item:ComparecienteDetail):NewComparecienteDraft{
  const profile=(item.tipo_persona==='FISICA'?item.personaFisica:item.personaMoral)||{};
  const particular=item.domicilios.find((entry:any)=>entry.tipo==='PARTICULAR')||{};
  const fiscal=item.domicilios.find((entry:any)=>entry.tipo==='FISCAL')||{};
  const identification=item.identificaciones.find((entry:any)=>entry.principal)||item.identificaciones[0]||{};
  const phone=item.contactos.find((entry:any)=>entry.tipo==='TELEFONO')?.valor||'';
  const email=item.contactos.find((entry:any)=>entry.tipo==='CORREO')?.valor||'';
  const address=(prefix:string,value:any)=>({
    [`${prefix}_calle`]:text(value.calle),[`${prefix}_exterior`]:text(value.exterior),[`${prefix}_interior`]:text(value.interior),
    [`${prefix}_colonia`]:text(value.colonia),[`${prefix}_codigo_postal`]:text(value.codigo_postal),[`${prefix}_municipio`]:text(value.municipio),
    [`${prefix}_localidad`]:text(value.localidad),[`${prefix}_estado`]:text(value.estado),[`${prefix}_pais`]:text(value.pais||'México'),
  });
  return {...initialDraft,tipo_persona:item.tipo_persona,
    nombre:text(profile.nombre),apellido_paterno:text(profile.apellido_paterno),apellido_materno:text(profile.apellido_materno),
    razon_social:text(profile.razon_social),nombre_comercial:text(profile.nombre_comercial),tipo_societario:text(profile.tipo_societario),
    rfc:text(profile.rfc),curp:text(profile.curp),sexo:text(profile.sexo),fecha_nacimiento:dateValue(profile.fecha_nacimiento),lugar_nacimiento:text(profile.lugar_nacimiento),pais_nacimiento:text(profile.pais_nacimiento||'México'),
    nacionalidad:text(profile.nacionalidad||'Mexicana'),estado_civil:text(profile.estado_civil),regimen_matrimonial:text(profile.regimen_matrimonial),escolaridad:text(profile.escolaridad),ocupacion:text(profile.ocupacion),actividad_economica:text(profile.actividad_economica),giro:text(profile.giro),pep_estado:text(profile.pep_estado||'PENDIENTE'),relacion_pep:text(profile.relacion_pep),
    duracion:text(profile.duracion),fecha_constitucion:dateValue(profile.fecha_constitucion),folio_mercantil:text(profile.folio_mercantil),fecha_inscripcion_mercantil:dateValue(profile.fecha_inscripcion_mercantil),estatus_societario:text(profile.estatus_societario),objeto_social_resumido:text(profile.objeto_social_resumido),
    aliases:(item as any).aliases?.map((entry:any)=>entry.alias).join(', ')||'',telefono:phone,correo:email,
    ...address('dom_particular',particular),...address('dom_fiscal',fiscal),
    tipo_identificacion:text(identification.tipo_identificacion||'INE'),folio_identificacion:text(identification.numero),autoridad_emisora:text(identification.autoridad_emisora),pais_emisor:text(identification.pais_emisor||'México'),fecha_expedicion_identificacion:dateValue(identification.fecha_expedicion),fecha_vencimiento_identificacion:dateValue(identification.fecha_vencimiento),
    observaciones:text(item.observaciones),
  };
}

const addressPayload=(draft:NewComparecienteDraft,prefix:string)=>({calle:draft[`${prefix}_calle`],exterior:draft[`${prefix}_exterior`],interior:draft[`${prefix}_interior`],colonia:draft[`${prefix}_colonia`],codigo_postal:draft[`${prefix}_codigo_postal`],municipio:draft[`${prefix}_municipio`],localidad:draft[`${prefix}_localidad`],estado:draft[`${prefix}_estado`],pais:draft[`${prefix}_pais`]||'México'});
const updatePayload=(draft:NewComparecienteDraft)=>({...draft,aliases:(draft.aliases||'').split(',').map(value=>value.trim()).filter(Boolean),domicilio_particular:addressPayload(draft,'dom_particular'),domicilio_fiscal:addressPayload(draft,'dom_fiscal'),identificacion:{tipo_identificacion:draft.tipo_identificacion,numero:draft.folio_identificacion,autoridad_emisora:draft.autoridad_emisora,pais_emisor:draft.pais_emisor,fecha_expedicion:draft.fecha_expedicion_identificacion,fecha_vencimiento:draft.fecha_vencimiento_identificacion}});

export function ComparecienteWorkspace(){
  const {id=''}=useParams(); const createMode=id==='nuevo'; const navigate=useNavigate(); const {user}=useAuth();
  const [item,setItem]=useState<ComparecienteDetail|null>(null); const [draft,setDraft]=useState<NewComparecienteDraft>(initialDraft); const [status,setStatus]=useState<'loading'|'ready'|'error'>(createMode?'ready':'loading');
  const [sessionId,setSessionId]=useState(''); const [temporaryDocuments,setTemporaryDocuments]=useState<WorkspaceDocument[]>([]); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [error,setError]=useState(''); const [sources,setSources]=useState<Record<string,any>>({}); const [dirty,setDirty]=useState(false); const [extractionState,setExtractionState]=useState('');
  const canWrite=createMode?Boolean(user?.permissions?.includes('comparecientes.write')):Boolean(item?.capabilities.canEdit);
  const canUpload=createMode?canWrite&&Boolean(user?.permissions?.includes('documentos.write')):Boolean(item?.capabilities.canUploadDocuments);
  const canDelete=createMode?canWrite&&Boolean(user?.permissions?.includes('documentos.unlink')):Boolean(item?.capabilities.canDeleteDocuments);
  const canExtract=createMode?canWrite&&Boolean(user?.permissions?.includes('documentos.read'))&&Boolean(user?.permissions?.includes('ia.execute')):Boolean(item?.capabilities.canExtractWithAI);
  const documents=useMemo<WorkspaceDocument[]>(()=>createMode?temporaryDocuments:(item?.documentos||[]).map((link:any)=>({id:link.documento.id,name:link.documento.nombre_original,mimeType:link.documento.mime_type,size:link.documento.size_bytes})),[createMode,temporaryDocuments,item]);
  const load=async(signal?:AbortSignal)=>{if(createMode)return;try{const result=await comparecientesService.detail(id,signal);setItem(result);setDraft(detailToDraft(result));setStatus('ready');setDirty(false);}catch(err){if(!(err instanceof DOMException&&err.name==='AbortError'))setStatus('error')}};
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort()},[id]);
  useEffect(()=>{document.documentElement.scrollTop=0;document.body.scrollTop=0},[id]);
  const change=(name:string,value:string)=>{setDraft(current=>({...current,[name]:value}));setDirty(true);setMessage('');};
  const ensureSession=async()=>{if(sessionId)return sessionId;const response=await comparecientesService.startAssisted(draft.tipo_persona);setSessionId(response.session.id);return response.session.id;};
  const upload=async(files:File[])=>{setBusy(true);setError('');try{if(createMode){const session=await ensureSession();const uploaded:WorkspaceDocument[]=[];for(const file of files){const response=await comparecientesService.uploadAssisted(session,file);uploaded.push({id:response.documento.id,name:response.documento.nombre_original,mimeType:file.type,size:file.size,temporary:true})}setTemporaryDocuments(current=>[...current,...uploaded]);}else{for(const file of files)await comparecientesService.uploadDocument(id,file,'OTROS');await load();}}finally{setBusy(false)}};
  const remove=async(document:WorkspaceDocument)=>{setBusy(true);try{if(document.temporary){await comparecientesService.deleteAssistedDocument(sessionId,document.id);setTemporaryDocuments(current=>current.filter(entry=>entry.id!==document.id));}else{await comparecientesService.deleteDocument(id,document.id);await load();}}finally{setBusy(false)}};
  const applyExtraction=(response:any)=>{
    const proposal=response.proposals||response.propuesta||response._ia_propuesta||response.borrador_actualizado?._ia_propuesta||{};
    const values={...(response.values||response.borrador_actualizado||{})};
    const addressAliases:Record<string,string>={dom_particular_cp:'dom_particular_codigo_postal',dom_particular_ciudad:'dom_particular_localidad',dom_fiscal_cp:'dom_fiscal_codigo_postal',dom_fiscal_ciudad:'dom_fiscal_localidad'};
    for(const [source,target] of Object.entries(addressAliases)){if(values[source]&&!values[target])values[target]=values[source]}
    const mappedSources={...proposal};
    for(const [source,target] of Object.entries(addressAliases)){if(proposal[source]&&!mappedSources[target])mappedSources[target]=proposal[source]}
    for(const address of response.domicilios_detectados||[]){
      const prefix=address.tipo_sugerido==='FISCAL'?'dom_fiscal':address.tipo_sugerido==='COMPROBADO'?'dom_particular':'';
      if(!prefix)continue;
      const fields:Record<string,string>={calle:'calle',numero_exterior:'exterior',numero_interior:'interior',colonia:'colonia',codigo_postal:'codigo_postal',municipio:'municipio',ciudad:'localidad',localidad:'localidad',estado:'estado',pais:'pais'};
      for(const [source,target] of Object.entries(fields)){if(address[source]&&!values[`${prefix}_${target}`])values[`${prefix}_${target}`]=address[source];if(address[source]&&!mappedSources[`${prefix}_${target}`])mappedSources[`${prefix}_${target}`]={fuente:address.fuente,estado:'PENDIENTE_CONFIRMACION'}}
    }
    const safeValues=Object.fromEntries(Object.entries(values).filter(([key,value])=>key!=='tipo_persona'&&typeof value==='string'&&!proposal[key]?.estado?.includes('CONFLICTO')));
    setDraft(current=>({...current,...safeValues,tipo_persona:current.tipo_persona}));setSources(mappedSources);setDirty(true);
  };
  const extract=async()=>{setBusy(true);setError('');setExtractionState('Preparando documentos');try{await new Promise(resolve=>window.setTimeout(resolve,120));setExtractionState('Analizando');const response=createMode?await comparecientesService.extractAssisted(sessionId,documents.map(document=>document.id)):await comparecientesService.extractExisting(id);setExtractionState('Completando información');applyExtraction(response);setExtractionState('Listo · revisa los datos propuestos');}catch(err){setExtractionState('');setError(err instanceof Error?err.message:'La extracción no pudo completarse. Tus datos permanecen sin cambios.');}finally{setBusy(false)}};
  const save=async(event:React.FormEvent)=>{event.preventDefault();setError('');setMessage('');setBusy(true);try{if(createMode){const name=draft.tipo_persona==='FISICA'?draft.nombre:draft.razon_social;if(!name?.trim())throw new Error(draft.tipo_persona==='FISICA'?'Escribe el nombre del compareciente.':'Escribe la razón social.');const duplicates=await comparecientesService.duplicates(draft);if(duplicates.some(candidate=>candidate.bloqueo_alta))throw new Error('Ya existe un compareciente con el mismo RFC o CURP. Abre el registro existente.');const session=await ensureSession();const response=await comparecientesService.confirmAssisted(session,draft,documents.map(document=>document.id));navigate(`/comparecientes/${response.compareciente.id}`,{replace:true});return;}await comparecientesService.update(id,updatePayload(draft));setMessage('Cambios guardados correctamente.');await load();}catch(err){setError(err instanceof Error?err.message:'No pudimos guardar los cambios. Tus datos permanecen en pantalla.');}finally{setBusy(false)}};
  const cancel=async()=>{if(createMode&&sessionId){try{await comparecientesService.cancelAssisted(sessionId)}catch{ /* TTL y compensación garantizan limpieza diferida */ }}navigate('/comparecientes')};
  if(status==='loading')return <PageContainer title="Compareciente"><div className={styles.workspaceLoading}><LoaderCircle className={styles.spin}/>Cargando ficha…</div></PageContainer>;
  if(status==='error')return <PageContainer title="Compareciente"><section className={styles.pageState} role="alert"><span><AlertTriangle/></span><h2>No pudimos cargar este compareciente.</h2><p>Revisa tus permisos o intenta nuevamente.</p><button type="button" className={styles.secondaryButton} onClick={()=>navigate('/comparecientes')}>Volver al listado</button></section></PageContainer>;
  const title=createMode?'Nuevo compareciente':item?.nombre||'Compareciente';
  return <PageContainer title="">
    <form className={styles.unifiedWorkspace} onSubmit={save}>
      <header className={styles.unifiedHeader}>
        <div>
          <Link to="/comparecientes" onClick={(event)=>{ if(createMode&&sessionId){ event.preventDefault(); void cancel(); } }}><ArrowLeft/>Comparecientes</Link>
          <span>{createMode?'Nuevo registro':'Ficha maestra'}</span>
          <h1>{title}</h1>
          {!createMode&&item&&<p>Actualizado {new Intl.DateTimeFormat('es-MX',{dateStyle:'medium'}).format(new Date(item.updated_at_material))} · {item.expedientes.length} expediente{item.expedientes.length===1?'':'s'} vinculado{item.expedientes.length===1?'':'s'}</p>}
        </div>
        <div>
          {!canWrite&&<span className={styles.readOnlyBadge}><ShieldCheck/>Solo lectura</span>}
          <button type="button" className={styles.secondaryButton} onClick={()=>void cancel()}>Cancelar</button>
          {canWrite&&<button type="submit" className={styles.primaryButton} disabled={busy||(!createMode&&!dirty)}>{busy?<LoaderCircle className={styles.spin}/>:createMode?<Check/>:<Save/>}{createMode?'Registrar compareciente':'Guardar cambios'}</button>}
        </div>
      </header>
      {error&&<div className={styles.workspaceError} role="alert"><AlertTriangle/>{error}</div>}
      {message&&<div className={styles.workspaceSuccess} role="status"><Check/>{message}</div>}
      <div className={styles.unifiedColumns}>
        <main className={styles.unifiedInformation}><header><span>Información del compareciente</span><h2>Datos notariales</h2><p>{canWrite?'Edita directamente y guarda cuando hayas terminado.':'Consulta la información disponible dentro de tus permisos.'}</p></header><ComparecienteForm draft={draft} readOnly={!canWrite} lockType={!createMode} sources={sources} onChange={change}/></main>
        <aside><ComparecienteDocuments comparecienteId={createMode?undefined:id} sessionId={sessionId} documents={documents} canUpload={canUpload} canDelete={canDelete} canExtract={canExtract} busy={busy} extractionState={extractionState} onUpload={upload} onDelete={remove} onExtract={extract}/></aside>
      </div>
      {!createMode&&item&&item.complianceSnapshots.length>0&&<section className={styles.complianceBridge} aria-label="Evaluaciones Riesgos / UIF"><header><div><span>Riesgos / UIF</span><h2>Evaluaciones relacionadas</h2><p>Snapshots históricos vinculados mediante los expedientes de este compareciente.</p></div></header><div>{item.complianceSnapshots.map((review:any)=><Link key={review.id} to={`/riesgos/revisiones/${review.id}`}><ShieldCheck/><span><strong>{review.expediente?.numero_pravia||'Expediente relacionado'}</strong><small>{String(review.estatus||'SIN_EVALUAR').replaceAll('_',' ').toLocaleLowerCase('es-MX')} · solo lectura desde esta ficha</small></span><ChevronRight/></Link>)}</div></section>}
    </form>
  </PageContainer>;
}
