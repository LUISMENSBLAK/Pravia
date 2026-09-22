import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, FileUp, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
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
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [importNotice, setImportNotice] = useState('');

  useEffect(() => {
    const next = fromQuote(quote);
    setRows(next); setBaseline(fingerprint(next)); setOrigin('MANUAL'); setError('');
  }, [quote.id, quote.updated_at, quote.presupuesto]);

  const dirty = fingerprint(rows) !== baseline;
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
  const discard = () => { const next = fromQuote(quote); setRows(next); setBaseline(fingerprint(next)); setOrigin('MANUAL'); setError(''); setImportNotice(''); };
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
        origin, expectedUpdatedAt: quote.updated_at,
      });
      notify('Cambios guardados. El estado comercial no cambió.');
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos guardar el presupuesto.'); }
    finally { setSaving(false); }
  };

  return <section className={`${styles.detailSection} ${styles.inlineBudget}`}>
    <header><div><h2>Presupuesto de la cotización</h2><p>Edición directa del presupuesto vigente. Los documentos generados se conservan como evidencia histórica.</p></div>
      {canWrite && <label className={styles.importBudgetButton}><FileUp size={17} />{importing ? 'Analizando…' : 'Importar documento'}<input type="file" accept="application/pdf,.pdf" disabled={importing || saving} onChange={(event) => void importFile(event.target.files?.[0])} /></label>}
    </header>
    {importNotice && <div className={styles.importNotice} role="status">{importNotice}</div>}
    {error && <div className={styles.formError} role="alert">{error}</div>}
    <form onSubmit={submit}>
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
