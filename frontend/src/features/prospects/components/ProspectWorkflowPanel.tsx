import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../../services/api/client';
import { prospectsService } from '../prospects.service';
import type { PreparedProspectRequest, Prospect, ProspectDocument, ProspectWorkflow, ProspectWorkflowAction } from '../prospects.types';
import { ProspectDocumentPicker } from './ProspectDocumentPicker';
import styles from '../ProspectWorkflow.module.css';

const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Fecha de etapa no acreditada';
const humanError = (error: unknown) => error instanceof ApiError && error.status < 500 ? error.message : 'No pudimos confirmar la operación. Puedes reintentar el mismo envío; no se duplicará.';
const localDateTime = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };

export function ProspectWorkflowPanel({ prospect, workflow: w, documents, canWrite, canUpload, onChanged, openDocument }: {
  prospect: Prospect; workflow: ProspectWorkflow; documents: ProspectDocument[]; canWrite: boolean; canUpload: boolean;
  onChanged: () => Promise<void>; openDocument: (document: ProspectDocument) => void;
}) {
  const [action, setAction] = useState<ProspectWorkflowAction | ''>('');
  const [prepared, setPrepared] = useState<PreparedProspectRequest | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [effectiveAt, setEffectiveAt] = useState('');
  const [channel, setChannel] = useState('Correo electrónico');
  const [recipient, setRecipient] = useState('');
  const [evidence, setEvidence] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [notary, setNotary] = useState(w.notaria?.id ?? '');
  const [responsible, setResponsible] = useState(prospect.user_id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const actionFocus = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { if (action) actionFocus.current?.focus(); }, [action]);
  useEffect(() => {
    setNotary(w.notaria?.id ?? '');
    setResponsible(prospect.user_id ?? '');
  }, [w.version, w.notaria?.id, prospect.user_id]);
  const sourceIds = new Set(w.sourceHistory.map((source) => source.documento.id));
  const candidates = documents.filter((doc) => !sourceIds.has(doc.id));
  const notaryFrozen = ['EN_ESPERA_COTIZACION', 'COTIZACION_RECIBIDA', 'CONVERTIDO_COTIZACION'].includes(w.stage ?? '');

  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (caught) { setError(humanError(caught)); }
    finally { lock.current = false; setBusy(false); }
  };
  const start = (code: ProspectWorkflowAction) => {
    setAction(code); setConfirmed(false); setError(''); setReason(''); setDocumentId(''); setEvidence('');
    setEffectiveAt(localDateTime()); attempt.current = null;
  };
  const prepare = () => run(async () => {
    const draft = await prospectsService.prepare(prospect.id, w.version, attachments);
    setPrepared(draft); setRecipient(draft.recipient);
    setNotice('Contenido preparado. No se ha registrado ningún envío.');
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!action || !confirmed) { setError('Revisa los datos y confirma la acción.'); return; }
    void run(async () => {
      const payload: Record<string, unknown> = { action, expectedVersion: w.version, confirm: true };
      if (action === 'REGISTRAR_ENVIO') {
        if (!prepared) { setError('Prepara y revisa el contenido antes de registrar el envío.'); return; }
        Object.assign(payload, { effectiveAt: new Date(effectiveAt).toISOString(), channel, recipient, evidence,
          content: prepared.content, attachmentIds: prepared.attachmentIds });
      }
      if (action === 'REGISTRAR_RECEPCION') Object.assign(payload, { effectiveAt: new Date(effectiveAt).toISOString(), documentId });
      if (action === 'SUSTITUIR_FUENTE') Object.assign(payload, { documentId, reason });
      const fingerprint = JSON.stringify(payload);
      if (attempt.current && attempt.current.fingerprint !== fingerprint) {
        setError('Los datos cambiaron después del intento. Actualiza la ficha para comprobar el resultado antes de confirmar otra operación.'); return;
      }
      attempt.current ??= { fingerprint, key: crypto.randomUUID() };
      await prospectsService.act(prospect.id, { ...payload, idempotencyKey: attempt.current.key });
      setAction(''); setPrepared(null); attempt.current = null;
      await onChanged(); setNotice('Operación confirmada y registrada.');
    });
  };
  const saveAssignment = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await prospectsService.update(prospect.id, { expectedVersion: w.version,
        ...(notary && notary !== w.notaria?.id ? { notaria_id: notary } : {}),
        ...(responsible && responsible !== prospect.user_id ? { responsable_id: responsible } : {}) });
      setPrepared(null); await onChanged(); setNotice('Asignación guardada. La fecha de etapa no cambia.');
    });
  };
  const upload = () => run(async () => {
    // File upload only; the user must separately confirm effective receipt.
    for (const file of files) {
      await prospectsService.uploadDocument(prospect.id, file, 'COTIZACION_NOTARIA');
      setFiles((current) => current.filter((candidate) => candidate !== file));
    }
    await onChanged(); setNotice('Archivo cargado. La recepción notarial todavía requiere confirmación.');
  });

  return <section className={styles.panel} aria-label="Operación contractual del prospecto" aria-busy={busy}>
    <header><div><p className={styles.eyebrow}>Etapa contractual{w.folio ? ` · ${w.folio}` : ''}</p><h2>{w.stageLabel}</h2><p>{dateTime(w.stageEnteredAt)}</p></div>
      <button type="button" disabled={busy} onClick={() => void run(async () => { await onChanged(); setAction(''); setPrepared(null); attempt.current = null; })}>Actualizar ficha</button></header>
    {w.knowledge === 'UNKNOWN_LEGACY' && <p className={styles.info}>Este registro no tiene una transición contractual acreditada. Sus datos e historial anteriores se conservan; no se ha supuesto ninguna fecha.</p>}
    <p><strong>Espera:</strong> {w.wait.label}</p>
    <details><summary>Ver las siete etapas</summary><ol className={styles.stages}>{w.stages.map((stage) => <li key={stage.code} aria-current={stage.code === w.stage ? 'step' : undefined}>{stage.label}</li>)}</ol><p>El envío confirmado inicia la espera de cotización en el mismo momento.</p></details>
    <section aria-label="Notaría y responsable"><h3>Notaría y responsable</h3>
      <p>Notaría: {w.notaria?.nombre ?? 'Sin notaría asignada'}</p>
      {canWrite && <form onSubmit={saveAssignment} className={styles.form}>
        <label>Notaría<select value={notary} disabled={busy || notaryFrozen || !w.notaries.length} onChange={(e) => setNotary(e.target.value)}><option value="">Selecciona una notaría</option>{w.notaries.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}</select></label>
        {w.responsibles.length > 0 && <label>Responsable<select value={responsible} disabled={busy} onChange={(e) => setResponsible(e.target.value)}>{w.responsibles.map((u) => <option key={u.id} value={u.id}>{[u.nombre, u.apellido].filter(Boolean).join(' ')}</option>)}</select></label>}
        <button type="submit" disabled={busy || ((!notary || notary === w.notaria?.id) && responsible === prospect.user_id)}>Guardar asignación</button>
      </form>}
    </section>
    {w.stage === 'LISTO_PARA_SOLICITAR' && canWrite && <section aria-label="Solicitud a Notaría"><h3>Solicitud a Notaría</h3>
      <p>Selecciona los adjuntos y prepara el texto. Copiarlo o abrir tu correo no registra un envío.</p>
      <fieldset disabled={busy}><legend>Adjuntos seleccionados</legend>{candidates.length ? candidates.map((doc) => <label className={styles.check} key={doc.id}><input type="checkbox" checked={attachments.includes(doc.id)} onChange={(e) => { setAttachments((current) => e.target.checked ? [...current, doc.id] : current.filter((id) => id !== doc.id)); setPrepared(null); }} /><span>{doc.nombre_original}</span></label>) : <p>Sin documentos disponibles para seleccionar.</p>}</fieldset>
      <button type="button" disabled={busy || !w.notaria} onClick={prepare}>Preparar solicitud</button>
      {prepared && <div className={styles.form}><label>Contenido para revisión<textarea rows={10} value={prepared.content} disabled={busy} onChange={(e) => setPrepared({ ...prepared, content: e.target.value })} /></label>
        <button type="button" disabled={busy} onClick={() => void run(async () => { await navigator.clipboard.writeText(prepared.content); setNotice('Contenido copiado. No se ha registrado ningún envío.'); })}>Copiar contenido</button>
        <p>No hay envío automático desde PRAVIA. Realiza el envío por tu canal y después confírmalo aquí.</p>
      </div>}
    </section>}
    <section aria-label="Cotización de Notaría"><h3>Cotización de Notaría · Fuente específica</h3>
      {!w.canReadSource ? <p>Tu perfil no permite consultar los documentos de la fuente.</p> : w.source ? <>
        <p><strong>Primera recepción:</strong> {dateTime(w.source.received_at)}</p>
        <p><strong>Versión vigente:</strong> {w.source.version} · {w.source.notaria.nombre}</p>
        <button type="button" onClick={() => openDocument(w.source!.documento)}>Abrir {w.source.documento.nombre_original}</button>
        <details><summary>Historia de la fuente ({w.sourceHistory.length})</summary><ol>{w.sourceHistory.map((source) => <li key={source.id}><strong>Versión {source.version}</strong> · {dateTime(source.recorded_at)}<p>{source.motivo}</p><button type="button" onClick={() => openDocument(source.documento)}>Abrir {source.documento.nombre_original}</button></li>)}</ol></details>
      </> : <p>Sin cotización de Notaría recibida y confirmada.</p>}
      {canUpload && w.actions.some((a) => ['REGISTRAR_RECEPCION', 'SUSTITUIR_FUENTE'].includes(a.code)) && <div>
        <ProspectDocumentPicker id="notarial-candidate" label="Adjuntar respuesta de Notaría" files={files} disabled={busy} onChange={setFiles} />
        <button type="button" disabled={busy || !files.length} onClick={upload}>Cargar archivo sin confirmar recepción</button>
      </div>}
    </section>
    {w.quote && <p className={styles.info}>Este prospecto tiene una cotización vinculada. <Link to={`/cotizaciones/${encodeURIComponent(w.quote.id)}`}>Abrir {w.quote.numero_cotizacion || 'cotización'}</Link></p>}
    <div className={styles.actions}>{w.actions.map((a) => <button type="button" key={a.code} disabled={busy || (a.code === 'REGISTRAR_ENVIO' && !prepared)} onClick={() => start(a.code)}>{a.label}</button>)}</div>
    {action && <form onSubmit={submit} className={styles.confirmation} aria-label="Confirmar acción">
      <h3 ref={actionFocus} tabIndex={-1}>{w.actions.find((a) => a.code === action)?.label}</h3>
      {(action === 'REGISTRAR_ENVIO' || action === 'REGISTRAR_RECEPCION') && <label>Fecha y hora efectiva<input type="datetime-local" step="1" value={effectiveAt} disabled={busy} required onChange={(e) => setEffectiveAt(e.target.value)} /></label>}
      {action === 'REGISTRAR_ENVIO' && <>
        <label>Canal utilizado<input value={channel} required disabled={busy} onChange={(e) => setChannel(e.target.value)} /></label>
        <label>Destinatario<input value={recipient} required disabled={busy} onChange={(e) => setRecipient(e.target.value)} /></label>
        <label>Evidencia o referencia del envío<textarea rows={3} value={evidence} required disabled={busy} onChange={(e) => setEvidence(e.target.value)} /></label>
      </>}
      {(action === 'REGISTRAR_RECEPCION' || action === 'SUSTITUIR_FUENTE') && <label>Archivo recibido<select value={documentId} required disabled={busy} onChange={(e) => setDocumentId(e.target.value)}><option value="">Selecciona el documento canónico</option>{candidates.map((doc) => <option value={doc.id} key={doc.id}>{doc.nombre_original}</option>)}</select></label>}
      {action === 'SUSTITUIR_FUENTE' && <label>Motivo de sustitución<textarea rows={3} value={reason} required disabled={busy} onChange={(e) => setReason(e.target.value)} /></label>}
      {action === 'CONVERTIR' && <p>Se creará una sola cotización vinculada con la fuente notarial vigente. No se enviará otra solicitud a Notaría.</p>}
      {action === 'MARCAR_LISTO' && <p>Confirma que la información disponible es suficiente para solicitar cotización. El sistema no lo deduce por cantidad de archivos.</p>}
      <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} /><span>{action === 'REGISTRAR_ENVIO' ? 'Confirmo que el envío ya se realizó fuera de PRAVIA.' : 'He revisado los datos y confirmo esta acción.'}</span></label>
      <div className={styles.actions}><button type="submit" disabled={busy || !confirmed}>{busy ? 'Confirmando…' : 'Confirmar acción'}</button><button type="button" disabled={busy} onClick={() => { setAction(''); setError(''); }}>Cancelar</button></div>
    </form>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <details><summary>Historial de etapas ({w.events.length})</summary>{w.events.length ? <ol className={styles.history}>{w.events.map((event) => <li key={event.id}><strong>{event.previousLabel} → {event.nextLabel}</strong>{event.viaLabel && <p>Hito simultáneo: {event.viaLabel}</p>}<p>{dateTime(event.effectiveAt)} · {event.actor}</p><small>{event.actionLabel} · {event.provenanceLabel}</small></li>)}</ol> : <p>No hay transiciones contractuales acreditadas.</p>}</details>
  </section>;
}
