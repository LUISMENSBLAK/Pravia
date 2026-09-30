import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, CircleHelp, FileUp, LoaderCircle, Plus, Save, Sparkles, Trash2, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { AIProcessingStatus } from '../../../components/feedback/AIProcessingStatus';
import { money, quoteCategoryLabel, quoteSubtotals } from '../quoteFormatters';
import { quotesService } from '../quotes.service';
import type { Quote, QuoteConcept, QuoteConceptCategory } from '../quotes.types';
import styles from '../Quotes.module.css';

const categories: QuoteConceptCategory[] = ['HONORARIOS', 'IVA_HONORARIOS', 'IMPUESTOS_DERECHOS'];
type Row = { categoria: QuoteConceptCategory | ''; concepto: string; importe: string };
const emptyRow = (): Row => ({ categoria: 'HONORARIOS', concepto: '', importe: '' });
const fromQuote = (quote: Quote): Row[] => quote.presupuesto?.concepts?.length
  ? quote.presupuesto.concepts.map((row) => ({ categoria: row.categoria, concepto: row.concepto, importe: String(row.importe) }))
  : [emptyRow()];
const fingerprint = (rows: Row[]) => JSON.stringify(rows.map((row) => ({ ...row, concepto: row.concepto.trim(), importe: Number(row.importe || 0).toFixed(2) })));

