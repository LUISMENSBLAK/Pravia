import { AlertTriangle, Plus, RefreshCw, ShieldX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { useAuth } from '../auth/AuthProvider';
import { complianceService } from './compliance.service';
import type { ComplianceCatalogs, ComplianceList } from './compliance.types';
import { ComplianceFilters } from './components/ComplianceFilters';
import { ComplianceMetrics } from './components/ComplianceMetrics';
import { ComplianceQueue } from './components/ComplianceQueue';
import { NewReviewDialog } from './components/NewReviewDialog';
import styles from './Compliance.module.css';

const emptyList:ComplianceList={revisiones:[],meta:{page:1,pageSize:12,total:0,totalPages:1},metrics:{requieren_revision:0,pendientes:0,observaciones:0,confirmadas:0}};
const emptyCatalogs:ComplianceCatalogs={reglas:[],expedientes:[],usuarios:[],documentos:[]};

export function CompliancePage(){const {user}=useAuth();const navigate=useNavigate();const [params,setParams]=useSearchParams();const [data,setData]=useState(emptyList),[catalogs,setCatalogs]=useState(emptyCatalogs),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[open,setOpen]=useState(false);const canRead=user?.permissions?.includes('cumplimiento.read'),canWrite=user?.permissions?.includes('cumplimiento.write');
 const filters={search:params.get('search')||'',estatus:params.get('estatus')||'TODOS',tipo:params.get('tipo')||'TODOS',responsable_id:params.get('responsable_id')||'',resultado:params.get('resultado')||'TODOS',desde:params.get('desde')||'',hasta:params.get('hasta')||'',page:params.get('page')||'1'};
 const load=useCallback(async(signal?:AbortSignal)=>{if(!canRead)return;setStatus('loading');try{const [list,cats]=await Promise.all([complianceService.list({...filters,page:Number(filters.page)},signal),complianceService.catalogs(signal)]);setData(list);setCatalogs(cats);setStatus('ready');}catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))setStatus('error');}},[canRead,params.toString()]);
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
 const change=(key:string,value:string)=>{const next=new URLSearchParams(params);if(!value||value==='TODOS')next.delete(key);else next.set(key,value);if(key!=='page')next.delete('page');setParams(next,{replace:true});};
 if(!canRead)return <PageContainer title="Riesgos / UIF" subtitle="Revisión de cumplimiento, alertas y obligaciones."><section className={styles.restricted}><ShieldX/><h2>Acceso restringido</h2><p>Tu rol no incluye permiso para consultar revisiones de cumplimiento.</p></section></PageContainer>;
 return <PageContainer title="Riesgos / UIF" subtitle="Revisión de cumplimiento, alertas y obligaciones." action={canWrite?<button className={styles.headerAction} onClick={()=>setOpen(true)}><Plus/>Nueva revisión</button>:undefined}>
  <nav className={styles.subnav} aria-label="Secciones de cumplimiento"><button aria-current="page">Resumen</button><button onClick={()=>change('estatus','PENDIENTE_REVISION')}>Revisiones</button><button onClick={()=>change('tipo','UIF')}>UIF</button><button onClick={()=>change('tipo','ISR')}>ISR</button>{['DIRECCION','ADMINISTRACION'].includes(user?.role||'')&&<button>Reglas</button>}</nav>
  {status==='loading'&&<ComplianceLoading/>}{status==='error'&&<section className={styles.error} role="alert"><AlertTriangle/><h2>No pudimos cargar las revisiones.</h2><p>La información no está disponible en este momento.</p><button onClick={()=>load()}><RefreshCw/>Reintentar</button></section>}
  {status==='ready'&&<><ComplianceMetrics metrics={data.metrics}/><ComplianceFilters filters={filters} catalogs={catalogs} onChange={change} onClear={()=>setParams(new URLSearchParams(),{replace:true})}/><ComplianceQueue data={data} onPage={page=>change('page',String(page))}/></>}
  {open&&<NewReviewDialog catalogs={catalogs} onClose={()=>setOpen(false)} onCreated={id=>{setOpen(false);navigate(`/riesgos/revisiones/${id}`);}}/>}
 </PageContainer>}
export function ComplianceLoading(){return <div className={styles.loading} aria-label="Cargando revisiones"><div>{[1,2,3,4].map(x=><span key={x}/>)}</div><section><i/><i/><i/><i/></section></div>}
