import { ArrowDown, ArrowUp, Download, Eye, FilePlus2, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DocumentViewer } from '../../../../components/documents/DocumentViewer';
import { ApiError } from '../../../../services/api/client';
import { expedientesService } from '../../expedientes.service';
import type { BudgetConceptCategory, ExpedienteBudget, ExpedienteBudgetConcept, ExpedienteBudgetPdf } from '../../expedientes.types';
import styles from './BudgetTab.module.css';

const emptyConcept = (order: number): ExpedienteBudgetConcept => ({ concepto: '', categoria: 'HONORARIOS', importe: '0.00', orden: order });
const cents = (value: string) => { const match = String(value || '').trim().match(/^(\d+)(?:\.(\d{0,2}))?$/); return match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : 0; };
const amount = (value: number) => `${Math.floor(Math.max(0, value) / 100)}.${String(Math.max(0, value) % 100).padStart(2, '0')}`;
const money = (value: string | number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0));
const date = (value: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const categoryOptions: Array<{ value: BudgetConceptCategory; label: string }> = [
  { value: 'HONORARIOS', label: 'Honorarios' },
  { value: 'IVA_HONORARIOS', label: 'IVA de honorarios' },
  { value: 'IMPUESTOS_DERECHOS', label: 'Impuestos y derechos' },
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

  const hydrate = useCallback((next: ExpedienteBudget) => {
    const nextConcepts = next.concepts.map((item, index) => ({ ...item, orden: index }));
    setBudget(next); setConcepts(nextConcepts); setSavedBaseline(baseline(nextConcepts)); setStatus('ready'); setError('');
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

  const totals = useMemo(() => {
    const honorarios = concepts.filter((item) => item.categoria === 'HONORARIOS').reduce((sum, item) => sum + cents(item.importe), 0);
    const iva = concepts.filter((item) => item.categoria === 'IVA_HONORARIOS').reduce((sum, item) => sum + cents(item.importe), 0);
    const taxes = concepts.filter((item) => item.categoria === 'IMPUESTOS_DERECHOS').reduce((sum, item) => sum + cents(item.importe), 0);
    return { honorarios, iva, taxes, total: honorarios + iva + taxes };
  }, [concepts]);
  const dirty = Boolean(budget) && baseline(concepts) !== savedBaseline;
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { const protect = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect); }, [dirty]);

  const updateConcept = (index: number, field: keyof ExpedienteBudgetConcept, value: string | BudgetConceptCategory) => {
    setNotice(''); setConcepts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
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
      hydrate(await expedientesService.saveBudget(expedienteId, { expected_version: budget.version, concepts: concepts.map((item, orden) => ({ ...item, orden })) }));
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
    {budget.requires_classification && <div className={styles.warning} role="status"><strong>Revisión de datos históricos requerida</strong><span>El origen se preservó sin inventar categorías. Clasifica los conceptos antes de generar un documento.</span></div>}
    <div className={styles.layout}><div className={styles.editor}>
      <article className={styles.group}><header><div><h3>Conceptos del presupuesto</h3><p>Edita conceptos, categoría e importe en una sola lista ordenable.</p></div><strong>{money(amount(totals.total))}</strong></header>
        <div className={styles.concepts}>{concepts.map((item, index) => <div className={styles.conceptRow} key={item.id || `new-${index}`}>
          <label><span>Concepto</span><input value={item.concepto} maxLength={240} disabled={!budget.capabilities.can_edit} onChange={(event) => updateConcept(index, 'concepto', event.target.value)} /></label>
          <label><span>Categoría</span><select value={item.categoria} disabled={!budget.capabilities.can_edit} onChange={(event) => updateConcept(index, 'categoria', event.target.value as BudgetConceptCategory)}>{categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span>Importe MXN</span><input inputMode="decimal" aria-label={`Importe de ${item.concepto || `concepto ${index + 1}`}`} value={item.importe} disabled={!budget.capabilities.can_edit} onChange={(event) => updateConcept(index, 'importe', event.target.value)} /></label>
          {budget.capabilities.can_edit && <div className={styles.rowActions}><button type="button" className={styles.iconButton} disabled={index === 0} aria-label={`Subir ${item.concepto || `concepto ${index + 1}`}`} onClick={() => move(index, -1)}><ArrowUp /></button><button type="button" className={styles.iconButton} disabled={index === concepts.length - 1} aria-label={`Bajar ${item.concepto || `concepto ${index + 1}`}`} onClick={() => move(index, 1)}><ArrowDown /></button><button type="button" className={styles.iconButton} aria-label={`Eliminar ${item.concepto || `concepto ${index + 1}`}`} onClick={() => remove(index)}><Trash2 /></button></div>}
        </div>)}{!concepts.length && <p className={styles.empty}>Sin conceptos.</p>}</div>
        {budget.capabilities.can_edit && <button type="button" className={styles.addButton} onClick={() => setConcepts((current) => [...current, emptyConcept(current.length)])}><Plus />Agregar concepto</button>}
      </article>
      <dl className={styles.totals}><div><dt>Honorarios</dt><dd>{money(amount(totals.honorarios))}</dd></div><div><dt>IVA de honorarios</dt><dd>{money(amount(totals.iva))}</dd></div><div><dt>Impuestos y derechos</dt><dd>{money(amount(totals.taxes))}</dd></div><div className={styles.grandTotal}><dt>Total del presupuesto</dt><dd>{money(amount(totals.total))}</dd></div></dl>
    </div><aside className={styles.history}><header><div><h3>Documentos generados</h3><p>Historial inmutable con CFG-002 ADM-001.</p></div><span>{budget.pdf_history.length}</span></header>
      <label className={styles.note}><span>Nota opcional para el próximo documento</span><textarea maxLength={500} rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      {budget.capabilities.can_generate_pdf && <button type="button" className={styles.generateButton} disabled={dirty || status === 'generating' || budget.requires_classification} onClick={() => void generate()}>{status === 'generating' ? <LoaderCircle className={styles.spin} /> : <FilePlus2 />}Generar con ADM-001</button>}
      {dirty && <p className={styles.empty}>Guarda los cambios antes de generar.</p>}
      <ul className={styles.pdfList}>{budget.pdf_history.map((item) => <li key={item.id}><div><strong>{item.file_name}</strong><time>{date(item.generated_at)}</time><small>{money(item.total)} · versión {item.budget_version}</small></div><div>{budget.capabilities.can_view_pdf && <button type="button" aria-label={`Ver ${item.file_name}`} onClick={() => void showPreview(item)}><Eye /></button>}{budget.capabilities.can_view_pdf && <button type="button" aria-label={`Descargar ${item.file_name}`} onClick={() => void download(item)}><Download /></button>}{budget.capabilities.can_delete_pdf && <button type="button" aria-label={`Retirar ${item.file_name}`} onClick={() => void removeDocument(item.id)}><Trash2 /></button>}</div></li>)}</ul>
      {!budget.pdf_history.length && <p className={styles.emptyHistory}>Aún no hay documentos generados.</p>}
    </aside></div>
    <DocumentViewer open={Boolean(preview)} name={preview?.item.file_name || 'Presupuesto'} mimeType={preview?.item.mime_type || ''} url={preview?.url} loading={preview?.loading} error={preview?.error} onClose={() => setPreview(null)} onDownload={preview ? () => void download(preview.item) : undefined} />
  </section>;
}
