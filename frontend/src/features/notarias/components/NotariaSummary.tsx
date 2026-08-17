import { AtSign, Building2, Check, Clock3, LoaderCircle, Mail, MapPin, Phone, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { NotariaDetail, NotariaUpdateInput, NotariaWeekDay, NotariaWeeklySchedule } from '../notarias.types';
import { notariasService } from '../notarias.service';
import { humanizeRole } from '../../../lib/formatters';
import styles from '../Notarias.module.css';

const weekdays: Array<[NotariaWeekDay, string]> = [['lunes', 'Lunes'], ['martes', 'Martes'], ['miercoles', 'Miércoles'], ['jueves', 'Jueves'], ['viernes', 'Viernes'], ['sabado', 'Sábado'], ['domingo', 'Domingo']];
const date = (value: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const emptyForm = (item: NotariaDetail) => ({
  notario_titular: item.titular || '', entidad_federativa: item.entidad_federativa || '', municipio: item.municipio || '', ciudad: item.ciudad || '',
  direccion: item.direccion || '', codigo_postal: item.codigo_postal || '', telefono: item.telefono || '', correo_general: item.correo_general || '',
  contacto_principal_id: item.contacto_principal_id || '',
});
const scheduleLines = (item: NotariaDetail) => {
  if (item.horario_semanal && Object.keys(item.horario_semanal).length) return weekdays.map(([key, label]) => {
    const entry = item.horario_semanal?.[key];
    if (!entry) return null;
    return `${label}: ${entry.cerrado ? 'Cerrado' : `${entry.apertura}–${entry.cierre}`}`;
  }).filter((value): value is string => Boolean(value));
  const legacy = [item.dias_atencion, item.horario].filter(Boolean).join(' · ');
  return legacy ? [`Horario histórico: ${legacy}`] : [];
};

export function NotariaSummary({ item, editing, canWrite, onEdit, onCancel, onSaved, onContacts }: { item: NotariaDetail; editing: boolean; canWrite: boolean; onEdit(): void; onCancel(): void; onSaved(): void; onContacts(): void }) {
  const [form, setForm] = useState(() => emptyForm(item));
  const [schedule, setSchedule] = useState<NotariaWeeklySchedule | null>(item.horario_semanal || null);
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setForm(emptyForm(item)); setSchedule(item.horario_semanal || null); setScheduleTouched(false); setError(''); }, [item, editing]);
  const set = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const updateDay = (day: NotariaWeekDay, field: 'activo' | 'apertura' | 'cierre', value: boolean | string) => {
    setScheduleTouched(true);
    setSchedule((current) => {
      const next = { ...(current || {}) };
      const existing = next[day];
      if (field === 'activo') next[day] = value ? { cerrado: false, apertura: '09:00', cierre: '17:00' } : { cerrado: true };
      else next[day] = { cerrado: false, apertura: field === 'apertura' ? String(value) : existing && !existing.cerrado ? existing.apertura : '09:00', cierre: field === 'cierre' ? String(value) : existing && !existing.cerrado ? existing.cierre : '17:00' };
      return next;
    });
  };
  const save = async () => {
    if (!form.entidad_federativa.trim() || !form.municipio.trim()) { setError('Estado y municipio son obligatorios.'); return; }
    setBusy(true); setError('');
    const input: NotariaUpdateInput = {
      notario_titular: form.notario_titular.trim() || null,
      entidad_federativa: form.entidad_federativa.trim(), municipio: form.municipio.trim(), ciudad: form.ciudad.trim() || null,
      direccion: form.direccion.trim() || null, codigo_postal: form.codigo_postal.trim() || null, telefono: form.telefono.trim() || null,
      correo_general: form.correo_general.trim() || null, contacto_principal_id: form.contacto_principal_id || null,
      ...(scheduleTouched || item.horario_semanal ? { horario_semanal: schedule } : {}),
    };
    try { await notariasService.update(item.id, input); onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No pudimos guardar los cambios.'); setBusy(false); }
  };

  const facts = [
    { icon: Building2, label: 'Número oficial', value: item.numero_notaria ? `Notaría ${item.numero_notaria}` : 'Sin número registrado' },
    { icon: UserRound, label: 'Titular', value: item.titular || 'Sin titular registrado' },
    { icon: MapPin, label: 'Ubicación', value: [item.ciudad || item.municipio, item.entidad_federativa].filter(Boolean).join(', ') },
    { icon: Phone, label: 'Teléfono principal', value: item.telefono || 'Sin teléfono registrado' },
    { icon: AtSign, label: 'Correo principal', value: item.correo_general || item.correo_proyectos || 'Sin correo registrado' },
  ];
  const mainContact = item.contacto;

  if (editing) return <form className={styles.inlineEdit} onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <header><div><h2>Editar ficha</h2><p>Los cambios se guardan en esta misma pantalla.</p></div><div><button type="button" className={styles.secondaryButton} disabled={busy} onClick={onCancel}><X size={16} />Cancelar</button><button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={16} /> : <Check size={16} />}Guardar cambios</button></div></header>
    {error && <p className={styles.formError} role="alert">{error}</p>}
    <section className={styles.inlineSection}><h3>Información principal</h3><div className={styles.formGrid}>
      <label className={styles.formField}><span>Número oficial</span><input value={item.numero_notaria || ''} readOnly aria-readonly="true" /></label>
      <label className={styles.formField}><span>Titular</span><input value={form.notario_titular} onChange={(event) => set('notario_titular', event.target.value)} /></label>
      <label className={styles.formField}><span>Estado *</span><select value={form.entidad_federativa} onChange={(event) => set('entidad_federativa', event.target.value)}>{!['Nayarit', 'Jalisco'].includes(form.entidad_federativa) && form.entidad_federativa && <option value={form.entidad_federativa}>{form.entidad_federativa} (registro histórico)</option>}<option value="Nayarit">Nayarit</option><option value="Jalisco">Jalisco</option></select></label>
      <label className={styles.formField}><span>Municipio *</span><input value={form.municipio} onChange={(event) => set('municipio', event.target.value)} /></label>
      <label className={styles.formField}><span>Ciudad</span><input value={form.ciudad} onChange={(event) => set('ciudad', event.target.value)} /></label>
      <label className={`${styles.formField} ${styles.fieldWide}`}><span>Domicilio</span><input value={form.direccion} onChange={(event) => set('direccion', event.target.value)} /></label>
      <label className={styles.formField}><span>Código postal</span><input value={form.codigo_postal} inputMode="numeric" onChange={(event) => set('codigo_postal', event.target.value)} /></label>
      <label className={styles.formField}><span>Teléfono principal</span><input value={form.telefono} inputMode="tel" onChange={(event) => set('telefono', event.target.value)} /></label>
      <label className={styles.formField}><span>Correo principal</span><input value={form.correo_general} type="email" onChange={(event) => set('correo_general', event.target.value)} /></label>
      <label className={styles.formField}><span>Contacto principal</span><select value={form.contacto_principal_id} onChange={(event) => set('contacto_principal_id', event.target.value)}><option value="">Sin contacto principal</option>{item.contactos.filter((contact) => contact.activo).map((contact) => <option key={contact.id} value={contact.id}>{contact.nombre}{contact.cargo ? ` · ${contact.cargo}` : ''}</option>)}</select></label>
    </div></section>
    <section className={styles.inlineSection}><h3>Horario semanal</h3>{!schedule ? <div className={styles.legacySchedule}><p>{scheduleLines(item)[0] || 'No existe un horario estructurado.'}</p><button type="button" className={styles.secondaryButton} onClick={() => { setSchedule({}); setScheduleTouched(true); }}>Configurar horario semanal</button></div> : <div className={styles.scheduleEditor}>{weekdays.map(([day, label]) => { const entry = schedule[day]; const active = Boolean(entry && !entry.cerrado); return <div key={day}><label><input type="checkbox" checked={active} onChange={(event) => updateDay(day, 'activo', event.target.checked)} /><strong>{label}</strong></label>{active && entry && !entry.cerrado ? <><input aria-label={`Apertura ${label}`} type="time" value={entry.apertura} onChange={(event) => updateDay(day, 'apertura', event.target.value)} /><span>a</span><input aria-label={`Cierre ${label}`} type="time" value={entry.cierre} onChange={(event) => updateDay(day, 'cierre', event.target.value)} /></> : <em>Cerrado</em>}</div>; })}</div>}</section>
  </form>;

  return <div className={styles.tabStack}>
    <section className={styles.summaryGrid}>{facts.map((fact) => { const Icon = fact.icon; return <article key={fact.label}><span><Icon size={18} /></span><small>{fact.label}</small><strong>{fact.value}</strong></article>; })}</section>
    <section className={styles.sectionCard}><header><div><h2>Información operativa</h2><p>Datos confirmados para trabajar con esta notaría.</p></div>{canWrite && <button type="button" className={styles.secondaryButton} onClick={onEdit}>Editar ficha</button>}</header><dl className={styles.detailList}><div><dt>Domicilio</dt><dd>{item.direccion || 'Sin domicilio registrado'}{item.codigo_postal ? ` · C.P. ${item.codigo_postal}` : ''}</dd></div><div><dt>Horario</dt><dd className={styles.scheduleRead}>{scheduleLines(item).length ? scheduleLines(item).map((line) => <span key={line}>{line}</span>) : 'Sin horario registrado'}</dd></div><div><dt>Última actividad</dt><dd><Clock3 size={14} />{date(item.metrics.lastActivity)}</dd></div></dl></section>
    <section className={styles.sectionCard}><header><div><h2>Contacto principal</h2><p>Referencia rápida para la atención de asuntos.</p></div><button type="button" className={styles.linkButton} onClick={onContacts}>Ver todos los contactos</button></header>{mainContact.es_principal && (mainContact.nombre || mainContact.telefono || mainContact.correo) ? <div className={styles.mainContact}><span><UserRound size={19} /></span><div><strong>{mainContact.nombre || 'Contacto principal'}</strong><small>{mainContact.cargo || 'Sin cargo registrado'}</small></div><ul>{mainContact.telefono && <li><Phone size={14} />{mainContact.telefono}</li>}{mainContact.correo && <li><Mail size={14} />{mainContact.correo}</li>}</ul></div> : <p className={styles.sectionEmpty}>No hay un contacto principal registrado.</p>}</section>
    {item.responsables.length > 0 && <section className={styles.sectionCard}><header><div><h2>Responsables vinculados</h2><p>Derivados de expedientes relacionados; no son asignaciones directas a la notaría.</p></div></header><div className={styles.peopleList}>{item.responsables.map((person) => <article key={person.id}><span>{person.nombre.charAt(0)}{person.apellido.charAt(0)}</span><div><strong>{person.nombre} {person.apellido}</strong><small>{humanizeRole(person.rol)}</small></div><b>{person.expedientes} expedientes</b></article>)}</div></section>}
  </div>;
}
