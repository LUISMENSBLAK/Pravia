import { AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, Check, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { agendaService } from '../agenda.service';
import type { AgendaCatalogs, AgendaDraft, AgendaEvent, AgendaEventType } from '../agenda.types';
import { dateKey, eventTime, eventTypeLabel, pad, zonedParts } from '../agenda.utils';
import styles from '../Agenda.module.css';

const emptyDraft = (date: Date, userId: string): AgendaDraft => ({
  titulo: '', tipo: 'CITA', fecha: dateKey(date), hora_inicio: '09:00', hora_fin: '10:00',
  responsable_id: userId, expediente_id: '', compareciente_id: '', descripcion: '', recordatorio: '15',
});
const fromEvent = (event: AgendaEvent, timezone: string): AgendaDraft => {
  const start = zonedParts(event.fecha_inicio, timezone);
  const end = zonedParts(event.fecha_fin || new Date(new Date(event.fecha_inicio).getTime() + 60 * 60_000), timezone);
  return {
    titulo: event.titulo, tipo: event.tipo, fecha: `${start.year}-${pad(start.month)}-${pad(start.day)}`,
    hora_inicio: `${pad(start.hour)}:${pad(start.minute)}`, hora_fin: `${pad(end.hour)}:${pad(end.minute)}`,
    responsable_id: event.user_id || '', expediente_id: event.expediente_id || '',
    compareciente_id: event.compareciente_id || '', descripcion: event.descripcion || '',
    recordatorio: String(event.recordatorios?.[0] || ''),
  };
};

export function NewEventFlow({ catalogs, date, currentUserId, initial, onClose, onSaved }: {
  catalogs: AgendaCatalogs; date: Date; currentUserId: string; initial?: AgendaEvent | null;
  onClose(): void; onSaved(event: AgendaEvent): void;
}) {
  const [draft, setDraft] = useState<AgendaDraft>(() => initial ? fromEvent(initial, catalogs.timezone) : emptyDraft(date, currentUserId));
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState<AgendaEvent[]>([]);
  const [checked, setChecked] = useState(false);
  useEffect(() => { setDraft(initial ? fromEvent(initial, catalogs.timezone) : emptyDraft(date, currentUserId)); }, [initial?.id, dateKey(date)]);
  const expediente = useMemo(() => catalogs.expedientes.find((item) => item.id === draft.expediente_id), [catalogs.expedientes, draft.expediente_id]);
  const set = (field: keyof AgendaDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const validate = (relations = true) => {
    if (draft.titulo.trim().length < 3) return 'Escribe un título de al menos 3 caracteres.';
    if (!draft.fecha || !draft.hora_inicio || !draft.hora_fin) return 'Completa la fecha y el horario.';
    if (draft.hora_fin <= draft.hora_inicio) return 'La hora final debe ser posterior al inicio.';
    if (relations && draft.tipo === 'FIRMA' && !draft.expediente_id) return 'Una firma programada requiere un expediente.';
    return '';
  };
  const persist = async () => {
    setBusy(true); setError('');
    try {
      const result = initial ? await agendaService.update(initial.id, draft, catalogs.timezone) : await agendaService.create(draft, catalogs.timezone);
      onSaved(result.evento);
    } catch (reason: any) { setError(reason?.message || 'No pudimos guardar el evento.'); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    const message = validate(); if (message) { setError(message); return; }
    setError('');
    if (!checked) {
      setBusy(true);
      try {
        const result = await agendaService.conflicts(draft, catalogs.timezone, initial?.id);
        setChecked(true); setConflicts(result.conflictos);
        if (!result.conflictos.length) await persist();
      } catch (reason: any) { setError(reason?.message || 'No pudimos revisar el horario.'); }
      finally { setBusy(false); }
      return;
    }
    await persist();
  };
  const chooseCase = (id: string) => {
    const selected = catalogs.expedientes.find((item) => item.id === id);
    setDraft((current) => ({
      ...current, expediente_id: id,
      ...(selected?.abogado_id && catalogs.permisos.gestionar_equipo ? { responsable_id: selected.abogado_id } : {}),
      ...(!current.titulo && selected?.tipo_acto?.nombre ? { titulo: `${eventTypeLabel(current.tipo)} · ${selected.tipo_acto.nombre}` } : {}),
    }));
  };
  const next = () => {
    const message = step === 0 ? validate(false) : '';
    if (message) { setError(message); return; }
    setError(''); setStep((value) => value + 1);
  };
  const steps = ['Evento', 'Relaciones', 'Revisión'];

  return <div className={styles.drawerBackdrop} role="presentation"><section className={styles.eventFormDrawer} role="dialog" aria-modal="true" aria-labelledby="event-flow-title">
    <header><div><span>{initial ? 'ACTUALIZAR AGENDA' : 'NUEVA CITA'}</span><h2 id="event-flow-title">{initial ? 'Editar evento' : 'Programar evento'}</h2><p>Las fechas corresponden a {catalogs.timezone}.</p></div><button type="button" aria-label="Cerrar" onClick={onClose}><X /></button></header>
    <div className={styles.eventFormBody}>
      <ol className={styles.flowSteps}>{steps.map((label, index) => <li key={label} data-active={step === index} data-done={step > index}><span>{step > index ? <Check size={14} /> : index + 1}</span><b>{label}</b></li>)}</ol>
      {error && <p className={styles.formError} role="alert"><AlertTriangle size={16} />{error}</p>}
      {step === 0 && <fieldset className={styles.formStep}><legend>Datos del evento</legend><p>Registra el horario programado. Esto no confirma que una firma ya ocurrió.</p><div className={styles.formGrid}>
        <label>Tipo de evento *<select value={draft.tipo} onChange={(e) => set('tipo', e.target.value as AgendaEventType)}>{catalogs.tipos.map((item) => <option key={item.tipo} value={item.tipo}>{eventTypeLabel(item.tipo)}</option>)}</select></label>
        <label className={styles.wideField}>Título *<input value={draft.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder="Ej. Firma de escritura" /></label>
        <label>Fecha *<input type="date" value={draft.fecha} onChange={(e) => set('fecha', e.target.value)} /></label>
        <label>Hora inicio *<input type="time" value={draft.hora_inicio} onChange={(e) => set('hora_inicio', e.target.value)} /></label>
        <label>Hora fin *<input type="time" value={draft.hora_fin} onChange={(e) => set('hora_fin', e.target.value)} /></label>
        <label>Responsable *<select value={draft.responsable_id} disabled={!catalogs.permisos.gestionar_equipo} onChange={(e) => set('responsable_id', e.target.value)}>{catalogs.usuarios.map((item) => <option key={item.id} value={item.id}>{item.nombre} {item.apellido}</option>)}</select></label>
      </div></fieldset>}
      {step === 1 && <fieldset className={styles.formStep}><legend>Relaciones y recordatorio</legend><p>La notaría se obtiene del expediente; no se duplica dentro del evento.</p><div className={styles.formGrid}>
        <label className={styles.wideField}>Expediente {draft.tipo === 'FIRMA' ? '*' : ''}<select value={draft.expediente_id} onChange={(e) => chooseCase(e.target.value)}><option value="">Sin expediente</option>{catalogs.expedientes.map((item) => <option key={item.id} value={item.id}>{item.numero_pravia} · {item.cliente_alias || item.tipo_acto?.nombre || 'Sin cliente'}</option>)}</select></label>
        {expediente && <div className={`${styles.linkPreview} ${styles.wideField}`}><strong>{expediente.tipo_acto?.nombre || 'Acto sin registrar'}</strong><span>{expediente.notaria?.nombre || 'Sin notaría vinculada'} · {expediente.estatus.replaceAll('_', ' ')}</span>{expediente.fecha_real_firma && <em>Firma efectiva ya registrada: {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: catalogs.timezone }).format(new Date(expediente.fecha_real_firma))}</em>}</div>}
        <label className={styles.wideField}>Compareciente<select value={draft.compareciente_id} onChange={(e) => set('compareciente_id', e.target.value)}><option value="">Sin compareciente</option>{catalogs.comparecientes.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label>
        <label>Aviso previo<select value={draft.recordatorio} onChange={(e) => set('recordatorio', e.target.value)}><option value="">Sin aviso configurado</option><option value="5">5 minutos antes</option><option value="15">15 minutos antes</option><option value="60">1 hora antes</option><option value="1440">1 día antes</option></select></label>
        <label className={styles.wideField}>Notas<textarea value={draft.descripcion} onChange={(e) => set('descripcion', e.target.value)} rows={4} placeholder="Información operativa para el equipo" /></label>
      </div></fieldset>}
      {step === 2 && <section className={styles.reviewStep}><h3>Revisa antes de guardar</h3><dl>
        <div><dt>Evento</dt><dd>{eventTypeLabel(draft.tipo)} · {draft.titulo || 'Sin título'}</dd></div><div><dt>Horario programado</dt><dd>{draft.fecha} · {draft.hora_inicio}–{draft.hora_fin}</dd></div><div><dt>Responsable</dt><dd>{catalogs.usuarios.find((item) => item.id === draft.responsable_id)?.nombre || 'Sin responsable'}</dd></div><div><dt>Expediente</dt><dd>{expediente?.numero_pravia || 'Sin expediente'}</dd></div><div><dt>Notaría</dt><dd>{expediente?.notaria?.nombre || 'Se obtiene del expediente cuando existe'}</dd></div>
      </dl>{checked && conflicts.length > 0 && <aside className={styles.conflictWarning} role="alert"><AlertTriangle /><div><strong>Este horario tiene {conflicts.length} conflicto{conflicts.length === 1 ? '' : 's'}.</strong>{conflicts.map((item) => <p key={item.id}>{item.responsable_nombre} ya tiene “{item.titulo}” · {eventTime(item, catalogs.timezone)}</p>)}<span>Puedes revisar el horario o guardar si el negocio permite el traslape.</span></div></aside>}</section>}
    </div>
    <footer><button type="button" className={styles.secondaryButton} onClick={step === 0 ? onClose : () => { setStep((value) => value - 1); setChecked(false); setConflicts([]); }}>{step > 0 && <ArrowLeft size={15} />}{step === 0 ? 'Cancelar' : 'Anterior'}</button><span />{step < 2 ? <button type="button" className={styles.primaryButton} onClick={next}>Siguiente<ArrowRight size={15} /></button> : <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void submit()}>{busy ? 'Guardando…' : checked && conflicts.length ? 'Guardar de todos modos' : initial ? 'Guardar cambios' : 'Guardar evento'}<CalendarClock size={16} /></button>}</footer>
  </section></div>;
}
