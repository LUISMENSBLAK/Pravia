import { useEffect, useState } from 'react';
import { Calculator, ExternalLink, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { isrService } from '../../../isr/isr.service';
import type { ISRListItem } from '../../../isr/isr.types';
import { fixtureDirectory } from '../../../isr/isr.fixtures';
import styles from '../../Expedientes.module.css';

export function ISRTab({ expedienteId, canWrite, fixture = false }: { expedienteId: string; canWrite: boolean; fixture?: boolean }) {
  const navigate = useNavigate(); const [items, setItems] = useState<ISRListItem[]>([]); const [error,setError]=useState('');
  useEffect(()=>{if(fixture){setItems(fixtureDirectory.data.slice(0,2));return;}const controller=new AbortController();const params=new URLSearchParams({expediente_id:expedienteId,pageSize:'20'});isrService.list(params,controller.signal).then((result)=>setItems(result.data)).catch((reason)=>setError(reason instanceof Error?reason.message:'No fue posible consultar los cálculos.'));return()=>controller.abort();},[expedienteId,fixture]);
  return <section aria-labelledby="expediente-isr-title">
    <div className={styles.sectionHeader}><div><h2 id="expediente-isr-title">Cálculo ISR</h2><p>Registros fiscales canónicos vinculados a este expediente.</p></div>{canWrite&&<button type="button" className={styles.primaryButton} onClick={()=>navigate(`/calculo-isr/nuevo?expediente=${encodeURIComponent(expedienteId)}${fixture?'&fixture=new&visual=1':''}`)}><Plus/>Nuevo cálculo ISR</button>}</div>
    {error&&<div role="alert">{error}</div>}
    {!error&&!items.length&&<div className={styles.emptyState}><Calculator/><strong>Sin cálculos ISR vinculados</strong><p>Crea uno desde aquí; se abrirá el mismo workspace fiscal del módulo.</p></div>}
    <div className={styles.isrLinkedList}>{items.map((item)=><button type="button" key={item.id} className={styles.isrLinkedRow} onClick={()=>navigate(`/calculo-isr/${item.id}${fixture?'?fixture=result&visual=1':''}`)}><span><Calculator/></span><span><strong>{item.folio}</strong><small>{item.contribuyente_nombre||'Contribuyente pendiente'} · {item.estado==='CALCULADO'?'Federal calculado':item.estado.replaceAll('_',' ').toLocaleLowerCase('es-MX')}</small></span><ExternalLink/></button>)}</div>
  </section>;
}
