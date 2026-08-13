import { Check, Circle, LoaderCircle, Play } from 'lucide-react';
import { useState } from 'react';
import { expedientesService } from '../../expedientes.service';
import type { ExpedienteDetail, ExpedienteTransition } from '../../expedientes.types';
import { dateTime, macroLabels } from '../../expedienteFormatters';
import styles from '../../Expedientes.module.css';

export function WorkflowTab({ expediente, onChanged }: { expediente: ExpedienteDetail; onChanged(): void }) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [dialog, setDialog] = useState<'scheduled' | 'effective' | null>(null);
  const completed = new Map((expediente.etapas || []).map((item: any) => [item.clave_snapshot, item]));
  const stages = expediente.workflow.stages || []; const transition = expediente.workflow.transitions[0];
  const advance = async (target: ExpedienteTransition, data?: { date: string; place?: string }) => {
    setSaving(true); setError('');
    try {
      await expedientesService.transition(expediente.id, { expected_version: expediente.version, nuevo_estatus: target.status, ...(target.stage?.clave ? { nueva_etapa_clave: target.stage.clave } : {}), ...(target.requires_signature_data && data ? { datos_firma: { fecha_firma: data.date, lugar: data.place || '' } } : {}), ...(target.requires_effective_date && data ? { fecha_efectiva: data.date } : {}) });
      setDialog(null); onChanged();
    } catch { setError('No fue posible avanzar. Revisa los requisitos pendientes.'); }
    finally { setSaving(false); }
  };
  const startTransition = () => { if (!transition) return; if (transition.requires_signature_data) setDialog('scheduled'); else if (transition.requires_effective_date) setDialog('effective'); else void advance(transition); };
  const actionable = expediente.capabilities.canWrite && transition && !transition.requires_notes && transition.status !== 'ENTREGADO';
  return <section className={styles.sectionCard}><header><div><h2>Workflow de la operación</h2><p>Versión {expediente.flujoVersion?.version || 'no registrada'} congelada al abrir el expediente.</p></div>{actionable && <button type="button" className={styles.primaryButton} disabled={saving} onClick={startTransition}>{saving ? <LoaderCircle className={styles.spin} size={16} /> : <Play size={16} />}{transition.label}</button>}</header>{error && <div className={styles.inlineError} role="alert">{error}</div>}<div className={styles.workflowSummary}><span>{macroLabels[expediente.macrofase]}</span><strong>{expediente.etapaActual?.nombre_snapshot || expediente.etapa_actual_nombre || 'Sin etapa'}</strong><small>{expediente.workflow.current_status_label}</small></div>{stages.length ? <ol className={styles.timeline}>{stages.map((stage: any) => { const instance: any = completed.get(stage.clave); const current = stage.clave === expediente.etapaActual?.clave_snapshot; const done = Boolean(instance?.completada); return <li key={stage.clave} className={current ? styles.timelineCurrent : done ? styles.timelineDone : ''}><span>{done ? <Check size={14} /> : <Circle size={12} />}</span><div><strong>{stage.nombre}</strong><small>{stage.estado_general_relacionado?.replaceAll('_', ' ').toLocaleLowerCase('es-MX')}{stage.obligatoria ? ' · Obligatoria' : ' · Opcional'}</small></div><time>{instance?.fecha_fin ? dateTime(instance.fecha_fin) : current ? 'En curso' : 'Próxima'}</time></li>; })}</ol> : <p className={styles.sectionEmpty}>Este expediente no tiene etapas configuradas.</p>}{dialog && transition && <TransitionDateDialog mode={dialog} onClose={() => setDialog(null)} onSave={(data) => void advance(transition, data)} saving={saving} />}</section>;
}

function TransitionDateDialog({ mode, onClose, onSave, saving }: { mode: 'scheduled' | 'effective'; onClose(): void; onSave(data: { date: string; place?: string }): void; saving: boolean }) {
  const [date, setDate] = useState(''); const [place, setPlace] = useState(''); const scheduled = mode === 'scheduled';
  return <div className={styles.dialogBackdrop}><section className={styles.dialog} role="dialog" aria-modal="true" aria-label={scheduled ? 'Programar firma' : 'Registrar firma efectiva'}><header><div><h2>{scheduled ? 'Programar firma' : 'Registrar firma efectiva'}</h2><p>{scheduled ? 'Registra la fecha prevista y el lugar.' : 'La fecha efectiva es obligatoria y no se sustituye por la hora actual.'}</p></div></header><div className={styles.dialogBody}><label>{scheduled ? 'Fecha y hora programada' : 'Fecha y hora efectiva'}<input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} /></label>{scheduled && <label>Lugar<input value={place} onChange={(event) => setPlace(event.target.value)} placeholder="Notaría o ubicación" /></label>}</div><footer><button type="button" className={styles.secondaryButton} onClick={onClose}>Cancelar</button><button type="button" className={styles.primaryButton} disabled={!date || (scheduled && !place) || saving} onClick={() => onSave({ date, place })}>{saving && <LoaderCircle className={styles.spin} size={15} />}{scheduled ? 'Guardar programación' : 'Registrar firma'}</button></footer></section></div>;
}
