import { useEffect, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, Pencil, X } from 'lucide-react';
import { ApiError } from '../../../services/api/client';
import { prospectsService } from '../prospects.service';
import type { Prospect, ProspectCatalogs, ProspectWorkflow } from '../prospects.types';
import { displayProspectName, uppercaseProspectNameInput } from '../prospects.types';
import { CatalogCombobox } from './CatalogCombobox';
import styles from '../ProspectsPage.module.css';

type Block = 'matter' | 'client' | 'economic';
const amount = (value: number | string | null | undefined) => value == null ? '' : String(value);

export function ProspectInlineEditor({ prospect, workflow, catalogs, canWrite, onChanged, notify }: {
  prospect: Prospect;
  workflow: ProspectWorkflow;
  catalogs: ProspectCatalogs;
  canWrite: boolean;
  onChanged: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [editing, setEditing] = useState<Block | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    nombre: displayProspectName(prospect.nombre), telefono: prospect.telefono ?? '', email: prospect.email ?? '',
    servicio: prospect.servicio_catalogo_codigo ?? '', descripcion: prospect.necesidad ?? '', responsable: prospect.user_id ?? '',
    honorarios: amount(prospect.honorarios_estimados), impuestos: amount(prospect.impuestos_derechos_estimados), total: amount(prospect.total_estimado),
  });
  useEffect(() => {
    if (editing) return;
    setForm({
      nombre: displayProspectName(prospect.nombre), telefono: prospect.telefono ?? '', email: prospect.email ?? '',
      servicio: prospect.servicio_catalogo_codigo ?? '', descripcion: prospect.necesidad ?? '', responsable: prospect.user_id ?? '',
      honorarios: amount(prospect.honorarios_estimados), impuestos: amount(prospect.impuestos_derechos_estimados), total: amount(prospect.total_estimado),
    });
  }, [editing, prospect]);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const open = (block: Block) => { setEditing(block); setError(''); };
  const cancel = () => { setEditing(null); setError(''); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || busy) return;
    const payload: Record<string, unknown> = { expectedVersion: workflow.version };
    if (editing === 'client') {
      if (!form.nombre.trim()) return setError('El nombre o razón social es obligatorio.');
      if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) return setError('Escribe un correo válido.');
      Object.assign(payload, { nombre: displayProspectName(form.nombre), telefono: form.telefono, email: form.email });
    }
    if (editing === 'matter') Object.assign(payload, {
      necesidad: form.descripcion,
      ...(form.servicio ? { servicio_catalogo_codigo: form.servicio } : {}),
      ...(form.responsable && form.responsable !== prospect.user_id ? { responsable_id: form.responsable } : {}),
    });
    if (editing === 'economic') {
      const allBlank = !form.honorarios && !form.impuestos && !form.total;
      if (!allBlank) {
        const fees = Number(form.honorarios), taxes = Number(form.impuestos), total = Number(form.total);
        if (![fees, taxes, total].every((value) => Number.isFinite(value) && value >= 0)) return setError('Completa los tres importes con valores válidos.');
        if (Math.round((fees + taxes) * 100) !== Math.round(total * 100)) return setError('El total debe coincidir con honorarios más impuestos y derechos.');
      }
      Object.assign(payload, {
        honorarios_estimados: allBlank ? null : form.honorarios,
        impuestos_derechos_estimados: allBlank ? null : form.impuestos,
        total_estimado: allBlank ? null : form.total,
      });
    }
    setBusy(true);
    setError('');
    try {
      await prospectsService.update(prospect.id, payload);
      setEditing(null);
      await onChanged();
      notify('Ficha actualizada.');
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409 ? 'La ficha cambió en otra sesión. Actualiza y revisa antes de guardar.' : 'No pudimos guardar este bloque. Revisa los datos.');
    } finally { setBusy(false); }
  };
  const actions = (block: Block) => canWrite && <button type="button" className={styles.inlineEditButton} onClick={() => open(block)}><Pencil size={15} />Editar bloque</button>;
  const footer = <div className={styles.inlineFormActions}><button type="button" onClick={cancel} disabled={busy}><X size={16} />Cancelar</button><button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={16} /> : <Check size={16} />}Guardar</button></div>;

  return <div className={styles.workBlocks}>
    <section className={styles.detailSection}><header><div><h2>Datos del asunto</h2><p>Acto, descripción y responsable de la oportunidad.</p></div>{editing !== 'matter' && actions('matter')}</header>
      {editing === 'matter' ? <form className={styles.inlineForm} onSubmit={save}>
        <CatalogCombobox label="Acto" value={form.servicio} options={catalogs.services} placeholder="Selecciona un acto" legacyValue={!prospect.servicio_catalogo_codigo ? prospect.tipo_acto : null} onChange={(value) => set('servicio', value)} />
        <label><span>Descripción breve</span><textarea rows={4} value={form.descripcion} onChange={(event) => set('descripcion', event.target.value)} /></label>
        {workflow.responsibles.length > 0 && <label><span>Responsable</span><select value={form.responsable} onChange={(event) => set('responsable', event.target.value)}>{workflow.responsibles.map((responsible) => <option key={responsible.id} value={responsible.id}>{[responsible.nombre, responsible.apellido].filter(Boolean).join(' ')}</option>)}</select></label>}
        {error && <p className={styles.formError} role="alert">{error}</p>}{footer}
      </form> : <dl><div><dt>Acto</dt><dd>{prospect.servicio_catalogo?.label || prospect.tipo_acto || 'Por definir'}</dd></div><div><dt>Descripción breve</dt><dd>{prospect.necesidad || 'Sin descripción'}</dd></div><div><dt>Responsable</dt><dd>{prospect.atendido_por?.nombre || 'Sin responsable visible'}</dd></div></dl>}
    </section>

    <section className={styles.detailSection}><header><div><h2>Cliente / solicitante</h2><p>Datos de identificación y contacto.</p></div>{editing !== 'client' && actions('client')}</header>
      {editing === 'client' ? <form className={styles.inlineForm} onSubmit={save}>
        <label><span>Nombre o razón social</span><input value={form.nombre} onChange={(event) => set('nombre', uppercaseProspectNameInput(event.target.value))} /></label>
        <label><span>Teléfono</span><input type="tel" value={form.telefono} onChange={(event) => set('telefono', event.target.value)} /></label>
        <label><span>Correo</span><input type="email" value={form.email} onChange={(event) => set('email', event.target.value)} /></label>
        {error && <p className={styles.formError} role="alert">{error}</p>}{footer}
      </form> : <dl><div><dt>Nombre</dt><dd>{displayProspectName(prospect.nombre)}</dd></div><div><dt>Teléfono</dt><dd>{prospect.telefono || 'No registrado'}</dd></div><div><dt>Correo</dt><dd>{prospect.email || 'No registrado'}</dd></div></dl>}
    </section>

    <section className={styles.detailSection}><header><div><h2>Cotización / preparación económica</h2><p>Importes que pasarán a la cotización sin volver a capturarlos.</p></div>{editing !== 'economic' && actions('economic')}</header>
      {editing === 'economic' ? <form className={`${styles.inlineForm} ${styles.economicForm}`} onSubmit={save}>
        <label><span>Honorarios</span><input type="number" min="0" step=".01" value={form.honorarios} onChange={(event) => set('honorarios', event.target.value)} /></label>
        <label><span>Impuestos y derechos</span><input type="number" min="0" step=".01" value={form.impuestos} onChange={(event) => set('impuestos', event.target.value)} /></label>
        <label><span>Total</span><input type="number" min="0" step=".01" value={form.total} onChange={(event) => set('total', event.target.value)} /></label>
        {error && <p className={styles.formError} role="alert">{error}</p>}{footer}
      </form> : <dl className={styles.economicSummary}><div><dt>Honorarios</dt><dd>{form.honorarios ? `$${Number(form.honorarios).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : 'Por definir'}</dd></div><div><dt>Impuestos y derechos</dt><dd>{form.impuestos ? `$${Number(form.impuestos).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : 'Por definir'}</dd></div><div><dt>Total</dt><dd>{form.total ? `$${Number(form.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : 'Por definir'}</dd></div></dl>}
    </section>
  </div>;
}
