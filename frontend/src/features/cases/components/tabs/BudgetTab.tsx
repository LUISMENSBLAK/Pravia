import { ChevronDown, Download, Eye, FilePlus2, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../../../services/api/client';
import { expedientesService } from '../../expedientes.service';
import type { BudgetConceptCategory, ExpedienteBudget, ExpedienteBudgetConcept } from '../../expedientes.types';
import styles from './BudgetTab.module.css';

type EditableShare = { amount: string; percent: string; lastMode: 'AMOUNT' | 'PERCENT' };
type DistributionDraft = { honorarios: EditableShare; iva: EditableShare };
const emptyConcept = (order: number): ExpedienteBudgetConcept => ({ concepto: '', categoria: 'HONORARIOS', importe: '0.00', orden: order });
const cents = (value: string) => { const match = String(value || '').trim().match(/^(\d+)(?:\.(\d{0,2}))?$/); return match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : 0; };
const amount = (value: number) => `${Math.floor(Math.max(0, value) / 100)}.${String(Math.max(0, value) % 100).padStart(2, '0')}`;
const percentage = (part: number, total: number) => total ? ((part / total) * 100).toFixed(4) : '0.0000';
const money = (value: string | number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0));
const date = (value: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const categoryOptions: Array<{ value: BudgetConceptCategory; label: string }> = [
  { value: 'HONORARIOS', label: 'Honorarios' }, { value: 'IVA_HONORARIOS', label: 'IVA de honorarios' }, { value: 'IMPUESTOS_DERECHOS', label: 'Impuestos y derechos' },
];

const draftFrom = (budget: ExpedienteBudget): DistributionDraft => ({
  honorarios: { amount: budget.internal_distribution?.pravia.honorarios || '0.00', percent: budget.internal_distribution?.pravia.honorarios_porcentaje || '0.0000', lastMode: 'AMOUNT' },
  iva: { amount: budget.internal_distribution?.pravia.iva || '0.00', percent: budget.internal_distribution?.pravia.iva_porcentaje || '0.0000', lastMode: 'AMOUNT' },
});
const baseline = (concepts: ExpedienteBudgetConcept[], distribution: DistributionDraft) => JSON.stringify({ concepts: concepts.map(({ id: _id, ...item }) => item), distribution });

export function BudgetTab({ expedienteId, onDirtyChange }: { expedienteId: string; onDirtyChange?: (dirty: boolean) => void }) {
  const [budget, setBudget] = useState<ExpedienteBudget | null>(null);
  const [concepts, setConcepts] = useState<ExpedienteBudgetConcept[]>([]);
  const [distribution, setDistribution] = useState<DistributionDraft>({ honorarios: { amount: '0.00', percent: '0.0000', lastMode: 'AMOUNT' }, iva: { amount: '0.00', percent: '0.0000', lastMode: 'AMOUNT' } });
  const [savedBaseline, setSavedBaseline] = useState('');
  const [expanded, setExpanded] = useState(false); const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'generating'>('loading');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [note, setNote] = useState('');

  const hydrate = useCallback((next: ExpedienteBudget) => {
    const nextConcepts = next.concepts.map((item, index) => ({ ...item, orden: index })); const nextDistribution = draftFrom(next);
    setBudget(next); setConcepts(nextConcepts); setDistribution(nextDistribution); setSavedBaseline(baseline(nextConcepts, nextDistribution)); setStatus('ready'); setError('');
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => { setStatus('loading'); try { hydrate(await expedientesService.budget(expedienteId, signal)); } catch (caught) { if (!(caught instanceof DOMException && caught.name === 'AbortError')) { setStatus('ready'); setError(caught instanceof ApiError ? caught.message : 'No pudimos cargar el presupuesto.'); } } }, [expedienteId, hydrate]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const totals = useMemo(() => {
    const honorarios = concepts.filter((item) => item.categoria === 'HONORARIOS').reduce((sum, item) => sum + cents(item.importe), 0);
    const iva = concepts.filter((item) => item.categoria === 'IVA_HONORARIOS').reduce((sum, item) => sum + cents(item.importe), 0);
    const taxes = concepts.filter((item) => item.categoria === 'IMPUESTOS_DERECHOS').reduce((sum, item) => sum + cents(item.importe), 0);
    return { honorarios, iva, honorariosBlock: honorarios + iva, taxes, total: honorarios + iva + taxes };
  }, [concepts]);
  const dirty = Boolean(budget) && baseline(concepts, distribution) !== savedBaseline;
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { const protect = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect); }, [dirty]);

  const updateConcept = (index: number, field: keyof ExpedienteBudgetConcept, value: string) => { setNotice(''); setConcepts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)); };
  const updateShare = (key: 'honorarios' | 'iva', mode: 'AMOUNT' | 'PERCENT', value: string) => {
    const pool = key === 'honorarios' ? totals.honorarios : totals.iva; const numeric = Math.max(0, Number(value || 0));
    const nextAmount = mode === 'AMOUNT' ? value : amount(Math.round(pool * Math.min(100, numeric) / 100));
    const nextPercent = mode === 'PERCENT' ? value : percentage(Math.min(cents(value), pool), pool);
    setDistribution((current) => ({ ...current, [key]: { amount: nextAmount, percent: nextPercent, lastMode: mode } })); setNotice('');
  };
  const praviaHonorarios = Math.min(cents(distribution.honorarios.amount), totals.honorarios); const praviaIva = Math.min(cents(distribution.iva.amount), totals.iva);

  const save = async () => {
    if (!budget || !budget.capabilities.can_edit) return; setStatus('saving'); setError(''); setNotice('');
    try {
      hydrate(await expedientesService.saveBudget(expedienteId, {
        expected_version: budget.version, concepts: concepts.map((item, index) => ({ ...item, orden: index })),
        ...(budget.capabilities.can_edit_internal_distribution ? { distribution: {
          pravia_honorarios: { mode: distribution.honorarios.lastMode, value: distribution.honorarios.lastMode === 'AMOUNT' ? distribution.honorarios.amount : distribution.honorarios.percent },
          pravia_iva: { mode: distribution.iva.lastMode, value: distribution.iva.lastMode === 'AMOUNT' ? distribution.iva.amount : distribution.iva.percent },
        } } : {}),
      })); setNotice('Presupuesto guardado.');
    } catch (caught) { setStatus('ready'); setError(caught instanceof ApiError && caught.status === 409 ? 'El presupuesto cambió en otra sesión. Tus cambios siguen aquí; recarga antes de decidir cómo continuar.' : caught instanceof ApiError ? caught.message : 'No pudimos guardar. Tus cambios permanecen en pantalla.'); }
  };
  const generate = async () => {
    if (!budget || dirty) return; setStatus('generating'); setError(''); setNotice('');
    try { await expedientesService.generateBudgetPdf(expedienteId, { expected_version: budget.version, idempotency_key: crypto.randomUUID(), note: note.trim() || undefined }); setNote(''); const next = await expedientesService.budget(expedienteId); hydrate(next); setNotice('Presupuesto PDF generado y agregado al historial.'); }
    catch (caught) { setStatus('ready'); setError(caught instanceof ApiError ? caught.message : 'No pudimos generar el PDF. No se registró ningún documento incompleto.'); }
  };
  const openPdf = async (id: string, download: boolean) => { setError(''); try { const result = await expedientesService.budgetPdfUrl(expedienteId, id); const link = document.createElement('a'); link.href = result.url; if (download) link.download = result.file_name; else { link.target = '_blank'; link.rel = 'noopener noreferrer'; } link.click(); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'No pudimos abrir el documento.'); } };
  const removePdf = async (id: string) => { if (!window.confirm('¿Retirar este PDF histórico? El archivo permanecerá preservado para auditoría.')) return; try { await expedientesService.deleteBudgetPdf(expedienteId, id); hydrate(await expedientesService.budget(expedienteId)); setNotice('PDF histórico retirado.'); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'No pudimos retirar el documento.'); } };

  if (status === 'loading') return <section className={styles.state} role="status"><LoaderCircle className={styles.spin} />Cargando presupuesto…</section>;
  if (!budget) return <section className={styles.state} role="alert"><strong>Presupuesto no disponible</strong><p>{error || 'No existe un presupuesto canónico para este expediente.'}</p><button type="button" onClick={() => void load()}>Reintentar</button></section>;
  const honoraria = concepts.map((item, index) => ({ item, index })).filter(({ item }) => item.categoria !== 'IMPUESTOS_DERECHOS');
  const taxes = concepts.map((item, index) => ({ item, index })).filter(({ item }) => item.categoria === 'IMPUESTOS_DERECHOS');
  const conceptRows = (items: Array<{ item: ExpedienteBudgetConcept; index: number }>) => items.map(({ item, index }) => <div className={styles.conceptRow} key={item.id || `new-${index}`}>
    <label><span>Concepto</span><input value={item.concepto} maxLength={240} disabled={!budget.capabilities.can_edit} onChange={(event) => updateConcept(index, 'concepto', event.target.value)} /></label>
    <label><span>Categoría</span><select value={item.categoria} disabled={!budget.capabilities.can_edit} onChange={(event) => updateConcept(index, 'categoria', event.target.value)}>{categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    <label><span>Importe MXN</span><input inputMode="decimal" aria-label={`Importe de ${item.concepto || `concepto ${index + 1}`}`} value={item.importe} disabled={!budget.capabilities.can_edit} onChange={(event) => updateConcept(index, 'importe', event.target.value)} /></label>
    {budget.capabilities.can_edit && <button type="button" className={styles.iconButton} aria-label={`Eliminar ${item.concepto || `concepto ${index + 1}`}`} onClick={() => setConcepts((current) => current.filter((_, itemIndex) => itemIndex !== index).map((entry, order) => ({ ...entry, orden: order })))}><Trash2 size={17} /></button>}
  </div>);

  return <section className={styles.budget}>
    <header className={styles.heading}><div><span>EXP-007</span><h2>Presupuesto</h2><p>Una sola versión operativa vigente, originada en la cotización aceptada.</p></div><div className={styles.headingActions}>{dirty && <span className={styles.dirty} role="status">Cambios sin guardar</span>}{budget.capabilities.can_edit && <button type="button" className={styles.primaryButton} disabled={!dirty || status === 'saving'} onClick={() => void save()}>{status === 'saving' ? <LoaderCircle className={styles.spin} /> : <Save />}Guardar cambios</button>}</div></header>
    {error && <div className={styles.error} role="alert">{error}</div>}{notice && <div className={styles.notice} role="status">{notice}</div>}
    {budget.requires_classification && <div className={styles.warning} role="status"><strong>Revisión de datos históricos requerida</strong><span>El origen se preservó sin inventar categorías. Clasifica los conceptos antes de generar un nuevo PDF.</span></div>}
    <div className={styles.layout}><div className={styles.editor}>
      <article className={styles.group}><header><div><h3>Honorarios</h3><p>Incluye el IVA asociado a honorarios.</p></div><strong>{money(amount(totals.honorariosBlock))}</strong></header><div className={styles.concepts}>{conceptRows(honoraria)}{!honoraria.length && <p className={styles.empty}>Sin conceptos de honorarios.</p>}</div>{budget.capabilities.can_edit && <button type="button" className={styles.addButton} onClick={() => setConcepts((current) => [...current, emptyConcept(current.length)])}><Plus />Agregar concepto</button>}</article>
      <article className={styles.group}><header><div><h3>Impuestos y derechos</h3><p>Importes operativos; no ejecutan cálculos fiscales.</p></div><strong>{money(amount(totals.taxes))}</strong></header><div className={styles.concepts}>{conceptRows(taxes)}{!taxes.length && <p className={styles.empty}>Sin impuestos o derechos.</p>}</div>{budget.capabilities.can_edit && <button type="button" className={styles.addButton} onClick={() => setConcepts((current) => [...current, { ...emptyConcept(current.length), categoria: 'IMPUESTOS_DERECHOS' }])}><Plus />Agregar concepto</button>}</article>
      <dl className={styles.totals}><div><dt>Subtotal Honorarios</dt><dd>{money(amount(totals.honorariosBlock))}</dd></div><div><dt>Subtotal Impuestos y derechos</dt><dd>{money(amount(totals.taxes))}</dd></div><div className={styles.grandTotal}><dt>Total del presupuesto</dt><dd>{money(amount(totals.total))}</dd></div></dl>
      {budget.capabilities.can_view_internal_distribution && <article className={styles.distribution}><button type="button" aria-expanded={expanded} aria-controls="exp007-distribution-panel" onClick={() => setExpanded((current) => !current)}><span><strong>Distribución interna</strong><small>PRAVIA / Notaría · no se incluye en el PDF del cliente</small></span><ChevronDown data-open={expanded} /></button>{expanded && <div id="exp007-distribution-panel" className={styles.distributionPanel}>
        {budget.distribution_requires_review && <p className={styles.reviewNote}>La distribución histórica requiere confirmación; no se infirió un desglose ambiguo.</p>}
        <div className={styles.distributionHead}><span /><span>Honorarios</span><span>IVA</span><span>Total</span></div>
        <div className={styles.distributionRow}><strong>PRAVIA</strong><ShareInputs label="Honorarios PRAVIA" value={distribution.honorarios} disabled={!budget.capabilities.can_edit_internal_distribution} onChange={(mode, value) => updateShare('honorarios', mode, value)} /><ShareInputs label="IVA PRAVIA" value={distribution.iva} disabled={!budget.capabilities.can_edit_internal_distribution} onChange={(mode, value) => updateShare('iva', mode, value)} /><b>{money(amount(praviaHonorarios + praviaIva))}</b></div>
        <div className={styles.distributionRow}><strong>Notaría</strong><ReadShare amount={totals.honorarios - praviaHonorarios} total={totals.honorarios} /><ReadShare amount={totals.iva - praviaIva} total={totals.iva} /><b>{money(amount((totals.honorarios - praviaHonorarios) + (totals.iva - praviaIva)))}</b></div>
        <p className={styles.closure} data-closed={praviaHonorarios <= totals.honorarios && praviaIva <= totals.iva}>Honorarios e IVA cierran exactamente contra sus importes distribuibles.</p>
      </div>}</article>}
    </div><aside className={styles.history}><header><div><h3>Presupuestos generados</h3><p>PDFs históricos inmutables.</p></div><span>{budget.pdf_history.length}</span></header>
      <label className={styles.note}><span>Nota opcional para el próximo PDF</span><textarea maxLength={500} rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Máximo 500 caracteres" /></label>
      {budget.capabilities.can_generate_pdf && <button type="button" className={styles.generateButton} disabled={dirty || status === 'generating' || budget.requires_classification} title={dirty ? 'Guarda los cambios antes de generar' : undefined} onClick={() => void generate()}>{status === 'generating' ? <LoaderCircle className={styles.spin} /> : <FilePlus2 />}Generar presupuesto</button>}
      <ol className={styles.pdfList}>{budget.pdf_history.map((item) => <li key={item.id}><div><strong>{money(item.total)}</strong><time dateTime={item.generated_at}>{date(item.generated_at)}</time><small>{item.file_name}</small></div><div>{budget.capabilities.can_view_pdf && <><button type="button" aria-label={`Ver presupuesto de ${date(item.generated_at)}`} onClick={() => void openPdf(item.id, false)}><Eye /></button><button type="button" aria-label={`Descargar presupuesto de ${date(item.generated_at)}`} onClick={() => void openPdf(item.id, true)}><Download /></button></>}{budget.capabilities.can_delete_pdf && <button type="button" aria-label={`Eliminar presupuesto de ${date(item.generated_at)}`} onClick={() => void removePdf(item.id)}><Trash2 /></button>}</div></li>)}</ol>
      {!budget.pdf_history.length && <p className={styles.emptyHistory}>Aún no se han generado PDFs para este presupuesto.</p>}
    </aside></div>
  </section>;
}

function ShareInputs({ label, value, disabled, onChange }: { label: string; value: EditableShare; disabled: boolean; onChange: (mode: 'AMOUNT' | 'PERCENT', value: string) => void }) {
  return <div className={styles.shareInputs}><label><span>{label} en MXN</span><input inputMode="decimal" value={value.amount} disabled={disabled} onChange={(event) => onChange('AMOUNT', event.target.value)} /></label><label><span>{label} en porcentaje</span><span className={styles.percentInput}><input inputMode="decimal" value={value.percent} disabled={disabled} onChange={(event) => onChange('PERCENT', event.target.value)} /><i>%</i></span></label></div>;
}
function ReadShare({ amount: value, total }: { amount: number; total: number }) { return <div className={styles.readShare}><strong>{money(amount(value))}</strong><span>{percentage(value, total)}%</span></div>; }
