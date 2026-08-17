import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { complianceService } from '../compliance.service';
import styles from '../Compliance.module.css';

export function NewReviewDialog({ catalogs, onClose, onCreated }: { catalogs:any; onClose:()=>void; onCreated:(id:string)=>void }) {
 const [draft,setDraft]=useState({expediente_id:'',tipo:'UIF',rule_set_id:'',fecha_operacion:new Date().toISOString().slice(0,10)}),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const rules=useMemo(()=>catalogs.reglas.filter((rule:any)=>rule.tipo==='UIF'),[catalogs.reglas]);
 const change=(key:string,value:string)=>setDraft(current=>({...current,[key]:value}));
 const submit=async(e:React.FormEvent)=>{e.preventDefault();setSaving(true);setError('');try{const created=await complianceService.create(draft);onCreated(created.id);}catch(err){setError(err instanceof Error?err.message:'No fue posible crear la revisión.');}finally{setSaving(false);}};
 return <div className={styles.backdrop} onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="new-review-title"><header><div><small>Nueva evaluación</small><h2 id="new-review-title">Iniciar revisión de cumplimiento</h2></div><button aria-label="Cerrar" onClick={onClose}><X/></button></header><form onSubmit={submit}>
  <label><span>Expediente dentro de tu alcance</span><select required value={draft.expediente_id} onChange={e=>change('expediente_id',e.target.value)}><option value="">Selecciona un expediente</option>{catalogs.expedientes.map((x:any)=><option key={x.id} value={x.id}>{x.numero_pravia} · {x.tipo_acto?.nombre || x.cliente_alias}</option>)}</select></label>
  <div className={styles.formPair}><label><span>Área</span><input value="Riesgos / UIF" readOnly/></label><label><span>Fecha de operación</span><input required type="date" value={draft.fecha_operacion} onChange={e=>change('fecha_operacion',e.target.value)}/></label></div>
  <label><span>RuleSet / versión aplicable</span><select required value={draft.rule_set_id} onChange={e=>change('rule_set_id',e.target.value)}><option value="">Selecciona una versión</option>{rules.map((x:any)=><option key={x.id} value={x.id}>{x.nombre} · {x.version}</option>)}</select></label>
  <p className={styles.formHint}>PRAVIA capturará una copia inmutable de la regla y de los datos actuales. Los campos conocidos se prellenan con procedencia; la confirmación sigue siendo humana.</p>
  {error&&<p className={styles.formError} role="alert">{error}</p>}<footer><button type="button" onClick={onClose}>Cancelar</button><button className={styles.primary} disabled={saving}>{saving?'Creando…':'Crear revisión'}</button></footer>
 </form></section></div>;
}
