import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, Pencil, X } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../../services/api/client';
import { prospectsService } from '../prospects.service';
import type { Prospect, ProspectCatalogs, ProspectWorkflow } from '../prospects.types';
import { displayProspectName, uppercaseProspectNameInput } from '../prospects.types';
import styles from '../ProspectsPage.module.css';

type Block = 'summary' | 'contact';
const formatDate = (value: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value));

export function ProspectInlineEditor({ block, prospect, workflow, catalogs, canWrite, canAssign, onBusyChange, onChanged, notify }: {
  block: Block;
  prospect: Prospect;
  workflow: ProspectWorkflow;
  catalogs: ProspectCatalogs;
  canWrite: boolean;
  canAssign: boolean;
  onBusyChange: (busy: boolean) => void;
  onChanged: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const processedReturnedAct = useRef('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    nombre: displayProspectName(prospect.nombre), telefono: prospect.telefono ?? '', email: prospect.email ?? '',
    actIds: prospect.actos?.map((item) => item.tipo_acto_id) ?? [], responsable: prospect.user_id ?? '',
  });
  useEffect(() => {
    if (editing) return;
    setForm({
      nombre: displayProspectName(prospect.nombre), telefono: prospect.telefono ?? '', email: prospect.email ?? '',
      actIds: prospect.actos?.map((item) => item.tipo_acto_id) ?? [], responsable: prospect.user_id ?? '',
    });
  }, [editing, prospect]);
  useEffect(() => {
    if (block !== 'summary') return;
    const returned = location.state as { cfg001CreatedActId?: string; cfg001CreatedActName?: string } | null;
    const actId = returned?.cfg001CreatedActId;
    if (!actId || processedReturnedAct.current === actId || busy) return;
    processedReturnedAct.current = actId;
    const actIds = Array.from(new Set([...(prospect.actos?.map((item) => item.tipo_acto_id) ?? []), actId]));
    setBusy(true); onBusyChange(true); setError('');
    void prospectsService.update(prospect.id, { expectedVersion: workflow.version, tipo_acto_ids: actIds })
      .then(async () => { await onChanged(); notify((returned?.cfg001CreatedActName || 'Acto') + ' quedó seleccionado en el prospecto.'); })
      .catch(() => notify('El acto se creó, pero no pudo vincularse al prospecto.'))
      .finally(() => { setBusy(false); onBusyChange(false); navigate('/prospectos/' + prospect.id, { replace: true, state: null }); });
  }, [block, busy, location.state, navigate, notify, onBusyChange, onChanged, prospect.actos, prospect.id, workflow.version]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const payload: Record<string, unknown> = { expectedVersion: workflow.version };
    if (block === 'summary') {
      if (!form.nombre.trim()) return setError('El nombre o razón social es obligatorio.');
      Object.assign(payload, {
        nombre: displayProspectName(form.nombre), tipo_acto_ids: form.actIds,
        ...(canAssign && form.responsable && form.responsable !== prospect.user_id ? { responsable_id: form.responsable } : {}),
      });
    } else {
      if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) return setError('Escribe un correo válido.');
      Object.assign(payload, { telefono: form.telefono, email: form.email });
    }
    setBusy(true); onBusyChange(true); setError('');
    try {
      await prospectsService.update(prospect.id, payload);
      setEditing(false);
      await onChanged();
      notify('Ficha actualizada.');
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409 ? 'La ficha cambió en otra sesión. Actualiza y revisa antes de guardar.' : 'No pudimos guardar este bloque. Revisa los datos.');
    } finally { setBusy(false); onBusyChange(false); }
  };
  const footer = <div className={styles.inlineFormActions}><button type="button" onClick={() => { setEditing(false); setError(''); }} disabled={busy}><X size={16} />Cancelar</button><button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={16} /> : <Check size={16} />}Guardar</button></div>;
  if (block === 'contact') return <section className={styles.detailSection}><header><div><h2>Datos de contacto</h2><p>Medios para dar seguimiento a esta oportunidad.</p></div>{canWrite && !editing && <button type="button" className={styles.inlineEditButton} onClick={() => setEditing(true)}><Pencil size={15} />Editar contacto</button>}</header>
    {editing ? <form className={styles.inlineForm} onSubmit={save}><label><span>Teléfono</span><input type="tel" value={form.telefono} onChange={(event) => setForm((current) => ({ ...current, telefono: event.target.value }))} /></label><label><span>Correo</span><input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>{error && <p className={styles.formError} role="alert">{error}</p>}{footer}</form>
      : <dl><div><dt>Teléfono</dt><dd>{prospect.telefono || 'No registrado'}</dd></div><div><dt>Correo</dt><dd>{prospect.email || 'No registrado'}</dd></div></dl>}
  </section>;
  return <section className={styles.detailSection}><header><div><h2>Resumen</h2><p>Datos esenciales del prospecto.</p></div>{canWrite && !editing && <button type="button" className={styles.inlineEditButton} onClick={() => setEditing(true)}><Pencil size={15} />Editar datos</button>}</header>
    {editing ? <form className={styles.inlineForm} onSubmit={save}>
      <label><span>Nombre o razón social</span><input value={form.nombre} onChange={(event) => setForm((current) => ({ ...current, nombre: uppercaseProspectNameInput(event.target.value) }))} /></label>
      <fieldset className={styles.actSelector}><legend>Acto(s)</legend>{catalogs.actTypes.length ? catalogs.actTypes.map((act) => <label key={act.id}><input type="checkbox" checked={form.actIds.includes(act.id)} onChange={(event) => setForm((current) => ({ ...current, actIds: event.target.checked ? [...current.actIds, act.id] : current.actIds.filter((id) => id !== act.id) }))} /><span>{act.nombre}</span></label>) : <p>No hay actos configurados para esta Notaría.</p>}<Link to={'/configuracion/actos-tiempos?returnTo=' + encodeURIComponent('/prospectos/' + prospect.id)}>+ Crear nuevo acto en Actos y tiempos</Link></fieldset>
      {canAssign && workflow.responsibles.length > 0 && <label><span>Responsable del prospecto</span><select value={form.responsable} onChange={(event) => setForm((current) => ({ ...current, responsable: event.target.value }))}>{workflow.responsibles.map((responsible) => <option key={responsible.id} value={responsible.id}>{[responsible.nombre, responsible.apellido].filter(Boolean).join(' ')}</option>)}</select></label>}
      {error && <p className={styles.formError} role="alert">{error}</p>}{footer}
    </form> : <dl><div><dt>Folio</dt><dd>{workflow.folio || 'Histórico sin folio canónico'}</dd></div><div><dt>Nombre</dt><dd>{displayProspectName(prospect.nombre)}</dd></div><div><dt>Acto(s)</dt><dd>{prospect.actos?.map((item) => item.tipo_acto.nombre).join(', ') || prospect.servicio_catalogo?.label || prospect.tipo_acto || 'Por definir'}</dd></div><div><dt>Responsable del prospecto</dt><dd>{prospect.atendido_por?.nombre || 'Sin responsable visible'}</dd></div><div><dt>Fecha de creación</dt><dd>{formatDate(prospect.created_at)}</dd></div></dl>}
  </section>;
}
