import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Building2, LoaderCircle, Plus, Search } from 'lucide-react';
import { commercialPropertyContext, commercialPropertyService, type CommercialProperty, type CommercialPropertyKind, type CommercialPropertyState } from './commercialProperty';
import styles from './CommercialPropertyPicker.module.css';

const label=(p:CommercialProperty)=>p.apodo||p.clave_catastral||p.folio_real||p.ubicacion_texto||'Inmueble sin nombre corto';
const money = (value: string | number | null | undefined) => value == null ? 'Sin información' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value));
export function CommercialPropertyPicker({kind,id,onChange,refreshKey,navigationBlocked=false}:{kind:CommercialPropertyKind;id:string;onChange?:(state:CommercialPropertyState)=>void;refreshKey?:string;navigationBlocked?:boolean}){
  const location=useLocation(),navigate=useNavigate();
  const [state,setState]=useState<CommercialPropertyState|null>(null),[search,setSearch]=useState(''),[results,setResults]=useState<CommercialProperty[]>([]);
  const [selected,setSelected]=useState<CommercialProperty|null|undefined>(undefined),[loading,setLoading]=useState(true),[searching,setSearching]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{const controller=new AbortController();setLoading(true);commercialPropertyService.read(kind,id,controller.signal).then(data=>{setState(data);onChange?.(data);setError('');}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'No pudimos consultar el inmueble.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[kind,id,refreshKey]);
  useEffect(()=>{if(!state?.capabilities.canWrite||!state.capabilities.canOpenProperty||search.trim().length<2){setResults([]);setSearching(false);return;}
    const controller=new AbortController();setSearching(true);const timer=window.setTimeout(()=>commercialPropertyService.options(kind,id,search,controller.signal).then(setResults).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'No pudimos buscar inmuebles.');}).finally(()=>{if(!controller.signal.aborted)setSearching(false);}),250);
    return()=>{clearTimeout(timer);controller.abort();};},[kind,id,search,state?.capabilities.canWrite,state?.capabilities.canOpenProperty]);
  useEffect(()=>{const candidate=(location.state as {commercialNewPredioId?:string}|null)?.commercialNewPredioId;
    if(!candidate||!state||!state.capabilities.canWrite)return;const controller=new AbortController();
    // Returning from creation proposes a selection; it never silently saves a relation.
    import('./properties.service').then(({propertiesService})=>propertiesService.get(candidate,controller.signal)).then(property=>{
      if(!controller.signal.aborted){setSelected(property);setNotice('Inmueble creado. Revisa y confirma el vínculo; aún no se ha asignado a este registro.');navigate(location.pathname+location.search+location.hash,{replace:true,state:null});}
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'No se pudo recuperar el inmueble creado.');});return()=>controller.abort();
  },[location.key,state?.capabilities.canWrite]);
  const confirm=async()=>{if(!state||selected===undefined)return;setBusy(true);setError('');try{const saved=await commercialPropertyService.select(kind,id,state,selected);setState(saved);setSelected(undefined);setResults([]);setSearch('');setNotice('Vínculo guardado. La ficha maestra y los documentos existentes no se modificaron.');onChange?.(saved);}catch(cause){setError(cause instanceof Error?cause.message:'No pudimos guardar el vínculo.');}finally{setBusy(false);}};
  return <section id="inmueble" className={styles.picker} aria-label="Inmueble de la operación" aria-busy={loading||busy}>
    <header><Building2 size={20}/><div><h2>Inmueble de la operación</h2><p>Selecciona una ficha existente para reutilizar sus valores. No se duplican inmuebles ni documentos.</p></div></header>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {navigationBlocked&&<p role="status">Guarda o descarta los valores pendientes antes de cambiar el inmueble o abrir su ficha.</p>}
    {loading?<p role="status"><LoaderCircle size={16}/> Consultando inmueble…</p>:state&&<>
      <div className={styles.current}><strong>{state.property?label(state.property):'Sin inmueble vinculado'}</strong>
        {state.property?.archived_at&&<span role="alert">El inmueble está archivado. Revisa su ficha antes de continuar.</span>}
        {state.property&&state.capabilities.canOpenProperty&&!navigationBlocked&&<Link to={`/predios/${state.property.id}?${commercialPropertyContext(kind,id)}`}>Ver ficha maestra</Link>}
      </div>
      {state.capabilities.canWrite&&!navigationBlocked&&<>
        {state.capabilities.canOpenProperty&&<><label className={styles.search}><span><Search size={16}/>Buscar inmueble por nombre, catastro o cuenta predial</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} disabled={busy} placeholder="Escribe al menos dos caracteres"/></label>
          {searching&&<p role="status">Buscando…</p>}{!searching&&search.trim().length>=2&&!results.length&&<p>Sin coincidencias. Puedes modificar la búsqueda.</p>}
          {!!results.length&&<ul className={styles.results} aria-label="Inmuebles encontrados">{results.map(property=><li key={property.id}><button type="button" disabled={busy} onClick={()=>setSelected(property)} aria-pressed={selected?.id===property.id}><strong>{label(property)}</strong><span>{[property.clave_catastral,property.cuenta_predial,property.ubicacion_texto].filter(Boolean).join(' · ')||'Sin referencias adicionales'}</span></button></li>)}</ul>}
        </>}
        <div className={styles.actions}>{state.capabilities.canCreateProperty&&<Link to={`/predios/nuevo?${commercialPropertyContext(kind,id)}`}><Plus size={16}/>Dar de alta inmueble</Link>}
          {state.property&&<button type="button" onClick={()=>setSelected(null)} disabled={busy}>Desvincular inmueble</button>}</div>
        {selected!==undefined&&<div className={styles.confirm}><p>{selected?`Vincular: ${label(selected)}`:'Desvincular sin borrar la ficha maestra. Los valores manuales históricos se conservan.'}</p>
          {selected&&<><p>Los valores se leerán de Predios. No se modifica el presupuesto ni se registran pagos.</p><dl className={styles.values}>
            <div><dt>Operación</dt><dd>{money(selected.valor_operacion)}</dd></div><div><dt>Catastro</dt><dd>{money(selected.valor_catastral)}</dd></div><div><dt>Avalúo</dt><dd>{money(selected.valor_avaluo)}</dd></div>
          </dl></>}
          <div className={styles.actions}><button type="button" disabled={busy} onClick={()=>void confirm()}>{busy?'Guardando…':'Confirmar vínculo'}</button><button type="button" disabled={busy} onClick={()=>setSelected(undefined)}>Cancelar</button></div></div>}
      </>}
    </>}
  </section>;
}
