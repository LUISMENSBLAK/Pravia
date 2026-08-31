import { useEffect, useState } from 'react';
import { Calculator, ExternalLink, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { isrService } from '../../../isr/isr.service';
import type { ISRListItem } from '../../../isr/isr.types';
import { fixtureDirectory } from '../../../isr/isr.fixtures';
import { expedienteReturnParams } from '../../expedienteNavigation';
import styles from '../../Expedientes.module.css';

export function ISRTab({ expedienteId, canWrite, fixture = false }: { expedienteId: string; canWrite: boolean; fixture?: boolean }) {
  const navigate = useNavigate(); const [items, setItems] = useState<ISRListItem[]>([]); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const returnQuery = expedienteReturnParams(expedienteId, 'isr');
  useEffect(()=>{if(fixture){setItems(fixtureDirectory.data.slice(0,1));return;}const controller=new AbortController();const params=new URLSearchParams({expediente_id:expedienteId,pageSize:'2'});isrService.list(params,controller.signal).then((result)=>setItems(result.data.slice(0,1))).catch((reason)=>setError(reason instanceof Error?reason.message:'No fue posible consultar el cálculo.'));return()=>controller.abort();},[expedienteId,fixture]);
  const open = async () => { if (items[0]) { navigate(`/calculo-isr/${items[0].id}?${returnQuery}${fixture?'&fixture=result&visual=1':''}`); return; } if (fixture) { navigate(`/calculo-isr/fixture?${returnQuery}&fixture=ready&visual=1`); return; } setBusy(true); setError(''); try { const result=await isrService.openForExpediente(expedienteId); navigate(`/calculo-isr/${result.data.id}?${returnQuery}`); } catch(reason){setError(reason instanceof Error?reason.message:'No fue posible abrir el cálculo ISR.');} finally{setBusy(false);} };
  return <section aria-labelledby="expediente-isr-title">
    <div className={styles.sectionHeader}><div><h2 id="expediente-isr-title">Cálculo ISR</h2><p>Un único cálculo canónico puede estar vinculado simultáneamente a este expediente.</p></div>{canWrite&&<button type="button" className={styles.primaryButton} onClick={()=>void open()} disabled={busy}>{items.length?<ExternalLink/>:<Plus/>}{busy?'Abriendo…':items.length?'Abrir cálculo ISR':'Iniciar cálculo ISR'}</button>}</div>
    {error&&<div role="alert">{error}</div>}
    {!error&&!items.length&&<div className={styles.emptyState}><Calculator/><strong>Sin cálculos ISR vinculados</strong><p>Crea uno desde aquí; se abrirá el mismo workspace fiscal del módulo.</p></div>}
    <div className={styles.isrLinkedList}>{items.map((item)=><button type="button" key={item.id} className={styles.isrLinkedRow} onClick={()=>void open()}><span><Calculator/></span><span><strong>{item.folio}</strong><small>{item.contribuyente_nombre||'Contribuyente pendiente'} · {item.estado==='CALCULADO'?'Federal calculado':item.estado.replaceAll('_',' ').toLocaleLowerCase('es-MX')}</small></span><ExternalLink/></button>)}</div>
  </section>;
}
