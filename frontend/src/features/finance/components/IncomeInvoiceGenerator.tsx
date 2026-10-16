import { FileText, LoaderCircle, Plus, Trash2, UploadCloud, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from '../Finance.module.css';
import { financeService } from '../finance.service';
import { comparecientesService } from '../../comparecientes/comparecientes.service';
import type { FiscalConcept, FiscalEntity, FiscalIncomeContext, FiscalProviderStatus } from '../finance.types';

type Line = { key: string; conceptId: string; quantity: string; unitPrice: string };
const emptyLine = (): Line => ({ key: crypto.randomUUID(), conceptId: '', quantity: '1', unitPrice: '' });
const money = (value: string | number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0));
const cents = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value.trim()) ? BigInt(value.trim().split('.')[0]) * 100n + BigInt((value.trim().split('.')[1] || '').padEnd(2, '0')) : null;
const rateMillion = (value: string) => /^\d+(?:\.\d{1,6})?$/.test(String(value)) ? BigInt(String(value).split('.')[0]) * 1_000_000n + BigInt((String(value).split('.')[1] || '').padEnd(6, '0')) : null;
const roundDiv = (numerator: bigint, denominator: bigint) => (numerator + denominator / 2n) / denominator;
const fixed = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;

function totalsFor(lines: Line[], concepts: FiscalConcept[]) {
  let subtotal = 0n; let transferred = 0n; let retained = 0n;
  for (const line of lines) {
    const concept = concepts.find((item) => item.id === line.conceptId);
    const price = cents(line.unitPrice);
    const quantity = rateMillion(line.quantity);
    if (!concept || price === null || quantity === null || price <= 0n || quantity <= 0n) return null;
    const base = roundDiv(price * quantity, 1_000_000n);
    const ivaRate = rateMillion(concept.iva_tasa);
    const ivaRetentionRate = rateMillion(concept.iva_retencion_tasa);
    const isrRetentionRate = rateMillion(concept.isr_retencion_tasa);
    if (ivaRate === null || ivaRetentionRate === null || isrRetentionRate === null) return null;
    subtotal += base;
    transferred += roundDiv(base * ivaRate, 1_000_000n);
    retained += roundDiv(base * ivaRetentionRate, 1_000_000n) + roundDiv(base * isrRetentionRate, 1_000_000n);
  }
  return { subtotal: fixed(subtotal), transferred: fixed(transferred), retained: fixed(retained), total: fixed(subtotal + transferred - retained) };
}

function initialIncomeLine(context: FiscalIncomeContext, concepts: FiscalConcept[], entityId: string): Line | null {
  const available = concepts.filter((item) => item.activo && item.entidad_fiscal_id === entityId &&
    (!item.tipo_acto_id || context.acts.some((act) => act.tipo_acto_id === item.tipo_acto_id)));
  const name = context.income.concepto_contexto?.trim().toLocaleLowerCase('es-MX');
  const matching = name ? available.filter((item) => item.descripcion.trim().toLocaleLowerCase('es-MX') === name) : [];
  const concept = matching.length === 1 ? matching[0] : available.length === 1 ? available[0] : null;
  const target = cents(context.remainingInvoiceableAmount);
  if (!concept || target === null || target <= 0n) return null;

  // El ingreso es un importe final; el valor unitario se infiere de las tasas
  // configuradas, nunca de un IVA supuesto. Si no cuadra al centavo, no se
  // presenta un concepto autocompletado engañoso.
  let low = 1n;
  let high = target * 10n + 100n;
  while (low <= high) {
    const midpoint = (low + high) / 2n;
    const candidate = { key: crypto.randomUUID(), conceptId: concept.id, quantity: '1', unitPrice: fixed(midpoint) };
    const calculated = totalsFor([candidate], [concept]);
    const result = calculated ? cents(calculated.total) : null;
    if (result === target) return candidate;
    if (result === null || result > target) high = midpoint - 1n;
    else low = midpoint + 1n;
  }
  return null;
}

