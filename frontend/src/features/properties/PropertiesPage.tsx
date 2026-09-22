import { AlertTriangle, Building2, ChevronRight, LoaderCircle, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { useAuth } from '../auth/AuthProvider';
import { propertiesService } from './properties.service';
import type { PropertyListItem } from './properties.types';
import styles from './PropertiesPage.module.css';

const title=(item:PropertyListItem)=>item.apodo||item.ubicacion_texto||[item.calle,item.numero_exterior].filter(Boolean).join(' ')||item.clave_catastral||item.folio_real||'Inmueble sin apodo';
const identifiers=(item:PropertyListItem)=>[item.clave_catastral&&`Clave ${item.clave_catastral}`,item.cuenta_predial&&`Cuenta ${item.cuenta_predial}`,item.folio_real&&`Folio ${item.folio_real}`].filter(Boolean).join(' · ')||'Sin identificadores registrales capturados';
const address=(item:PropertyListItem)=>[item.ubicacion_texto,[item.calle,item.numero_exterior].filter(Boolean).join(' '),item.colonia,item.municipio,item.estado].filter(Boolean).join(' · ')||'Ubicación pendiente';

export function PropertiesPage(){
  const {user}=useAuth();const navigate=useNavigate();const [params,setParams]=useSearchParams();const [items,setItems]=useState<PropertyListItem[]>([]);const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');const search=params.get('search')||'';
  useEffect(()=>{const controller=new AbortController();setStatus('loading');const timer=window.setTimeout(()=>{propertiesService.list(search,controller.signal).then(result=>{setItems(result.data);setStatus('ready')}).catch(error=>{if(!(error instanceof DOMException&&error.name==='AbortError'))setStatus('error')})},180);return()=>{controller.abort();window.clearTimeout(timer)}},[search]);
  const canWrite=Boolean(user?.permissions?.includes('expedientes.write'));
  return <PageContainer title="Predios / Inmuebles" subtitle="Maestro reutilizable de inmuebles de la organización." action={canWrite&&<button type="button" className={styles.primary} onClick={()=>navigate('/predios/nuevo')}><Plus/>Nuevo predio</button>}>
    <label className={styles.search}><span className={styles.srOnly}>Buscar predios</span><Search/><input value={search} onChange={event=>{const next=new URLSearchParams(params);event.target.value?next.set('search',event.target.value):next.delete('search');setParams(next,{replace:true})}} placeholder="Buscar por apodo, clave catastral, cuenta, folio o domicilio"/></label>
    {status==='loading'&&<div className={styles.state}><LoaderCircle className={styles.spin}/>Cargando maestro inmobiliario…</div>}
    {status==='error'&&<div className={styles.state} role="alert"><AlertTriangle/>No pudimos cargar los inmuebles.</div>}
    {status==='ready'&&<section className={styles.catalog} aria-label="Catálogo de predios"><header><span><strong>{items.length}</strong> inmueble{items.length===1?'':'s'} dentro de tu alcance</span></header><div>{items.map(item=><Link key={item.id} to={`/predios/${item.id}`}><span className={styles.icon}><Building2/></span><span className={styles.body}><strong>{title(item)}</strong><small>{identifiers(item)}</small><small>{address(item)}</small></span><span className={styles.updated}>Actualizado {new Intl.DateTimeFormat('es-MX',{dateStyle:'medium'}).format(new Date(item.updated_at))}</span><ChevronRight/></Link>)}{!items.length&&<div className={styles.empty}><Building2/><strong>{search?'No encontramos inmuebles con esa búsqueda.':'Aún no hay inmuebles registrados.'}</strong>{canWrite&&!search&&<button type="button" className={styles.primary} onClick={()=>navigate('/predios/nuevo')}>Crear primer predio</button>}</div>}</div></section>}
  </PageContainer>;
}
