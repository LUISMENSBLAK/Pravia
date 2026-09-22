import { Bot, LoaderCircle, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../../services/api/client';
import { expedientesService } from '../expedientes.service';
import { fullName } from '../expedienteFormatters';
import type { ActTypeOption, ExpedienteDetail } from '../expedientes.types';
import styles from '../Expedientes.module.css';

const day = (value?: string | null) => value ? value.slice(0, 10) : '';
const money = (value: unknown) => value === null || value === undefined ? '' : String(value);
const snapshot = (expediente: ExpedienteDetail) => ({
  cliente_alias: expediente.cliente_alias || '',
  abogado_id: expediente.abogado?.id || '',
  tipo_acto_id: expediente.actos?.find((item) => item.estatus === 'ACTIVO' && !item.removed_at)?.tipo_acto_id || '',
  fecha_firma: day(expediente.fecha_real_firma),
  fecha_estimada_firma: day(expediente.fecha_estimada_firma),
  fecha_estimada_entrega: day(expediente.fecha_estimada_entrega),
  numero_escritura: expediente.numero_escritura || '',
  folio_desde: expediente.folio_desde || '',
  folio_hasta: expediente.folio_hasta || '',
  valor_operacion: money((expediente as any).valor_operacion),
});

export function ExpedienteInformationHeader({ expediente, onChanged, onAssistant, onSeguimiento }: {
  expediente: ExpedienteDetail;
  onChanged(): Promise<void> | void;
  onAssistant(): void;
  onSeguimiento(): void;
}) {
  const initial = useMemo(() => snapshot(expediente), [expediente]);
  const [form, setForm] = useState(initial);
  const [types, setTypes] = useState<ActTypeOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => setForm(initial), [initial]);
  useEffect(() => { const controller = new AbortController(); void expedientesService.actTypes(controller.signal).then(setTypes).catch(() => setTypes([])); return () => controller.abort(); }, []);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (key: keyof typeof form, value: string) => { setForm((current) => ({ ...current, [key]: value })); setMessage(''); setError(''); };
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true); setMessage(''); setError('');
    try {
      const actChanged = form.tipo_acto_id !== initial.tipo_acto_id;
      const currentAct = expediente.actos?.find((item) => item.estatus === 'ACTIVO' && !item.removed_at);
      let act_change: Record<string, unknown> | undefined;
      if (actChanged) {
        const command = currentAct
          ? { operation: 'CHANGE' as const, expediente_acto_id: currentAct.id, tipo_acto_id: form.tipo_acto_id, reason: 'Actualización directa desde Información del expediente.' }
          : { operation: 'ADD' as const, tipo_acto_id: form.tipo_acto_id };
        const preview = await expedientesService.previewAct(expediente.id, command);
        if (preview.classification !== 'SAFE') throw new Error('El acto tiene impacto jurídico protegido. Revísalo desde la pestaña Actos antes de cambiarlo.');
        act_change = { ...command, idempotency_key: crypto.randomUUID(), preview_fingerprint: preview.fingerprint, confirm_protected_work: false };
      }
      const { tipo_acto_id: _act, ...fields } = form;
      const updated = await expedientesService.updateHeader(expediente.id, {
        ...fields,
        valor_operacion: fields.valor_operacion === '' ? null : fields.valor_operacion,
        version: expediente.version,
        act_change,
      });
      setMessage('Cambios guardados.');
      await onChanged();
      if (!actChanged) setForm(snapshot(updated));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : 'No fue posible guardar los cambios.');
    } finally { setSaving(false); }
  };

  return <section className={styles.expedienteInformation} aria-labelledby="expediente-information-title">
    <header className={styles.informationTitle}>
      <div><h1 id="expediente-information-title">Información del expediente</h1></div>
      <div className={styles.informationActions}>
        <button type="button" className={styles.secondaryButton} onClick={onAssistant}><Bot size={17} />¿Qué falta?</button>
        <button type="button" className={styles.secondaryButton} onClick={onSeguimiento}>Acciones</button>
        {expediente.capabilities.canWrite && <button type="button" className={styles.primaryButton} disabled={!dirty || saving} onClick={() => void save()}>{saving ? <LoaderCircle className={styles.spin} size={17} /> : <Save size={17} />}Guardar cambios</button>}
      </div>
    </header>
    <div className={styles.informationGrid}>
      <label><span>Responsable de creación</span><input value={fullName(expediente.creador)} readOnly aria-readonly="true" /></label>
      <label><span>Número de expediente</span><input value={expediente.numero_pravia} readOnly aria-readonly="true" /></label>
      <label><span>Abogado responsable</span><select value={form.abogado_id} disabled={!expediente.capabilities.canWrite} onChange={(event) => set('abogado_id', event.target.value)}>{expediente.header_options?.responsibles.map((item) => <option key={item.id} value={item.id}>{fullName(item)}</option>)}</select></label>
      <label><span>Cliente</span><input value={form.cliente_alias} disabled={!expediente.capabilities.canWrite} onChange={(event) => set('cliente_alias', event.target.value)} /></label>
      <label className={styles.informationWide}><span>Acto</span><select value={form.tipo_acto_id} disabled={!expediente.capabilities.canWrite} onChange={(event) => set('tipo_acto_id', event.target.value)}><option value="">Selecciona un acto</option>{types.map((item) => <option key={item.id} value={item.id}>{item.configuracionesOperativas?.[0]?.nombre_personalizado || item.nombre}</option>)}</select><small>Los actos adicionales se conservan y se administran en la pestaña Actos.</small></label>
      <label><span>Fecha de firma</span><input type="date" value={form.fecha_firma} disabled={!expediente.capabilities.canWrite} onChange={(event) => set('fecha_firma', event.target.value)} /></label>
      <label><span>Fecha estimada de firma</span><input type="date" value={form.fecha_estimada_firma} disabled={!expediente.capabilities.canWrite} onChange={(event) => set('fecha_estimada_firma', event.target.value)} /></label>
      <label><span>Fecha estimada de entrega</span><input type="date" value={form.fecha_estimada_entrega} disabled={!expediente.capabilities.canWrite} onChange={(event) => set('fecha_estimada_entrega', event.target.value)} /></label>
      <label><span>Número de escritura</span><input value={form.numero_escritura} disabled={!expediente.capabilities.canWrite} onChange={(event) => set('numero_escritura', event.target.value)} /></label>
      <fieldset className={styles.folioFields}><legend>Folios</legend><label><span>De</span><input value={form.folio_desde} disabled={!expediente.capabilities.canWrite} onChange={(event) => set('folio_desde', event.target.value)} /></label><label><span>A</span><input value={form.folio_hasta} disabled={!expediente.capabilities.canWrite} onChange={(event) => set('folio_hasta', event.target.value)} /></label></fieldset>
      <label><span>Valor de la operación</span><input type="number" min="0" step="0.01" value={form.valor_operacion} disabled={!expediente.capabilities.canWrite} onChange={(event) => set('valor_operacion', event.target.value)} /></label>
    </div>
    {error && <p className={styles.informationError} role="alert">{error}</p>}
    {message && <p className={styles.informationSuccess} role="status">{message}</p>}
  </section>;
}
