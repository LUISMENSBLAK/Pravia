import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../../services/api/client';
import { archivoService, type ArchivoAppendix, type ArchivoInput, type ArchivoOverview, type ArchivoRecord } from './archive.service';
import styles from './Archive.module.css';

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const formFor = (record: ArchivoRecord | null, overview: ArchivoOverview | null): ArchivoInput => ({
  numero_escritura: record?.numero_escritura ?? overview?.next_numero_escritura ?? '',
  folio_inicio: record?.folio_inicio ?? overview?.next_folio ?? '',
  folio_fin: record?.folio_fin ?? overview?.next_folio ?? '',
  fecha_instrumento: record?.fecha_instrumento ?? today(),
  libro_tomo: record?.libro_tomo ?? overview?.libro_tomo ?? '',
  no_paso: record?.no_paso ?? false,
});

export function ArchiveInstrument({ expedienteId, onSaved }: { expedienteId: string; onSaved?: () => void }) {
  const { user } = useAuth();
  const canWrite = Boolean(user?.permissions?.includes('expedientes.write'));
  const canUpload = Boolean(user?.permissions?.includes('documentos.write'));
  const canDownload = Boolean(user?.permissions?.includes('documentos.read'));
  const [record, setRecord] = useState<ArchivoRecord | null>(null);
  const [appendix, setAppendix] = useState<ArchivoAppendix[]>([]);
  const [notes, setNotes] = useState<ArchivoAppendix[]>([]);
  const [format, setFormat] = useState<{ available: boolean; name: string | null; reason: string | null }>({ available: false, name: null, reason: null });
  const [instruction, setInstruction] = useState('');
  const [overview, setOverview] = useState<ArchivoOverview | null>(null);
  const [form, setForm] = useState<ArchivoInput>(() => formFor(null, null));
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try {
      const payload = await archivoService.expediente(expedienteId);
      setRecord(payload.record); setAppendix(payload.appendix); setNotes(payload.notes); setFormat(payload.format); setOverview(payload.overview); setForm(formFor(payload.record, payload.overview)); setState('ready');
    } catch (cause) { setState('error'); setError(cause instanceof ApiError ? cause.message : 'No pudimos cargar Archivo.'); }
  }, [expedienteId]);
  useEffect(() => { setState('loading'); setNotice(''); void load(); }, [load]);
  const count = useMemo(() => {
    if (!/^\d+$/.test(form.folio_inicio) || !/^\d+$/.test(form.folio_fin)) return null;
    const value = BigInt(form.folio_fin) - BigInt(form.folio_inicio) + BigInt(1);
    return value > 0 ? value.toString() : null;
  }, [form.folio_inicio, form.folio_fin]);
  const set = (key: keyof ArchivoInput, value: string | boolean) => { setForm((current) => ({ ...current, [key]: value })); setError(''); setNotice(''); };
  const save = async () => {
    setState('saving'); setError(''); setNotice('');
    try {
      const saved = record ? await archivoService.update(record.id, form) : await archivoService.assign(expedienteId, form);
      setRecord(saved); setForm(formFor(saved, overview)); setNotice(record ? 'Registro actualizado.' : 'Escritura y folios asignados.');
      await load(); onSaved?.();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'No pudimos guardar el instrumento.'); setState('ready'); }
  };
  const upload = async (file: File, context: 'APENDICE_ARCHIVO' | 'NOTA_ARCHIVO' = 'APENDICE_ARCHIVO') => {
    setState('saving'); setError(''); setNotice('');
    try { await archivoService.uploadAppendix(expedienteId, file, context); await load(); setNotice(context === 'NOTA_ARCHIVO' ? 'Nota revisada guardada en Archivo.' : 'Documento agregado al apéndice de Archivo.'); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'No pudimos cargar el apéndice.'); setState('ready'); }
  };
  const generate = async () => {
    setState('saving'); setError(''); setNotice('');
    try { await archivoService.generateNote(expedienteId, instruction); await load(); setNotice('Word generado. Revisa y edita antes de usarlo.'); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'No pudimos generar la nota.'); setState('ready'); }
  };
  const download = async (item: ArchivoAppendix) => {
    setError('');
    try { await archivoService.downloadAppendix(expedienteId, item); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'No pudimos descargar el documento.'); }
  };
  if (state === 'loading') return <section className={styles.card} role="status">Cargando registro de Archivo…</section>;
  if (state === 'error') return <section className={styles.card}><p className={styles.error} role="alert">{error}</p><button type="button" className={styles.secondary} onClick={() => void load()}>Reintentar</button></section>;
  return <div className={styles.page}>
    <section className={styles.card} aria-label="Datos del instrumento">
      <header><div><h2>{record ? `Escritura ${record.numero_escritura}` : 'Asignar escritura y folios'}</h2><p>Registro canónico de Archivo para este expediente. El resumen se actualiza al guardar.</p></div>{record && <Link className={styles.link} to="/archivo">Ver Archivo</Link>}</header>
      {overview?.legacy_reconciliation_required && <p className={styles.warning} role="status">Hay {overview.legacy_count} expediente(s) con datos históricos de protocolo sin conciliar. La asignación nueva queda detenida para evitar colisiones.</p>}
      {!overview?.libro_tomo_configured && <p className={styles.warning}>Libro/tomo pendiente de configuración notarial. No se calcula ni inventa automáticamente.</p>}
      <div className={styles.form}>
        <label>Número de escritura<input inputMode="numeric" value={form.numero_escritura} disabled={!canWrite || state === 'saving'} onChange={(event) => set('numero_escritura', event.target.value)} /></label>
        <label>Folio inicial<input inputMode="numeric" value={form.folio_inicio} disabled={!canWrite || state === 'saving'} onChange={(event) => set('folio_inicio', event.target.value)} /></label>
        <label>Folio final<input inputMode="numeric" value={form.folio_fin} disabled={!canWrite || state === 'saving'} onChange={(event) => set('folio_fin', event.target.value)} /></label>
        <label>Número de folios<input value={count ?? ''} readOnly aria-readonly="true" /><small>Conteo inclusivo.</small></label>
        <label>Fecha de firma / instrumento<input type="date" value={form.fecha_instrumento} disabled={!canWrite || state === 'saving'} onChange={(event) => set('fecha_instrumento', event.target.value)} /></label>
        <label>Libro / tomo<input value={form.libro_tomo} disabled={!canWrite || state === 'saving'} onChange={(event) => set('libro_tomo', event.target.value)} placeholder="Pendiente de configuración" /></label>
      </div>
      {record && <label><input type="checkbox" checked={Boolean(form.no_paso)} disabled={!canWrite || state === 'saving'} onChange={(event) => set('no_paso', event.target.checked)} /> No pasó — conserva escritura y folios consumidos</label>}
      {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.success} role="status">{notice}</p>}
      {canWrite && <div className={styles.actions}><button type="button" className={styles.button} disabled={state === 'saving' || !count || overview?.legacy_reconciliation_required} onClick={() => void save()}>{state === 'saving' ? 'Guardando…' : record ? 'Guardar cambios' : 'Asignar escritura y folios'}</button></div>}
    </section>
    {record && <div className={styles.sectionGrid}>
      <section className={styles.card} aria-label="Formatos y notas de Archivo"><h3>Formatos / notas de Archivo</h3><p>El Word usa la versión activa configurada en Plantillas y formatos → Archivo. Sólo se rellenan datos confirmados del instrumento; el resultado requiere revisión humana.</p>
        {format.available ? <p>Formato activo: <strong>{format.name}</strong></p> : <p className={styles.warning} role="status">{format.reason}</p>}
        {canUpload && format.available && <><label className={styles.uploadLabel}>Instrucción opcional para el formato<textarea value={instruction} maxLength={2000} onChange={(event) => setInstruction(event.target.value)} placeholder="Sólo se aplica si el formato contiene la variable archivo.instruccion; no modifica datos jurídicos." /></label><button type="button" className={styles.button} disabled={state === 'saving'} onClick={() => void generate()}>{state === 'saving' ? 'Generando…' : 'Generar Word para revisión'}</button></>}
        {canUpload && <label className={styles.uploadLabel}>Subir nota revisada<input type="file" accept=".docx" disabled={state === 'saving'} onChange={async (event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) await upload(file, 'NOTA_ARCHIVO'); }} /></label>}
        {notes.length ? <ul className={styles.appendixList}>{notes.map((item) => <li key={item.id}><span>{item.documento.nombre_original}<small>{Math.ceil(item.documento.size_bytes / 1024)} KB · {new Date(item.documento.fecha_carga).toLocaleString('es-MX')}</small></span>{canDownload && <button type="button" className={styles.secondary} onClick={() => void download(item)}>Descargar Word</button>}</li>)}</ul> : <p>No hay notas generadas o revisadas.</p>}
      </section>
      <section className={styles.card} aria-label="Apéndice de la escritura"><h3>Apéndice de la escritura</h3><p>Archivos privados vinculados a esta escritura. Puedes agregar uno o varios, conservando el original y su trazabilidad.</p>
        {canUpload && <label className={styles.uploadLabel}>Agregar documentos<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.doc,.docx,.xml,.zip" disabled={state === 'saving'} onChange={async (event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; for (const file of files) await upload(file); }} /></label>}
        {appendix.length ? <ul className={styles.appendixList}>{appendix.map((item) => <li key={item.id}><span>{item.documento.nombre_original}<small>{Math.ceil(item.documento.size_bytes / 1024)} KB · {new Date(item.documento.fecha_carga).toLocaleString('es-MX')}</small></span>{canDownload && <button type="button" className={styles.secondary} onClick={() => void download(item)}>Descargar</button>}</li>)}</ul> : <p>Aún no hay documentos en este apéndice.</p>}
      </section>
    </div>}
  </div>;
}
