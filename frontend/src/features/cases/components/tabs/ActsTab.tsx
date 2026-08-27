import { AlertTriangle, FileText, LoaderCircle, Pencil, Plus, ShieldAlert, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CatalogCombobox } from '../../../prospects/components/CatalogCombobox';
import { ApiError } from '../../../../services/api/client';
import { expedientesService } from '../../expedientes.service';
import type { ActTypeOption, ExpedienteAct, ExpedienteActOperation, ExpedienteActPreview, ExpedienteDetail } from '../../expedientes.types';
import styles from '../../Expedientes.module.css';

type DialogState = { operation: ExpedienteActOperation; current?: ExpedienteAct };
const originLabel: Record<ExpedienteAct['origen'], string> = { COTIZACION: 'Originado en cotización', ADICIONAL: 'Agregado al expediente', LEGACY_MIGRATION: 'Registro histórico preservado' };
const impactTitle = (source: 'CFG-001' | 'CFG-002') => source === 'CFG-001' ? 'Flujo operativo' : 'Documentos y artefactos';

export function ActsTab({ expediente, onChanged }: { expediente: ExpedienteDetail; onChanged: () => void }) {
  const [acts, setActs] = useState<ExpedienteAct[]>(expediente.actos || []);
  const [types, setTypes] = useState<ActTypeOption[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [typeId, setTypeId] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ExpedienteActPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const active = useMemo(() => acts.filter((act) => act.estatus === 'ACTIVO' && !act.removed_at), [acts]);
  const options = useMemo(() => types.map((type) => ({ code: type.id, label: type.nombre })), [types]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [actResult, catalog] = await Promise.all([expedientesService.listActs(expediente.id, signal), expedientesService.actTypes(signal)]);
      setActs(actResult.data); setTypes(catalog); setStatus('ready');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus(error instanceof ApiError && error.status === 403 ? 'denied' : 'error');
    }
  }, [expediente.id]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const open = (operation: ExpedienteActOperation, current?: ExpedienteAct) => {
    setDialog({ operation, current }); setTypeId(operation === 'CHANGE' ? current?.tipo_acto_id || '' : ''); setReason(''); setPreview(null); setConfirmed(false); setMessage(''); setIdempotencyKey(crypto.randomUUID());
  };
  const close = () => { if (!working) setDialog(null); };
  const command = dialog ? { operation: dialog.operation, expediente_acto_id: dialog.current?.id, tipo_acto_id: dialog.operation === 'REMOVE' ? undefined : typeId, reason: dialog.operation === 'ADD' ? undefined : reason } : null;
  const requestPreview = async () => {
    if (!command) return;
    setWorking(true); setMessage(''); setConfirmed(false);
    try { setPreview(await expedientesService.previewAct(expediente.id, command)); }
    catch (error) {
      setMessage(error instanceof ApiError && error.status === 403
        ? 'No tienes permiso para modificar los actos de este expediente.'
        : 'No pudimos preparar la vista previa. Actualiza el expediente e inténtalo de nuevo.');
    }
    finally { setWorking(false); }
  };
  const apply = async () => {
    if (!command || !preview) return;
    setWorking(true); setMessage('');
    try {
      await expedientesService.applyAct(expediente.id, { ...command, idempotency_key: idempotencyKey, preview_fingerprint: preview.fingerprint, confirm_protected_work: confirmed });
      await load(); onChanged(); setDialog(null);
    } catch (error) {
      setMessage(error instanceof ApiError && error.status === 403
        ? 'No tienes permiso para confirmar este cambio.'
        : error instanceof ApiError && error.status === 409
          ? 'La vista previa quedó obsoleta porque el expediente cambió. Revisa nuevamente el impacto.'
          : 'La operación ya no es válida. Revisa nuevamente el impacto.');
      setPreview(null);
    }
    finally { setWorking(false); }
  };
  const formReady = dialog?.operation === 'REMOVE' ? reason.trim().length > 0 : Boolean(typeId) && (dialog?.operation === 'ADD' || reason.trim().length > 0);
  const canApply = preview && preview.classification !== 'BLOCKED' && (preview.classification !== 'REVIEW_REQUIRED' || confirmed);

  return <section className={styles.sectionCard}>
    <header className={styles.actHeader}><div><h2>Actos del expediente</h2><p>Relaciones jurídicas canónicas. Un expediente puede contener varios actos, incluso del mismo tipo.</p></div>{expediente.capabilities.canWrite && <button type="button" className={styles.primaryButton} onClick={() => open('ADD')}><Plus size={16} />Agregar acto</button>}</header>
    {status === 'loading' && <div className={styles.inlineState}><LoaderCircle className={styles.spin} />Cargando actos…</div>}
    {status === 'denied' && <div className={styles.inlineState}><ShieldAlert />No tienes permiso para consultar los actos de este expediente.</div>}
    {status === 'error' && <div className={styles.inlineState}><AlertTriangle />No pudimos cargar los actos.<button type="button" className={styles.secondaryButton} onClick={() => void load()}>Reintentar</button></div>}
    {status === 'ready' && !active.length && <p className={styles.sectionEmpty}>Este expediente no tiene actos activos.</p>}
    {status === 'ready' && active.length > 0 && <div className={styles.actList}>{active.map((act, index) => <article key={act.id}>
      <span><FileText size={19} /></span><div><strong>{act.tipo_acto.nombre}</strong><small>{originLabel[act.origen]} · Instancia {index + 1}</small>{act.tipo_acto.descripcion && <p>{act.tipo_acto.descripcion}</p>}</div>
      {expediente.capabilities.canWrite && <div className={styles.actActions}><button type="button" aria-label={`Cambiar ${act.tipo_acto.nombre}`} onClick={() => open('CHANGE', act)}><Pencil size={16} /></button><button type="button" aria-label={`Desvincular ${act.tipo_acto.nombre}`} onClick={() => open('REMOVE', act)}><Trash2 size={16} /></button></div>}
    </article>)}</div>}

    {dialog && <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className={`${styles.dialog} ${styles.actDialog}`} role="dialog" aria-modal="true" aria-labelledby="act-dialog-title">
      <header><div><h2 id="act-dialog-title">{dialog.operation === 'ADD' ? 'Agregar acto' : dialog.operation === 'CHANGE' ? 'Cambiar acto' : 'Desvincular acto'}</h2><p>La operación se aplicará sólo después de revisar su impacto configurado.</p></div><button type="button" className={styles.iconButton} aria-label="Cerrar" onClick={close}><X size={18} /></button></header>
      <div className={styles.dialogBody}>
        {dialog.operation !== 'REMOVE' && <CatalogCombobox label="Tipo de acto" required value={typeId} options={options} placeholder="Buscar en el catálogo de actos" onChange={(value) => { setTypeId(value); setPreview(null); }} />}
        {dialog.operation !== 'ADD' && <label>Motivo<textarea rows={3} value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); }} placeholder="Explica por qué se realiza este cambio" /></label>}
        {message && <p className={styles.formError} role="alert">{message}</p>}
        {preview && <div className={styles.impactPreview} data-classification={preview.classification}>
          <div className={styles.impactStatus}><ShieldAlert size={19} /><div><strong>{preview.classification === 'SAFE' ? 'Cambio seguro' : preview.classification === 'REVIEW_REQUIRED' ? 'Revisión humana requerida' : 'Cambio bloqueado'}</strong><small>{preview.classification === 'BLOCKED' ? 'Existe trabajo jurídico protegido que impide esta operación.' : `Trabajo protegido detectado: ${preview.impact.protected_work.count}`}</small></div></div>
          {(['CFG-001', 'CFG-002'] as const).map((source) => { const added = preview.impact.added.filter((item) => item.source === source); const removed = preview.impact.removed_or_no_longer_applicable.filter((item) => item.source === source); const retained = preview.impact.retained.filter((item) => item.source === source); return <section key={source}><h3>{impactTitle(source)} <span>{source}</span></h3><dl><div><dt>Se agrega</dt><dd>{added.length ? added.map((item) => item.name).join(', ') : 'Sin cambios'}</dd></div><div><dt>Deja de aplicar</dt><dd>{removed.length ? removed.map((item) => item.name).join(', ') : 'Sin cambios'}</dd></div><div><dt>Se conserva</dt><dd>{retained.length ? `${retained.length} elementos` : 'Ninguno'}</dd></div></dl></section>; })}
          {preview.classification === 'REVIEW_REQUIRED' && <label className={styles.confirmImpact}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Confirmo que revisé el impacto sobre el trabajo existente.</label>}
        </div>}
      </div>
      <footer><button type="button" className={styles.secondaryButton} onClick={close} disabled={working}>Cancelar</button>{!preview ? <button type="button" className={styles.primaryButton} disabled={!formReady || working} onClick={() => void requestPreview()}>{working && <LoaderCircle className={styles.spin} size={16} />}Revisar impacto</button> : <button type="button" className={styles.primaryButton} disabled={!canApply || working} onClick={() => void apply()}>{working && <LoaderCircle className={styles.spin} size={16} />}Confirmar cambio</button>}</footer>
    </section></div>}
  </section>;
}