export function IncomeInvoiceGenerator({ incomeId, onClose, onChanged }: { incomeId: string; onClose: () => void; onChanged: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const saveInFlightRef = useRef(false);
  const createKeyRef = useRef(crypto.randomUUID());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [context, setContext] = useState<FiscalIncomeContext | null>(null);
  const [entities, setEntities] = useState<FiscalEntity[]>([]);
  const [concepts, setConcepts] = useState<FiscalConcept[]>([]);
  const [provider, setProvider] = useState<FiscalProviderStatus | null>(null);
  const [entityId, setEntityId] = useState('');
  const [receiverId, setReceiverId] = useState('');
  const [draftId, setDraftId] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [method, setMethod] = useState<'PUE' | 'PPD'>('PPD');
  const [form, setForm] = useState('99');
  const [useCfdi, setUseCfdi] = useState('');
  const [currency, setCurrency] = useState('MXN');
  const [exchangeRate, setExchangeRate] = useState('');
  const [exportCode, setExportCode] = useState('');
  const [issuePlace, setIssuePlace] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [fiscalForm, setFiscalForm] = useState({ rfc: '', razon_social: '', regimen_fiscal: '', codigo_postal: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploadedCsfReceiverId, setUploadedCsfReceiverId] = useState('');
  const [csfState, setCsfState] = useState<'idle' | 'uploading' | 'extracting' | 'complete' | 'processing-error' | 'upload-error'>('idle');

  const load = useCallback(async (signal?: AbortSignal, preferredDraftId?: string) => {
    setStatus('loading');
    try {
      const [nextContext, nextEntities, nextConcepts, nextProvider] = await Promise.all([
        financeService.fiscalIncomeContext(incomeId, signal), financeService.fiscalEntities(signal),
        financeService.fiscalConcepts(undefined, signal), financeService.fiscalStatus(signal),
      ]);
      setContext(nextContext); setEntities(nextEntities); setConcepts(nextConcepts); setProvider(nextProvider);
      const draft = nextContext.documents.find((item) => item.id === preferredDraftId && (item.estado === 'PREFACTURA' || item.estado === 'DRAFT'))
        || nextContext.documents.find((item) => item.estado === 'PREFACTURA' || item.estado === 'DRAFT');
      setDraftId(draft?.id || '');
      const initialEntityId = draft?.entidad_fiscal_id || nextEntities.find((item) => item.activa)?.id || '';
      setEntityId(initialEntityId);
      setReceiverId(draft?.receptor_compareciente_id || nextContext.income.receptor?.id || nextContext.receivers[0]?.compareciente.id || '');
      const savedLines = draft?.draft_payload?.concepts;
      setLines(savedLines?.length ? savedLines.map((line) => ({ key: crypto.randomUUID(), conceptId: line.concepto_fiscal_id,
        quantity: line.cantidad, unitPrice: line.valor_unitario })) : [initialIncomeLine(nextContext, nextConcepts, initialEntityId) || emptyLine()]);
      const applied = nextContext.income.estado === 'APLICADO';
      const paymentForm = ({ TRANSFERENCIA: '03', EFECTIVO: '01', CHEQUE: '02' } as Record<string, string>)[nextContext.income.forma_pago || ''];
      setMethod(draft?.metodo_pago || (applied && paymentForm ? 'PUE' : 'PPD'));
      setForm(draft?.forma_pago || (applied && paymentForm ? paymentForm : '99'));
      setUseCfdi(draft?.uso_cfdi || '');
      setCurrency(draft?.moneda || 'MXN');
      setExchangeRate(draft?.draft_payload?.fiscal_comprobante?.tipo_cambio || '');
      setExportCode(draft?.draft_payload?.fiscal_comprobante?.exportacion || '');
      setIssuePlace(draft?.draft_payload?.fiscal_comprobante?.lugar_expedicion || nextEntities.find((item) => item.id === initialEntityId)?.codigo_postal || '');
      setPaymentTerms(draft?.draft_payload?.fiscal_comprobante?.condiciones_pago || '');
      setStatus('ready');
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setStatus('error');
    }
  }, [incomeId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); closeRef.current?.focus(); return () => controller.abort(); }, [load]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const entity = entities.find((item) => item.id === entityId);
  const receiver = context?.receivers.find((item) => item.compareciente.id === receiverId)?.compareciente;
  const profile = receiver?.fiscalProfile;
  const availableConcepts = concepts.filter((item) => item.activo && item.entidad_fiscal_id === entityId &&
    (!item.tipo_acto_id || context?.acts.some((act) => act.tipo_acto_id === item.tipo_acto_id)));
  const totals = useMemo(() => totalsFor(lines, availableConcepts), [lines, availableConcepts]);
  const currentDraft = context?.documents.find((item) => item.id === draftId);
  const savedDrafts = context?.documents.filter((item) => item.estado === 'PREFACTURA' || item.estado === 'DRAFT') || [];
  const currentReserved = cents(currentDraft?.total || '0.00') || 0n;
  const availableCents = (cents(context?.remainingInvoiceableAmount || '0.00') || 0n) + currentReserved;
  const exceeds = Boolean(totals && cents(totals.total)! > availableCents);
  const canStamp = Boolean(provider?.configured && provider.realStampingVerified);

  const changeLine = (key: string, patch: Partial<Line>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  const selectDraft = (id: string) => {
    const draft = savedDrafts.find((item) => item.id === id);
    setDraftId(draft?.id || '');
    const selectedEntityId = draft?.entidad_fiscal_id || entities.find((item) => item.activa)?.id || '';
    setEntityId(selectedEntityId);
    setReceiverId(draft?.receptor_compareciente_id || context?.income.receptor?.id || context?.receivers[0]?.compareciente.id || '');
    setLines(draft?.draft_payload?.concepts?.length ? draft.draft_payload.concepts.map((line) => ({ key: crypto.randomUUID(), conceptId: line.concepto_fiscal_id,
      quantity: line.cantidad, unitPrice: line.valor_unitario })) : [context ? initialIncomeLine(context, concepts, selectedEntityId) || emptyLine() : emptyLine()]);
    setMethod(draft?.metodo_pago || 'PPD'); setForm(draft?.forma_pago || '99'); setUseCfdi(draft?.uso_cfdi || '');
    setCurrency(draft?.moneda || 'MXN');
    setExchangeRate(draft?.draft_payload?.fiscal_comprobante?.tipo_cambio || '');
    setExportCode(draft?.draft_payload?.fiscal_comprobante?.exportacion || '');
    setIssuePlace(draft?.draft_payload?.fiscal_comprobante?.lugar_expedicion || entities.find((item) => item.id === selectedEntityId)?.codigo_postal || '');
    setPaymentTerms(draft?.draft_payload?.fiscal_comprobante?.condiciones_pago || '');
    if (!id) createKeyRef.current = crypto.randomUUID();
    setError(''); setNotice('');
  };
  const save = async () => {
    if (saveInFlightRef.current || !context || !receiver || !profile || !entity || !totals || exceeds) return;
    saveInFlightRef.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = { direccion: 'EMITIDO', tipo: 'I', entidad_fiscal_id: entityId,
        expediente_id: context.income.expediente_id, ingreso_reportado_id: incomeId,
        receptor_compareciente_id: receiverId, uso_cfdi: useCfdi, metodo_pago: method, forma_pago: form,
        moneda: currency, tipo_cambio: exchangeRate, exportacion: exportCode,
        lugar_expedicion: issuePlace, condiciones_pago: paymentTerms,
        subtotal: totals.subtotal, impuestos_trasladados: totals.transferred,
        impuestos_retenidos: totals.retained, total: totals.total,
        conceptos: lines.map((line) => ({ concepto_fiscal_id: line.conceptId, cantidad: line.quantity, valor_unitario: line.unitPrice })),
        concepto: context.income.concepto_contexto || 'Honorarios de expediente', idempotency_key: createKeyRef.current };
      const result = draftId ? await financeService.updateFiscalDraft(draftId, payload)
        : await financeService.createFiscalDraft(payload);
      const savedId = draftId || (result as { cfdi?: { id?: string } })?.cfdi?.id;
      await load(undefined, savedId); onChanged(); setNotice('Prefactura guardada. No se ha timbrado ni creado un nuevo movimiento.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No pudimos guardar la prefactura.'); }
    finally { saveInFlightRef.current = false; setBusy(false); }
  };
  const remove = async () => {
    if (!draftId) return;
    setBusy(true); setError('');
    try { await financeService.deleteFiscalDraft(draftId); await load(); onChanged(); setNotice('Prefactura eliminada; saldo liberado.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No pudimos eliminar la prefactura.'); }
    finally { setBusy(false); }
  };
  const extract = async (file: File | undefined) => {
    if (!file || !receiver) return;
    setBusy(true); setError(''); setNotice(''); setCsfState('uploading');
    try {
      await comparecientesService.uploadDocument(receiver.id, file, 'CONSTANCIA_FISCAL', { notes: 'Constancia de situación fiscal cargada desde generación de factura; datos sujetos a confirmación humana.' });
    } catch (reason) {
      setCsfState('upload-error');
      setError(reason instanceof Error ? reason.message : 'No pudimos cargar la CSF. El archivo no se marcó como disponible.');
      setBusy(false);
      return;
    }
    setUploadedCsfReceiverId(receiver.id);
    setCsfState('extracting');
    try {
      const result = await financeService.extractCsf(file);
      setFiscalForm({ rfc: result.rfc || '', razon_social: result.razon_social || receiver?.nombre_busqueda || '',
        regimen_fiscal: result.regimenes_fiscales[0]?.clave || '', codigo_postal: result.codigo_postal || '' });
      setCsfState('complete');
      setNotice('CSF conservada en el archivo del compareciente. Datos extraídos como sugerencia: revisa y confirma.');
    } catch {
      setCsfState('processing-error');
      setError('La CSF se cargó y permanece disponible, pero no pudimos extraer sus datos. Revisa el documento y captura los datos fiscales manualmente.');
    }
    finally { setBusy(false); }
  };
  const confirmProfile = async () => {
    if (!receiver) return;
    setBusy(true); setError('');
    try { await financeService.confirmFiscalReceiver(incomeId, receiver.id, fiscalForm);
      setContext(await financeService.fiscalIncomeContext(incomeId));
      setNotice('Datos fiscales confirmados y guardados en el compareciente.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No pudimos confirmar el perfil fiscal.'); }
    finally { setBusy(false); }
  };

  return <div className={styles.invoiceGeneratorOverlay} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <aside className={styles.invoiceGenerator} role="dialog" aria-modal="true" aria-label="Generar factura CFDI">
      <header className={styles.invoiceGeneratorHeader}><div><small>FACTURACIÓN · INGRESO DE EXPEDIENTE</small><h2>Generar factura CFDI</h2><p>Revisa la prefactura antes de cualquier timbrado.</p></div><button ref={closeRef} type="button" aria-label="Cerrar generador" onClick={onClose}><X/></button></header>
      {status === 'loading' && <div className={styles.invoiceGeneratorState} role="status"><LoaderCircle className={styles.invoiceSpinner}/>Preparando datos del ingreso…</div>}
      {status === 'error' && <div className={styles.invoiceGeneratorState} role="alert">No pudimos cargar el contexto fiscal.<button type="button" onClick={() => void load()}>Reintentar</button></div>}
      {status === 'ready' && context && <div className={styles.invoiceGeneratorBody}>
        <div className={styles.invoiceContext}><strong>{context.income.expediente.numero_pravia}</strong><span>{context.income.expediente.cliente_alias || 'Expediente'}</span><span>Ingreso facturable {money(context.facturableAmount)}</span><span>Facturado {money(context.invoicedAmount)}</span><span>Reservado en prefacturas {money(context.reservedDraftAmount)}</span><b>Disponible para esta prefactura {money(fixed(availableCents))}</b></div>
        <div className={styles.invoiceProvenanceSummary}><span>Acto: {context.acts.map((item) => item.tipo_acto.nombre).join(', ') || 'sin acto activo'}</span><span>Responsable: {context.income.expediente.abogado ? `${context.income.expediente.abogado.nombre} ${context.income.expediente.abogado.apellido || ''}`.trim() : 'sin dato confirmado'}</span><span>Presupuesto: {context.income.expediente.presupuesto ? `${money(context.income.expediente.presupuesto.total)} · v${context.income.expediente.presupuesto.version}` : 'sin presupuesto estructurado'}</span><span>Concepto reportado: {context.income.concepto_contexto || 'sin dato confirmado'}</span><span>Fecha del ingreso: {context.income.fecha_ingreso ? new Date(context.income.fecha_ingreso).toLocaleDateString('es-MX') : 'sin dato confirmado'}</span></div>
        {savedDrafts.length > 0 && <div className={styles.invoiceDraftPicker}><label>Continuar prefactura<select value={draftId} onChange={(event) => selectDraft(event.target.value)}><option value="">Nueva prefactura</option>{savedDrafts.map((draft, index) => <option key={draft.id} value={draft.id}>Prefactura {index + 1} · {money(draft.total)} · {draft.created_at ? new Date(draft.created_at).toLocaleDateString('es-MX') : 'sin fecha'}</option>)}</select></label><small>Una prefactura reserva saldo, pero todavía no es un CFDI timbrado.</small></div>}
        <section className={styles.invoiceGeneratorSection}><header><span>1</span><h3>Receptor</h3><small>Autocargado desde expediente</small></header>
          <label>Compareciente del expediente<select value={receiverId} disabled={Boolean(draftId) || busy} onChange={(event) => { setReceiverId(event.target.value); setCsfState('idle'); setFiscalForm({ rfc: '', razon_social: '', regimen_fiscal: '', codigo_postal: '' }); }}><option value="">Seleccionar receptor</option>{context.receivers.map((item) => <option key={item.id} value={item.compareciente.id}>{item.compareciente.nombre_busqueda}</option>)}</select></label>
          {profile ? <div className={styles.invoiceAutofill}><strong>{profile.razon_social}</strong><span>RFC {profile.rfc} · Régimen {profile.regimen_fiscal} · CP {profile.codigo_postal}</span><small>Perfil fiscal confirmado · versión {profile.version}</small></div> : receiver && <div className={styles.invoiceFiscalReview}><p>Faltan datos fiscales confirmados para este compareciente. La extracción de CSF exige revisión humana.</p><label className={styles.invoiceFile}><UploadCloud/> Cargar CSF para extraer datos<input type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={(event) => void extract(event.target.files?.[0])}/></label>{(csfState === 'uploading' || csfState === 'extracting') && <small role="status">{csfState === 'uploading' ? 'Cargando CSF…' : 'CSF cargada · extrayendo datos…'}</small>}{uploadedCsfReceiverId === receiver.id && <small role="status">{csfState === 'processing-error' ? 'CSF cargada — error de extracción. El documento sigue disponible.' : 'CSF guardada en documentos del compareciente.'}</small>}<div className={styles.invoiceFieldGrid}><label>RFC<input value={fiscalForm.rfc} onChange={(event) => setFiscalForm({ ...fiscalForm, rfc: event.target.value })}/></label><label>Nombre fiscal<input value={fiscalForm.razon_social} onChange={(event) => setFiscalForm({ ...fiscalForm, razon_social: event.target.value })}/></label><label>Régimen<input value={fiscalForm.regimen_fiscal} onChange={(event) => setFiscalForm({ ...fiscalForm, regimen_fiscal: event.target.value })}/></label><label>CP fiscal<input value={fiscalForm.codigo_postal} onChange={(event) => setFiscalForm({ ...fiscalForm, codigo_postal: event.target.value })}/></label></div><button type="button" disabled={busy} onClick={() => void confirmProfile()}>Confirmar y guardar datos fiscales</button></div>}
        </section>
        <section className={styles.invoiceGeneratorSection}><header><span>2</span><h3>Emisor</h3><small>Autocargado desde configuración</small></header><label>Entidad fiscal<select value={entityId} disabled={Boolean(draftId)} onChange={(event) => { setEntityId(event.target.value); setIssuePlace(entities.find((item) => item.id === event.target.value)?.codigo_postal || ''); setLines([initialIncomeLine(context, concepts, event.target.value) || emptyLine()]); }}><option value="">Seleccionar entidad</option>{entities.filter((item) => item.activa).map((item) => <option key={item.id} value={item.id}>{item.razon_social}</option>)}</select></label>{entity ? <div className={styles.invoiceAutofill}><strong>{entity.razon_social}</strong><span>RFC {entity.rfc} · Régimen {entity.regimen_fiscal} · CP {entity.codigo_postal}</span><small>Serie {entity.serie || 'sin configurar'} · Llave CSD: {entity.csd_key_configured ? 'referencia registrada' : 'referencia pendiente'} · PAC: {entity.pac_secret_configured ? 'referencia registrada' : 'referencia pendiente'}</small></div> : <p>Configura una entidad fiscal activa para continuar.</p>}</section>
        <section className={styles.invoiceGeneratorSection}><header><span>3</span><h3>Datos del comprobante</h3><small>Pago y expediente</small></header><div className={styles.invoiceFieldGrid}><label>Tipo<input readOnly value="I · Ingreso"/></label><label>Versión<input readOnly value="CFDI 4.0"/></label><label>Moneda<input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())}/></label><label>Tipo de cambio<input value={exchangeRate} inputMode="decimal" disabled={currency === 'MXN'} onChange={(event) => setExchangeRate(event.target.value)} placeholder={currency === 'MXN' ? 'No aplica' : 'Confirmar tipo de cambio'}/></label><label>Uso CFDI<input value={useCfdi} onChange={(event) => setUseCfdi(event.target.value.toUpperCase())} placeholder="Confirmar uso fiscal" maxLength={8}/></label><label>Exportación SAT<input value={exportCode} onChange={(event) => setExportCode(event.target.value)} placeholder="Clave SAT" maxLength={2}/></label><label>Lugar de expedición<input value={issuePlace} onChange={(event) => setIssuePlace(event.target.value)} maxLength={5}/></label><label>Condiciones de pago<input value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} maxLength={300}/></label><label>Método<select value={method} onChange={(event) => { const next = event.target.value as 'PUE' | 'PPD'; setMethod(next); setForm(next === 'PPD' ? '99' : ({ TRANSFERENCIA: '03', EFECTIVO: '01', CHEQUE: '02' } as Record<string, string>)[context.income.forma_pago || ''] || ''); }}><option value="PPD">PPD · Parcialidades o diferido</option><option value="PUE">PUE · Una exhibición</option></select></label><label>Forma de pago SAT<input value={form} onChange={(event) => setForm(event.target.value)} maxLength={2} readOnly={method === 'PPD'}/></label></div><p className={styles.invoiceProvenance}>Lugar precargado desde el emisor. La clave de exportación requiere confirmación fiscal; no se presupone. Forma reportada en el ingreso: {context.income.forma_pago || 'sin confirmar'}. PUE sólo es válido tras aplicar el ingreso.</p></section>
        <section className={styles.invoiceGeneratorSection}><header><span>4</span><h3>Conceptos</h3><small>Claves e impuestos configurados por la Notaría</small></header>{!availableConcepts.length && <p className={styles.invoiceWarning}>No hay conceptos fiscales activos para este emisor y los actos del expediente. Configúralos con el responsable fiscal antes de generar.</p>}{lines.map((line, index) => <div className={styles.invoiceConceptLine} key={line.key}><div className={styles.invoiceFieldGrid}><label>Concepto {index + 1}<select value={line.conceptId} onChange={(event) => changeLine(line.key, { conceptId: event.target.value })}><option value="">Seleccionar concepto configurado</option>{availableConcepts.map((item) => <option key={item.id} value={item.id}>{item.descripcion} · {item.clave_prod_serv}</option>)}</select></label><label>Cantidad<input inputMode="decimal" value={line.quantity} onChange={(event) => changeLine(line.key, { quantity: event.target.value })}/></label><label>Valor unitario sin impuestos<input inputMode="decimal" value={line.unitPrice} onChange={(event) => changeLine(line.key, { unitPrice: event.target.value })} placeholder="0.00"/></label></div>{line.conceptId && <p>Clave SAT {availableConcepts.find((item) => item.id === line.conceptId)?.clave_prod_serv} · Unidad {availableConcepts.find((item) => item.id === line.conceptId)?.clave_unidad} · Tasas según configuración.</p>}{lines.length > 1 && <button type="button" aria-label={`Quitar concepto ${index + 1}`} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><Trash2/> Quitar</button>}</div>)}<button type="button" className={styles.invoiceSecondary} disabled={lines.length >= 20} onClick={() => setLines((current) => [...current, emptyLine()])}><Plus/> Agregar concepto</button></section>
        <section className={styles.invoiceGeneratorSection}><header><span>5</span><h3>Totales</h3><small>Derivados, no editables</small></header>{totals ? <dl className={styles.invoiceTotals}><div><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd></div><div><dt>Impuestos trasladados</dt><dd>{money(totals.transferred)}</dd></div><div><dt>Retenciones</dt><dd>−{money(totals.retained)}</dd></div><div><dt>Total prefactura</dt><dd>{money(totals.total)}</dd></div></dl> : <p>Selecciona concepto, cantidad y valor unitario para calcular importes.</p>}{exceeds && <p className={styles.invoiceWarning} role="alert">El total excede el saldo disponible de {money(fixed(availableCents))}.</p>}</section>
        <section className={styles.invoiceGeneratorSection}><header><span>6</span><h3>Vista previa / Timbrado</h3><small>La vista previa no es un CFDI timbrado</small></header><div className={styles.invoicePreview}><FileText/><div><strong>{draftId ? 'Prefactura guardada' : 'Vista previa de prefactura'}</strong><p>{receiver?.nombre_busqueda || 'Receptor pendiente'} · {entity?.razon_social || 'Emisor pendiente'} · {totals ? money(totals.total) : 'Total pendiente'}</p><small>Sin UUID fiscal · Sin XML timbrado · Sin PDF fiscal</small></div></div><button type="button" disabled={!canStamp} title={!canStamp ? 'Timbrado no certificado: falta configuración/validación PAC' : undefined}>Timbrar CFDI</button>{!canStamp && <p className={styles.invoiceWarning}>Timbrado no disponible: el proveedor PAC no está certificado en este entorno.</p>}</section>
        {error && <p className={styles.invoiceError} role="alert">{error}</p>}{notice && <p className={styles.invoiceNotice} role="status">{notice}</p>}
      </div>}
      {status === 'ready' && <footer className={styles.invoiceGeneratorFooter}><button type="button" onClick={onClose}>Cerrar</button>{draftId && <button type="button" disabled={busy} onClick={() => void remove()}><Trash2/>Eliminar prefactura</button>}<button type="button" className={styles.invoiceSave} disabled={busy || !context || !entity || !profile || !totals || exceeds || !availableConcepts.length || !useCfdi} onClick={() => void save()}>{busy ? 'Guardando…' : draftId ? 'Guardar cambios' : 'Guardar prefactura'}</button></footer>}
    </aside>
  </div>;
}
