import { Check, LoaderCircle, Pencil, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { notariasService } from '../notarias.service';
import type { NotariaDetail } from '../notarias.types';
import styles from '../Notarias.module.css';

const list = (value: string[] | null) => value?.length ? value.join(', ') : 'Sin información registrada';
const duration = (days: number | null, legacy: string | null) => days ? `${days} ${days === 1 ? 'día' : 'días'}` : legacy || 'Sin tiempo registrado';

export function NotariaConfiguration({ item, canWrite, onSaved }: { item: NotariaDetail; canWrite: boolean; onSaved(): void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState({ response: String(item.dias_respuesta_estimados || ''), budget: item.dias_presupuesto_estimados ? String(item.dias_presupuesto_estimados) : '', signature: item.dias_firma_estimados ? String(item.dias_firma_estimados) : '' });
  useEffect(() => { setValues({ response: String(item.dias_respuesta_estimados || ''), budget: item.dias_presupuesto_estimados ? String(item.dias_presupuesto_estimados) : '', signature: item.dias_firma_estimados ? String(item.dias_firma_estimados) : '' }); setError(''); }, [item, editing]);
  const save = async () => {
    const response = Number(values.response);
    if (!Number.isInteger(response) || response < 1 || response > 365) { setError('El tiempo de respuesta debe indicar entre 1 y 365 días.'); return; }
    const optional = (value: string) => value ? Number(value) : null;
    if ([values.budget, values.signature].filter(Boolean).some((value) => !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 365)) { setError('Los tiempos deben indicar entre 1 y 365 días.'); return; }
    setBusy(true); setError('');
    try { await notariasService.update(item.id, { dias_respuesta_estimados: response, dias_presupuesto_estimados: optional(values.budget), dias_firma_estimados: optional(values.signature) }); setEditing(false); onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No pudimos guardar la configuración.'); setBusy(false); }
  };
  return <div className={styles.tabStack}><section className={styles.sectionCard}><header><div><h2>Configuración operativa</h2><p>Duraciones estimadas expresadas en días.</p></div>{canWrite && !editing && <button type="button" className={styles.secondaryButton} onClick={() => setEditing(true)}><Pencil size={15} />Editar configuración</button>}{editing && <div className={styles.inlineActions}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setEditing(false)}><X size={15} />Cancelar</button><button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void save()}>{busy ? <LoaderCircle className={styles.spin} size={15} /> : <Check size={15} />}Guardar</button></div>}</header>
    {error && <p className={styles.formError} role="alert">{error}</p>}
    {editing ? <div className={styles.configurationForm}><div className={styles.formGrid}>
      <label className={styles.formField}><span>Tiempo de respuesta (días) *</span><input type="number" min="1" max="365" value={values.response} onChange={(event) => setValues((current) => ({ ...current, response: event.target.value }))} /></label>
      <label className={styles.formField}><span>Tiempo de presupuesto (días)</span><input type="number" min="1" max="365" value={values.budget} placeholder={item.tiempo_presupuesto || 'Opcional'} onChange={(event) => setValues((current) => ({ ...current, budget: event.target.value }))} /></label>
      <label className={styles.formField}><span>Tiempo de firma (días)</span><input type="number" min="1" max="365" value={values.signature} placeholder={item.tiempo_firma || 'Opcional'} onChange={(event) => setValues((current) => ({ ...current, signature: event.target.value }))} /></label>
    </div>
      {(item.tiempo_respuesta || item.tiempo_presupuesto || item.tiempo_firma) && <p className={styles.legacyNote}>Los textos históricos permanecen conservados y solo se sustituyen visualmente cuando registras una duración explícita.</p>}
    </div> : <dl className={styles.detailList}><div><dt>Tiempo de respuesta</dt><dd>{duration(item.dias_respuesta_estimados, item.tiempo_respuesta)}</dd></div><div><dt>Tiempo de presupuesto</dt><dd>{duration(item.dias_presupuesto_estimados, item.tiempo_presupuesto)}</dd></div><div><dt>Tiempo de firma</dt><dd>{duration(item.dias_firma_estimados, item.tiempo_firma)}</dd></div><div><dt>Municipios atendidos</dt><dd>{list(item.municipios_atendidos_json)}</dd></div><div><dt>Tipos de acto</dt><dd>{list(item.tipos_acto_json)}</dd></div><div><dt>Instituciones</dt><dd>{list(item.instituciones_json)}</dd></div></dl>}
  </section>{(item.observaciones_generales || item.instrucciones_especiales || item.requisitos_frecuentes) && <section className={styles.sectionCard}><header><div><h2>Notas operativas</h2><p>Indicaciones existentes en la ficha.</p></div></header><dl className={styles.notesList}><div><dt>Observaciones</dt><dd>{item.observaciones_generales || 'Sin observaciones'}</dd></div><div><dt>Instrucciones especiales</dt><dd>{item.instrucciones_especiales || 'Sin instrucciones'}</dd></div><div><dt>Requisitos frecuentes</dt><dd>{item.requisitos_frecuentes || 'Sin requisitos'}</dd></div></dl></section>}</div>;
}
