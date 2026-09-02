import { X } from 'lucide-react';
import { useState } from 'react';
import { complianceService } from '../compliance.service';
import styles from '../Compliance.module.css';

export function NewReviewDialog({ catalogs, onClose, onCreated }: { catalogs:any; onClose:()=>void; onCreated:(id:string)=>void }) {
 const [draft,setDraft]=useState({expediente_id:'',fecha_juridica_confirmada:''}),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const change=(key:string,value:string)=>setDraft(current=>({...current,[key]:value}));
 const submit=async(e:React.FormEvent)=>{e.preventDefault();setSaving(true);setError('');try{const created=await complianceService.evaluateLegalCase(draft.expediente_id,{idempotency_key:crypto.randomUUID(),...(draft.fecha_juridica_confirmada?{fecha_juridica_confirmada:draft.fecha_juridica_confirmada}:{})});onCreated(created.id);}catch(err){setError(err instanceof Error?err.message:'No fue posible crear la evaluación.');}finally{setSaving(false);}};
 return <div className={styles.backdrop} onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="new-review-title"><header><div><small>Nueva evaluación</small><h2 id="new-review-title">Iniciar revisión de cumplimiento</h2></div><button aria-label="Cerrar" onClick={onClose}><X/></button></header><form onSubmit={submit}>
  <label><span>Expediente dentro de tu alcance</span><select required value={draft.expediente_id} onChange={e=>change('expediente_id',e.target.value)}><option value="">Selecciona un expediente</option>{catalogs.expedientes.map((x:any)=><option key={x.id} value={x.id}>{x.numero_pravia} · {x.tipo_acto?.nombre || x.cliente_alias}</option>)}</select></label>
  <div className={styles.formPair}><label><span>Área</span><input value="Cumplimiento legal" readOnly/></label><label><span>Fecha jurídica confirmada</span><input type="date" value={draft.fecha_juridica_confirmada} onChange={e=>change('fecha_juridica_confirmada',e.target.value)}/></label></div>
  <p className={styles.formHint}>PRAVIA evaluará todas las reglas legales verificadas y vigentes para cada acto. Si la fecha jurídica o algún dato confirmado falta, el resultado quedará pendiente y no se emitirá una conclusión legal.</p>
  {error&&<p className={styles.formError} role="alert">{error}</p>}<footer><button type="button" onClick={onClose}>Cancelar</button><button className={styles.primary} disabled={saving}>{saving?'Creando…':'Crear revisión'}</button></footer>
 </form></section></div>;
}