export function QuoteConcepts({ quote, canWrite, onSaved, notify }: {
  quote: Quote;
  canWrite: boolean;
  onSaved: () => Promise<void> | void;
  notify: (message: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => fromQuote(quote));
  const [baseline, setBaseline] = useState(() => fingerprint(fromQuote(quote)));
  const [origin, setOrigin] = useState<'MANUAL' | 'IMPORTADO'>('MANUAL');
  const [operationContext, setOperationContext] = useState(quote.contexto_operacion ?? '');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [aiBusy, setAiBusy] = useState('');
  const { user } = useAuth();
  const proposal = quote.propuestasIA?.[0];
  const evidenceLayers = proposal?.evidence_packet.layers;
  const canUseAI = canWrite && Boolean(user?.permissions?.includes('ai.use'));

  useEffect(() => {
    const next = fromQuote(quote);
    setRows(next); setBaseline(fingerprint(next)); setOperationContext(quote.contexto_operacion ?? ''); setOrigin('MANUAL'); setError('');
  }, [quote.id, quote.updated_at, quote.presupuesto]);

  const dirty = fingerprint(rows) !== baseline || operationContext.trim() !== (quote.contexto_operacion ?? '').trim();
  const concepts = useMemo(() => rows.filter((row): row is Row & { categoria: QuoteConceptCategory } => Boolean(row.categoria)).map((row) => ({
    categoria: row.categoria, concepto: row.concepto, monto: Number(row.importe || 0),
  } satisfies QuoteConcept)), [rows]);
  const subtotals = quoteSubtotals(concepts);
  const total = concepts.reduce((sum, row) => sum + row.monto, 0);

  const update = (index: number, field: keyof Row, value: string) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  const move = (index: number, direction: -1 | 1) => setRows((current) => {
    const target = index + direction;
    if (target < 0 || target >= current.length) return current;
    const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next;
  });
  const discard = () => { const next = fromQuote(quote); setRows(next); setBaseline(fingerprint(next)); setOperationContext(quote.contexto_operacion ?? ''); setOrigin('MANUAL'); setError(''); setImportNotice(''); };
  const importFile = async (file?: File) => {
    if (!file) return;
    setImporting(true); setError(''); setImportNotice('');
    try {
      const result = await quotesService.extractBudget(file);
      if (result.error || !result.rubros.length) throw new Error(result.error || 'No se detectaron conceptos identificables.');
      setRows(result.rubros.map((item) => ({
        concepto: item.nombre_original || item.concepto,
        importe: String(Number(item.monto)),
        categoria: categories.includes(item.categoria as QuoteConceptCategory) ? item.categoria as QuoteConceptCategory : '',
      })));
      setOrigin('IMPORTADO');
      setImportNotice(`${result.rubros.length} renglones detectados. Revisa categoría, concepto e importe antes de guardar.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos leer el documento.'); }
    finally { setImporting(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (rows.some((row) => !row.categoria || !row.concepto.trim() || !Number.isFinite(Number(row.importe)) || Number(row.importe) <= 0)) {
      setError('Completa categoría, concepto e importe mayor que cero en cada renglón.'); return;
    }
    setSaving(true); setError('');
    try {
      await quotesService.updateBudget(quote.id, {
        concepts: rows.map((row) => ({ categoria: row.categoria as QuoteConceptCategory, concepto: row.concepto.trim(), importe: Number(row.importe) })),
        origin, operationContext: operationContext.trim(), expectedUpdatedAt: quote.updated_at,
      });
      notify('Cambios guardados. El estado comercial no cambió.');
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos guardar el presupuesto.'); }
    finally { setSaving(false); }
  };
  const generateAI = async () => {
    setAiBusy('generate'); setError('');
    try { await quotesService.generateAIProposal(quote.id); await onSaved(); notify('Propuesta preparada. Revisa cada concepto antes de aplicarla.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible generar la propuesta.'); }
    finally { setAiBusy(''); }
  };
  const decideAI = async (action: 'APLICAR' | 'DESCARTAR') => {
    if (!proposal) return;
    setAiBusy(action); setError('');
    try { await quotesService.decideAIProposal(quote.id, proposal.id, action); await onSaved(); notify(action === 'APLICAR' ? 'Propuesta aplicada como presupuesto editable.' : 'Propuesta descartada sin cambiar el presupuesto.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible registrar la decisión.'); }
    finally { setAiBusy(''); }
  };

  return <section className={`${styles.detailSection} ${styles.inlineBudget}`}>
    <header><div><h2>Presupuesto de la cotización</h2><p>Edición directa del presupuesto vigente. Los documentos generados se conservan como evidencia histórica.</p></div>
      <div className={styles.inlineBudgetHeaderActions}>{canUseAI && <button type="button" className={styles.aiProposalButton} disabled={Boolean(aiBusy) || saving} onClick={() => void generateAI()}>{aiBusy === 'generate' ? <LoaderCircle className={styles.spin} size={17} /> : <Sparkles size={17} />}Generar cotización con IA</button>}{canWrite && <label className={styles.importBudgetButton}><FileUp size={17} />{importing ? 'Analizando…' : 'Cargar ejemplo'}<input type="file" accept="application/pdf,.pdf" disabled={importing || saving} onChange={(event) => void importFile(event.target.files?.[0])} /></label>}</div>
    </header>
    {(importing || aiBusy === 'generate') && <AIProcessingStatus label={importing ? 'Extrayendo conceptos del documento' : 'Preparando cotización con IA'} detail={importing ? 'PRAVIA está leyendo el archivo. Los conceptos quedarán como borrador editable antes de guardar.' : 'Contrastando fuentes y capas de evidencia de esta organización; nada se aplicará automáticamente.'}/>}
    {proposal && <section className={styles.aiProposalPanel} aria-label="Propuesta de cotización con IA"><header><div><span><Sparkles size={17} />Propuesta pendiente</span><p>La propuesta todavía no modifica la cotización. Los importes provienen de capas trazables de la misma organización.</p></div></header><div className={styles.aiProposalRows}>{proposal.proposal.concepts.map((item, index) => <article key={`${item.categoria}-${item.concepto}-${index}`}><div><small>{quoteCategoryLabel(item.categoria)}</small><strong>{item.concepto}</strong></div><b>{money(item.importe)}</b><details><summary aria-label={`Fundamento de ${item.concepto}`}><CircleHelp size={16} />Fundamento</summary><p>{item.explanation?.reason || 'Propuesta asistida sujeta a revisión humana.'}</p>{item.explanation?.sample_size != null && <small>Muestra validada: {item.explanation.sample_size} cotización(es).</small>}</details></article>)}</div>
      {evidenceLayers && <section className={styles.aiEvidenceLayers} aria-label="Capas de fundamento de la propuesta"><h3>Capas de fundamento</h3><div>
        <article><strong>Arancel / fuente oficial</strong>{evidenceLayers.tariff?.length ? <ul>{evidenceLayers.tariff.map((item) => <li key={item.code}><span>{item.code}</span>{item.title}{item.official_url && <a href={item.official_url} target="_blank" rel="noreferrer">Consultar fuente</a>}</li>)}</ul> : <p>Sin fuente arancelaria aplicable.</p>}</article>
        <article><strong>Criterio interno</strong><em>CRITERIO INTERNO — NO ES NORMA.</em>{evidenceLayers.internal_policy?.length ? <ul>{evidenceLayers.internal_policy.map((item) => <li key={item.code}><span>{item.code}</span>{item.title}</li>)}</ul> : <p>Sin criterio interno aplicable.</p>}</article>
        <article><strong>Histórico validado</strong><p>{evidenceLayers.validated_comparables?.sample_quotes ? `${evidenceLayers.validated_comparables.sample_quotes} cotización(es) comparables para ${evidenceLayers.validated_comparables.act}.` : 'Sin cotizaciones comparables validadas.'}</p></article>
      </div></section>}
      <p className={styles.aiProposalNotice}>{proposal.evidence_packet.taxes_notice}</p><footer><button type="button" className={styles.secondaryButton} disabled={Boolean(aiBusy)} onClick={() => void decideAI('DESCARTAR')}>{aiBusy === 'DESCARTAR' ? <LoaderCircle className={styles.spin} size={17} /> : <X size={17} />}Descartar</button><button type="button" className={styles.primaryButton} disabled={Boolean(aiBusy)} onClick={() => void decideAI('APLICAR')}>{aiBusy === 'APLICAR' ? <LoaderCircle className={styles.spin} size={17} /> : <Sparkles size={17} />}Aplicar propuesta</button></footer></section>}
    {importNotice && <div className={styles.importNotice} role="status">{importNotice}</div>}
    {error && <div className={styles.formError} role="alert">{error}</div>}
    <form onSubmit={submit}>
      <label className={styles.operationContextField}><span>Contexto de la operación</span><textarea rows={3} value={operationContext} disabled={!canWrite || saving} onChange={(event) => setOperationContext(event.target.value)} placeholder="Describe los datos que deben considerarse en esta cotización." maxLength={4000} /><small>Este mismo contexto alimenta la captura manual, el ejemplo cargado y la propuesta con IA.</small></label>
      <div className={styles.inlineConceptHeader} aria-hidden="true"><span>Categoría</span><span>Concepto</span><span>Importe MXN</span><span>Orden</span><span /></div>
      <div className={styles.inlineConceptRows}>
        {rows.map((row, index) => <div className={styles.inlineConceptRow} key={index}>
          <label><span>Categoría</span><select aria-label={`Categoría concepto ${index + 1}`} value={row.categoria} disabled={!canWrite || saving} onChange={(event) => update(index, 'categoria', event.target.value)}><option value="">Selecciona…</option>{categories.map((category) => <option key={category} value={category}>{quoteCategoryLabel(category)}</option>)}</select></label>
          <label><span>Concepto</span><input aria-label={`Concepto ${index + 1}`} value={row.concepto} disabled={!canWrite || saving} onChange={(event) => update(index, 'concepto', event.target.value)} /></label>
          <label><span>Importe MXN</span><input aria-label={`Importe concepto ${index + 1}`} type="number" min="0.01" step="0.01" value={row.importe} disabled={!canWrite || saving} onChange={(event) => update(index, 'importe', event.target.value)} /></label>
          <span className={styles.conceptOrder}><button type="button" aria-label={`Subir concepto ${index + 1}`} disabled={!canWrite || saving || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button><button type="button" aria-label={`Bajar concepto ${index + 1}`} disabled={!canWrite || saving || index === rows.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button></span>
          <button type="button" className={styles.iconDangerButton} aria-label={`Eliminar concepto ${index + 1}`} disabled={!canWrite || saving || rows.length === 1} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={17} /></button>
        </div>)}
      </div>
      {canWrite && <button type="button" className={styles.addConcept} disabled={saving} onClick={() => setRows((current) => [...current, emptyRow()])}><Plus size={16} />Agregar concepto</button>}
      <div className={styles.inlineBudgetTotals}><dl>{Object.entries(subtotals).map(([category, subtotal]) => <div key={category}><dt>{quoteCategoryLabel(category as QuoteConceptCategory)}</dt><dd>{money(subtotal)}</dd></div>)}<div className={styles.inlineBudgetGrandTotal}><dt>Total cliente</dt><dd>{money(total)}</dd></div></dl></div>
      {canWrite && <footer className={styles.inlineBudgetActions}><span>{dirty ? 'Hay cambios sin guardar.' : 'Presupuesto guardado.'}</span><div><button type="button" className={styles.secondaryButton} disabled={!dirty || saving} onClick={discard}>Descartar</button><button type="submit" className={styles.primaryButton} disabled={!dirty || saving || importing}>{saving ? <LoaderCircle className={styles.spin} size={17} /> : <Save size={17} />}Guardar cambios</button></div></footer>}
    </form>
  </section>;
}
