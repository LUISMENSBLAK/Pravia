import { ArrowLeft, ArrowRight, Check, FileCheck2, Info, Landmark, ReceiptText, ShieldCheck, UploadCloud, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { financeService } from '../finance.service';
import type { FinanceCatalogs, MovementDraft } from '../finance.types';
import { accountLabel, financeDate, money } from '../finance.utils';
import styles from '../Finance.module.css';
import { MovementDistribution, type DistributionDraft } from './MovementDistribution';

type Props = {
  catalogs: FinanceCatalogs;
  initialExpedienteId?: string;
  lockExpediente?: boolean;
  onClose(): void;
  onSaved(): void;
};

const today = () => new Date().toISOString().slice(0, 10);

export function NewMovementFlow({ catalogs, initialExpedienteId = '', lockExpediente = false, onClose, onSaved }: Props) {
  const [step, setStep] = useState(1);
  const [nature, setNature] = useState<'INGRESO' | 'EGRESO'>('INGRESO');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState(catalogs.accounts.find((item) => item.predeterminada)?.id || catalogs.accounts[0]?.id || '');
  const [caseId, setCaseId] = useState(initialExpedienteId);
  const [concept, setConcept] = useState('');
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState('TRANSFERENCIA');
  const [reference, setReference] = useState('');
  const [rows, setRows] = useState<DistributionDraft[]>([{ categoria_id: '', monto: '' }]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptUploaded, setReceiptUploaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'incomplete' | 'ready' | 'applied'>('idle');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ id: string; folio?: string; receiptFolio?: string } | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const total = Number(amount) || 0;
  const classified = rows.reduce((sum, row) => sum + (Number(row.monto) || 0), 0);
  const pendingCents = Math.round(total * 100) - Math.round(classified * 100);
  const validRows = rows.length > 0 && rows.every((row) => row.categoria_id && Number(row.monto) > 0);
  const balanced = pendingCents === 0 && total > 0 && validRows;
  const validDistribution = total > 0 && validRows && pendingCents >= 0;
  const selectedAccount = catalogs.accounts.find((item) => item.id === accountId);
  const selectedCase = catalogs.expedientes.find((item) => item.id === caseId);
  const canNext = step === 1 || (step === 2 && total > 0 && Boolean(date && accountId && concept.trim())) || (step === 3 && validDistribution) || step >= 4;
  const steps = ['Tipo', 'Datos', 'Distribución', 'Comprobante', 'Revisión'];

  const review = useMemo(() => [
    { label: 'Tipo', value: nature === 'INGRESO' ? 'Ingreso' : 'Egreso' },
    { label: 'Importe', value: money(total) },
    { label: 'Fecha efectiva', value: financeDate(`${date}T12:00:00`) },
    { label: 'Cuenta', value: accountLabel(selectedAccount) },
    { label: 'Expediente', value: selectedCase?.numero_pravia || 'Movimiento general' },
    { label: 'Concepto', value: concept },
    { label: 'Comprobante', value: receiptFile?.name || 'Sin comprobante adjunto' },
  ], [nature, total, date, selectedAccount, selectedCase, concept, receiptFile]);

  const submit = async () => {
    if (status === 'saving') return;
    setError('');
    setStatus('saving');
    try {
      let movement = created;
      if (!movement) {
        const draft: MovementDraft = {
          naturaleza: nature,
          monto: total,
          fecha_movimiento: new Date(`${date}T12:00:00`).toISOString(),
          cuenta_id: accountId,
          expediente_id: caseId || undefined,
          notaria_id: selectedCase?.notaria_id || undefined,
          responsable_id: selectedCase?.abogado_id,
          tipo_movimiento: nature === 'INGRESO' ? 'ABONO' : 'EGRESO_TERCEROS',
          concepto: concept.trim(),
          descripcion: description.trim() || undefined,
          forma_pago: method,
          referencia: reference.trim() || undefined,
          distribuciones: rows.map((row) => ({ categoria_id: row.categoria_id, monto: Number(row.monto) })),
          idempotency_key: idempotencyKey,
        };
        const createdResult: any = await financeService.createMovement(draft);
        const item = createdResult?.movement || createdResult;
        movement = { id: item.id, folio: item.folio };
        setCreated(movement);
      }
      if (receiptFile && !receiptUploaded) {
        await financeService.uploadReceipt(movement.id, receiptFile);
        setReceiptUploaded(true);
      }
      if (!balanced) {
        setStatus('incomplete');
        onSaved();
        return;
      }
      const receiptResult: any = await financeService.generateReceipt(movement.id);
      const internalReceipt = receiptResult?.receipt || receiptResult;
      setCreated({ ...movement, receiptFolio: internalReceipt.folio });
      setStatus('ready');
    } catch (submitError) {
      setStatus('idle');
      setError(submitError instanceof Error ? submitError.message : 'No pudimos registrar este movimiento.');
    }
  };

  const apply = async () => {
    if (!created || !confirmed) return;
    setApplying(true);
    setError('');
    try {
      await financeService.applyMovement(created.id);
      setStatus('applied');
      onSaved();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'No pudimos aplicar este movimiento.');
    } finally {
      setApplying(false);
    }
  };

  return <div className={styles.drawerBackdrop} role="presentation">
    <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="new-movement-title">
      <header className={styles.drawerHeader}><div><small>Finanzas</small><h2 id="new-movement-title">Registrar movimiento</h2></div><button type="button" aria-label="Cerrar" onClick={onClose}><X /></button></header>
      {status === 'incomplete' ? <div className={styles.receiptComplete}>
        <span><Info /></span><small>Borrador guardado</small><h3>{created?.folio}</h3>
        <p>Quedan <strong>{money(pendingCents / 100)}</strong> sin clasificar. El movimiento existe, pero no puede generar folio interno ni aplicarse hasta completar su distribución.</p>
        <div className={styles.receiptPreview}>{review.map((item) => <div key={item.label}><span>{item.label}</span><b>{item.value}</b></div>)}</div>
        <button type="button" className={styles.primaryButton} onClick={onClose}>Cerrar</button>
      </div> : status === 'ready' || status === 'applied' ? <div className={styles.receiptComplete}>
        <span><FileCheck2 /></span><small>Folio interno generado</small><h3>{created?.receiptFolio}</h3>
        <p>El movimiento <strong>{created?.folio}</strong> quedó registrado una sola vez con distribución cuadrada.</p>
        <div className={styles.receiptPreview}>{review.map((item) => <div key={item.label}><span>{item.label}</span><b>{item.value}</b></div>)}</div>
        {status === 'ready' ? <>
          <div className={styles.lockNotice}><ShieldCheck size={18} /><p><strong>Confirmación humana requerida</strong><span>Aplicar hace efectivo el movimiento en los indicadores financieros.</span></p></div>
          <label className={styles.confirmCheck}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Revisé el importe, la cuenta y la distribución.</label>
          {error && <p role="alert" className={styles.formError}>{error}</p>}
          <button type="button" className={styles.primaryButton} disabled={!confirmed || applying || !catalogs.permisos.aplicar} onClick={() => void apply()}>Aplicar movimiento</button>
        </> : <><div className={styles.successBanner}><Check size={17} />Movimiento aplicado correctamente.</div><button type="button" className={styles.primaryButton} onClick={onClose}>Cerrar</button></>}
      </div> : <>
        <ol className={styles.stepper}>{steps.map((label, index) => <li key={label} data-active={index + 1 === step} data-done={index + 1 < step}><span>{index + 1 < step ? <Check size={13} /> : index + 1}</span><b>{label}</b></li>)}</ol>
        <div className={styles.drawerBody}>
          {step === 1 && <section className={styles.typeStep}><h3>¿Qué movimiento registrarás?</h3><p>Registra el importe total real que entró o salió.</p><button type="button" data-selected={nature === 'INGRESO'} onClick={() => setNature('INGRESO')}><span><ArrowRight /></span><b>Ingreso</b><small>Dinero realmente recibido</small></button><button type="button" data-selected={nature === 'EGRESO'} onClick={() => setNature('EGRESO')}><span><ArrowLeft /></span><b>Egreso</b><small>Dinero efectivamente entregado o pagado</small></button></section>}
          {step === 2 && <section className={styles.formStep}><h3>Datos del movimiento</h3><div className={styles.formGrid}>
            <label><span>Importe total (MXN)</span><input autoFocus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label>
            <label><span>Fecha efectiva</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label className={styles.wideField}><span>Cuenta</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Selecciona una cuenta</option>{catalogs.accounts.map((item) => <option key={item.id} value={item.id}>{accountLabel(item)}</option>)}</select></label>
            <label className={styles.wideField}><span>Expediente{lockExpediente ? '' : ' (opcional)'}</span><select aria-label={lockExpediente ? 'Expediente' : 'Expediente (opcional)'} value={caseId} disabled={lockExpediente} onChange={(event) => setCaseId(event.target.value)}><option value="">Movimiento general</option>{catalogs.expedientes.map((item) => <option key={item.id} value={item.id}>{item.numero_pravia} · {item.cliente_alias}</option>)}</select>{lockExpediente && <small className={styles.lockedFieldNote}>Este movimiento quedará vinculado al expediente actual.</small>}</label>
            <label className={styles.wideField}><span>Concepto</span><input value={concept} onChange={(event) => setConcept(event.target.value)} placeholder="Ej. Anticipo de cliente" /></label>
            <label><span>Forma de pago</span><select value={method} onChange={(event) => setMethod(event.target.value)}><option>TRANSFERENCIA</option><option>EFECTIVO</option><option>CHEQUE</option><option>TARJETA</option></select></label>
            <label><span>Referencia</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="SPEI, folio…" /></label>
            <label className={styles.wideField}><span>Descripción (opcional)</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label>
          </div></section>}
          {step === 3 && <section className={styles.formStep}><h3>Distribución económica</h3><p>Separa qué parte corresponde al despacho, a terceros u otros destinos reales.</p><MovementDistribution total={total} nature={nature} categories={catalogs.categories} rows={rows} onChange={setRows} /></section>}
          {step === 4 && <section className={styles.receiptStep}><span><ReceiptText /></span><h3>Comprobante del movimiento</h3><p>Adjunta la evidencia real ahora o continúa y agrégala después desde el mismo movimiento.</p>{catalogs.permisos.documentosEscribir ? <label className={styles.receiptUpload} data-selected={Boolean(receiptFile)}><input type="file" accept=".pdf,.png,.jpg,.jpeg,.bmp,.doc,.docx" onChange={(event) => setReceiptFile(event.target.files?.[0] || null)} /><UploadCloud size={19} /><span><b>{receiptFile?.name || 'Seleccionar comprobante'}</b><small>PDF, imagen o documento; máximo 25 MB</small></span></label> : <div className={styles.infoBanner}><Info size={17} /><p><strong>Registro sin carga documental</strong><span>Tu rol no permite adjuntar archivos, pero sí registrar el movimiento.</span></p></div>}<div className={styles.lockNotice}><Info size={18} /><p><strong>Folio interno automático</strong><span>PRAVIA genera su comprobante interno trazable sin fingir un CFDI ni sustituir la evidencia adjunta.</span></p></div></section>}
          {step === 5 && <section className={styles.reviewStep}><h3>Revisa antes de registrar</h3><div className={styles.reviewList}>{review.map((item) => <div key={item.label}><span>{item.label}</span><b>{item.value}</b></div>)}</div><div className={styles.reviewDistribution}><h4>Distribución</h4>{rows.map((row, index) => <p key={index}><span>{catalogs.categories.find((item) => item.id === row.categoria_id)?.nombre}</span><b>{money(row.monto)}</b></p>)}</div><p className={styles.reviewNote}><Landmark size={16} />El saldo mostrado por PRAVIA es calculado; no sustituye el saldo oficial del banco.</p></section>}
          {error && <p role="alert" className={styles.formError}>{error}</p>}
        </div>
        <footer className={styles.drawerFooter}><button type="button" className={styles.secondaryButton} disabled={step === 1 || status === 'saving'} onClick={() => setStep(step - 1)}><ArrowLeft size={16} />Atrás</button>{step < 5 ? <button type="button" className={styles.primaryButton} disabled={!canNext} onClick={() => setStep(step + 1)}>Continuar<ArrowRight size={16} /></button> : <button type="button" className={styles.primaryButton} disabled={status === 'saving'} onClick={() => void submit()}>{status === 'saving' ? 'Registrando…' : 'Registrar movimiento'}</button>}</footer>
      </>}
    </aside>
  </div>;
}
