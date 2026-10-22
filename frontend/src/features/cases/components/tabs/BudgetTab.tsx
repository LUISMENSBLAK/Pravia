import { ArrowDown, ArrowUp, Download, Eye, FilePlus2, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DocumentViewer } from '../../../../components/documents/DocumentViewer';
import { ApiError } from '../../../../services/api/client';
import { expedientesService } from '../../expedientes.service';
import type { BudgetConceptCategory, BudgetTaxTreatment, ExpedienteBudget, ExpedienteBudgetConcept, ExpedienteBudgetPdf } from '../../expedientes.types';
import styles from './BudgetTab.module.css';

const emptyConcept = (order: number): ExpedienteBudgetConcept => ({ concepto: '', categoria: 'HONORARIOS', importe: '0.00', orden: order });
const money = (value: string | number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0));
const date = (value: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const categoryOptions: Array<{ value: BudgetConceptCategory; label: string }> = [
  { value: 'HONORARIOS', label: 'Honorarios' },
  { value: 'IMPUESTOS_DERECHOS', label: 'Impuestos y derechos' },
  { value: 'OTRO_GASTO', label: 'Otro gasto' },
];
const baseline = (concepts: ExpedienteBudgetConcept[]) => JSON.stringify(concepts.map(({ id: _id, ...item }, index) => ({ ...item, orden: index })));

type Preview = { item: ExpedienteBudgetPdf; url?: string; loading: boolean; error?: string } | null;

export function BudgetTab({ expedienteId, onDirtyChange }: { expedienteId: string; onDirtyChange?: (dirty: boolean) => void }) {
  const [budget, setBudget] = useState<ExpedienteBudget | null>(null);
  const [concepts, setConcepts] = useState<ExpedienteBudgetConcept[]>([]);
  const [savedBaseline, setSavedBaseline] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'generating'>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<Preview>(null);
  const [calculatedTotals, setCalculatedTotals] = useState<ExpedienteBudget['totals'] | null>(null);
  const [calculationError, setCalculationError] = useState('');

  const hydrate = useCallback((next: ExpedienteBudget) => {
    const nextConcepts = next.concepts.filter((item) => item.categoria !== 'IVA_HONORARIOS').map((item, index) => ({ ...item, orden: index }));
    setBudget(next); setConcepts(nextConcepts); setSavedBaseline(baseline(nextConcepts)); setStatus('ready'); setError('');
    setCalculatedTotals(next.totals); setCalculationError('');
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    setStatus('loading');
    try { hydrate(await expedientesService.budget(expedienteId, signal)); }
    catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setStatus('ready'); setError(caught instanceof ApiError ? caught.message : 'No pudimos cargar el presupuesto.');
      }
    }
  }, [expedienteId, hydrate]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const dirty = Boolean(budget) && baseline(concepts) !== savedBaseline;
  const previewConcepts = useMemo(() => concepts.map((item, orden) => ({ ...item, orden,
    tratamiento_iva: item.categoria === 'OTRO_GASTO' ? item.tratamiento_iva || 'REQUIERE_REVISION' : null,
    iva_tasa: item.categoria === 'OTRO_GASTO' && item.tratamiento_iva === 'GRAVADO' ? item.iva_tasa : null,
    regla_fiscal_fuente: item.categoria === 'OTRO_GASTO' ? item.regla_fiscal_fuente?.trim() || null : null,
    regla_fiscal_version: item.categoria === 'OTRO_GASTO' ? item.regla_fiscal_version?.trim() || null : null,
  })), [concepts]);
  useEffect(() => {
    if (!budget || !dirty) return;
    setCalculatedTotals(null);
    if (!concepts.length || !concepts.every((item) => item.concepto.trim() && /^\d+(?:\.\d{1,2})?$/.test(item.importe) && Number(item.importe) > 0)) {
      setCalculationError('Completa cada concepto con un nombre y un importe válido para calcular el total.');
      return;
    }
    setCalculationError('');
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void expedientesService.previewBudget(expedienteId, previewConcepts, controller.signal)
        .then((result) => { setCalculatedTotals(result.totals); setCalculationError(''); })
        .catch((cause) => { if (!(cause instanceof DOMException && cause.name === 'AbortError')) { setCalculatedTotals(null); setCalculationError(cause instanceof Error ? cause.message : 'No pudimos calcular el presupuesto.'); } });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [budget, concepts, dirty, expedienteId, previewConcepts]);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { const protect = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect); }, [dirty]);

  const updateConcept = (index: number, field: keyof ExpedienteBudgetConcept, value: string | BudgetConceptCategory | BudgetTaxTreatment) => {
    setNotice(''); setConcepts((current) => current.map((item, itemIndex) => itemIndex !== index ? item
      : field === 'categoria' && value !== 'OTRO_GASTO' ? { ...item, categoria: value as BudgetConceptCategory, tratamiento_iva: null, iva_tasa: null, regla_fiscal_fuente: null, regla_fiscal_version: null }
        : field === 'tratamiento_iva' && value !== 'GRAVADO' ? { ...item, tratamiento_iva: value as BudgetTaxTreatment, iva_tasa: null }
          : { ...item, [field]: value }));
  };
  const move = (index: number, direction: -1 | 1) => setConcepts((current) => {
    const target = index + direction; if (target < 0 || target >= current.length) return current;
    const next = [...current]; [next[index], next[target]] = [next[target], next[index]];
    return next.map((item, orden) => ({ ...item, orden }));
  });
  const remove = (index: number) => setConcepts((current) => current.filter((_, itemIndex) => itemIndex !== index).map((item, orden) => ({ ...item, orden })));

  const save = async () => {
    if (!budget || !budget.capabilities.can_edit) return; setStatus('saving'); setError(''); setNotice('');
    try {
      hydrate(await expedientesService.saveBudget(expedienteId, { expected_version: budget.version, concepts: previewConcepts }));
      setNotice('Presupuesto guardado.');
    } catch (caught) {
      setStatus('ready'); setError(caught instanceof ApiError && caught.status === 409 ? 'El presupuesto cambió en otra sesión. Tus cambios siguen aquí; recarga antes de decidir cómo continuar.' : caught instanceof ApiError ? caught.message : 'No pudimos guardar. Tus cambios permanecen en pantalla.');
    }
  };
  const generate = async () => {
    if (!budget || dirty) return; setStatus('generating'); setError(''); setNotice('');
    try {
      await expedientesService.generateBudgetPdf(expedienteId, { expected_version: budget.version, idempotency_key: crypto.randomUUID(), note: note.trim() || undefined });
      setNote(''); hydrate(await expedientesService.budget(expedienteId)); setNotice('Presupuesto generado con la plantilla CFG-002 ADM-001 y agregado al historial.');
    } catch (caught) { setStatus('ready'); setError(caught instanceof ApiError ? caught.message : 'No pudimos generar el presupuesto. No se registró ningún documento incompleto.'); }
  };
  const documentUrl = async (item: ExpedienteBudgetPdf) => expedientesService.budgetPdfUrl(expedienteId, item.id);
  const showPreview = async (item: ExpedienteBudgetPdf) => {
    setPreview({ item, loading: true }); setError('');
    try { const result = await documentUrl(item); setPreview({ item, url: result.url, loading: false }); }
    catch (caught) { setPreview({ item, loading: false, error: caught instanceof ApiError ? caught.message : 'No pudimos preparar la vista previa.' }); }
  };
  const download = async (item: ExpedienteBudgetPdf) => {
    setError('');
    try { const result = await documentUrl(item); const link = document.createElement('a'); link.href = result.url; link.download = result.file_name; link.rel = 'noopener noreferrer'; link.click(); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'No pudimos descargar el documento.'); }
  };
  const removeDocument = async (id: string) => {
    if (!window.confirm('¿Retirar este documento histórico? El archivo permanecerá preservado para auditoría.')) return;
    try { await expedientesService.deleteBudgetPdf(expedienteId, id); hydrate(await expedientesService.budget(expedienteId)); setNotice('Documento histórico retirado.'); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'No pudimos retirar el documento.'); }
  };

  if (status === 'loading') return <section className={styles.state} role="status"><LoaderCircle className={styles.spin} />Cargando presupuesto…</section>;
  if (!budget) return <section className={styles.state} role="alert"><strong>Presupuesto no disponible</strong><p>{error || 'No existe un presupuesto canónico para este expediente.'}</p><button type="button" onClick={() => void load()}>Reintentar</button></section>;

  return <section className={styles.budget}>
    <header className={styles.heading}><div><span>EXP-007</span><h2>Presupuesto</h2><p>Una sola versión operativa vigente, originada en la cotización aceptada.</p></div><div className={styles.headingActions}>{dirty && <span className={styles.dirty} role="status">Cambios sin guardar</span>}{budget.capabilities.can_edit && <button type="button" className={styles.primaryButton} disabled={!dirty || status === 'saving'} onClick={() => void save()}>{status === 'saving' ? <LoaderCircle className={styles.spin} /> : <Save />}Guardar cambios</button>}</div></header>
    {error && <div className={styles.error} role="alert">{error}</div>}{notice && <div className={styles.notice} role="status">{notice}</div>}
    {(budget.requires_classification || budget.totals.requires_review) && <div className={styles.warning} role="status"><strong>Revisión de datos históricos requerida</strong><span>El importe original se conserva. Revisa la clasificación y el IVA de honorarios antes de guardar un presupuesto nuevo o generar un documento.</span></div>}
    <div className={styles.layout}><div className={styles.editor}>
      <article className={styles.group}><header><div><h3>Conceptos del presupuesto</h3><p>Edita únicamente bases reales; el IVA de honorarios se calcula automáticamente al 16%.</p></div><strong>{calculatedTotals ? money(calculatedTotals.total) : 'Calculando…'}</strong></header>
        <div className={styles.concepts}>{concepts.map((item, index) => <div className={styles.conceptRow} key={item.id || `new-${index}`}>
          <label><span>Concepto</span><input value={item.concepto} maxLength={240} disabled={!budget.capabilities.can_edit} onChange={(event) => updateConcept(index, 'concepto', event.target.value)} /></label>
          <label><span>Categoría</span><select value={item.categoria} disabled={!budget.capabilities.can_edit} onChange={(event) => updateConcept(index, 'categoria', event.target.value as BudgetConceptCategory)}>{categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span>Importe MXN</span><input inputMode="decimal" aria-label={`Importe de ${item.concepto || `concepto ${index + 1}`}`} value={item.importe} disabled={!budget.capabilities.can_edit} onChange={(event) => updateConcept(index, 'importe', event.target.value)} /></label>
          {item.categoria === 'OTRO_GASTO' && <div className={styles.taxFields}>
            <label><span>Tratamiento fiscal</span><select value={item.tratamiento_iva || ''} disabled={!budget.capabilities.can_edit} onChange={(event) => updateConcept(index, 'tratamiento_iva', event.target.value as BudgetTaxTreatment)}><option value="">Selecciona…</option><option value="SIN_IMPUESTO">Sin impuesto configurado</option><option value="GRAVADO">Gravado según regla</option><option value="EXENTO">Exento</option><option value="NO_OBJETO">No objeto</option><option value="REQUIERE_REVISION">Requiere revisión</option></select></label>
            {item.tratamiento_iva === 'GRAVADO' && <label><span>Tasa configurada (0–1)</span><input inputMode="decimal" placeholder="0.160000" value={item.iva_tasa || ''} disabled={!budget.capabilities.can_edit} onChange={(event) => updateConcept(index, 'iva_tasa', event.target.value)} /></label>}
            {item.tratamiento_iva && item.tratamiento_iva !== 'REQUIERE_REVISION' && <><label><span>Fuente aprobada</span><input value={item.regla_fiscal_fuente || ''} maxLength={240} disabled={!budget.capabilities.can_edit} onChange={(event) => updateConcept(index, 'regla_fiscal_fuente', event.target.value)} /></label><label><span>Versión de regla</span><input value={item.regla_fiscal_version || ''} maxLength={80} disabled={!budget.capabilities.can_edit} onChange={(event) => updateConcept(index, 'regla_fiscal_version', event.target.value)} /></label></>}
          </div>}
          {budget.capabilities.can_edit && <div className={styles.rowActions}><button type="button" className={styles.iconButton} disabled={index === 0} aria-label={`Subir ${item.concepto || `concepto ${index + 1}`}`} onClick={() => move(index, -1)}><ArrowUp /></button><button type="button" className={styles.iconButton} disabled={index === concepts.length - 1} aria-label={`Bajar ${item.concepto || `concepto ${index + 1}`}`} onClick={() => move(index, 1)}><ArrowDown /></button><button type="button" className={styles.iconButton} aria-label={`Eliminar ${item.concepto || `concepto ${index + 1}`}`} onClick={() => remove(index)}><Trash2 /></button></div>}
        </div>)}{!concepts.length && <p className={styles.empty}>Sin conceptos.</p>}</div>
        {budget.capabilities.can_edit && <button type="button" className={styles.addButton} onClick={() => setConcepts((current) => [...current, emptyConcept(current.length)])}><Plus />Agregar concepto</button>}
      </article>
      {calculationError && <div className={styles.error} role="alert">{calculationError}</div>}
      <dl className={styles.totals} aria-live="polite"><div><dt>Honorarios base</dt><dd>{calculatedTotals ? money(calculatedTotals.honorarios) : '—'}</dd></div><div><dt>IVA de honorarios (automático)</dt><dd>{calculatedTotals ? money(calculatedTotals.iva_honorarios) : '—'}</dd></div><div><dt>Subtotal honorarios</dt><dd>{calculatedTotals ? money(calculatedTotals.subtotal_honorarios) : '—'}</dd></div><div><dt>Impuestos y derechos</dt><dd>{calculatedTotals ? money(calculatedTotals.subtotal_impuestos_derechos) : '—'}</dd></div><div><dt>Otros gastos</dt><dd>{calculatedTotals ? money(calculatedTotals.otros_gastos) : '—'}</dd></div><div><dt>IVA de otros gastos configurados</dt><dd>{calculatedTotals ? money(calculatedTotals.iva_otros_gastos) : '—'}</dd></div><div className={styles.grandTotal}><dt>{calculatedTotals?.requires_review ? 'Total provisional · requiere revisión' : 'Total del presupuesto'}</dt><dd>{calculatedTotals ? money(calculatedTotals.total) : '—'}</dd></div></dl>
    </div><aside className={styles.history}><header><div><h3>Documentos generados</h3><p>Historial inmutable con CFG-002 ADM-001.</p></div><span>{budget.pdf_history.length}</span></header>
      <label className={styles.note}><span>Nota opcional para el próximo documento</span><textarea maxLength={500} rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      {budget.capabilities.can_generate_pdf && <button type="button" className={styles.generateButton} disabled={dirty || status === 'generating' || budget.requires_classification || Boolean(calculatedTotals?.requires_review)} onClick={() => void generate()}>{status === 'generating' ? <LoaderCircle className={styles.spin} /> : <FilePlus2 />}Generar con ADM-001</button>}
      {dirty && <p className={styles.empty}>Guarda los cambios antes de generar.</p>}
      <ul className={styles.pdfList}>{budget.pdf_history.map((item) => <li key={item.id}><div><strong>{item.file_name}</strong><time>{date(item.generated_at)}</time><small>{money(item.total)} · versión {item.budget_version}</small></div><div>{budget.capabilities.can_view_pdf && <button type="button" aria-label={`Ver ${item.file_name}`} onClick={() => void showPreview(item)}><Eye /></button>}{budget.capabilities.can_view_pdf && <button type="button" aria-label={`Descargar ${item.file_name}`} onClick={() => void download(item)}><Download /></button>}{budget.capabilities.can_delete_pdf && <button type="button" aria-label={`Retirar ${item.file_name}`} onClick={() => void removeDocument(item.id)}><Trash2 /></button>}</div></li>)}</ul>
      {!budget.pdf_history.length && <p className={styles.emptyHistory}>Aún no hay documentos generados.</p>}
    </aside></div>
    <DocumentViewer open={Boolean(preview)} name={preview?.item.file_name || 'Presupuesto'} mimeType={preview?.item.mime_type || ''} url={preview?.url} loading={preview?.loading} error={preview?.error} onClose={() => setPreview(null)} onDownload={preview ? () => void download(preview.item) : undefined} />
  </section>;
}
