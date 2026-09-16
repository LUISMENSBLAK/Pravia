import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, FileUp, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { conceptsFromVersion, money, quoteCategoryLabel, quoteSubtotals } from '../quoteFormatters';
import { quotesService } from '../quotes.service';
import type { Quote, QuoteConcept, QuoteConceptCategory, QuoteVersion } from '../quotes.types';
import { QuoteDrawer } from './QuoteDrawer';
import styles from '../Quotes.module.css';

const categories: QuoteConceptCategory[] = ['HONORARIOS', 'IVA_HONORARIOS', 'IMPUESTOS_DERECHOS'];
type EditableConcept = Omit<QuoteConcept, 'categoria'> & { categoria: QuoteConceptCategory | '' };

export function EditQuoteVersionDrawer({ quote, onClose, onCreated }: { quote: Quote; onClose: () => void; onCreated: (version: QuoteVersion) => void }) {
  const latest = quote.versiones[0];
  const initial = conceptsFromVersion(latest);
  const [concepts, setConcepts] = useState<EditableConcept[]>(initial.length ? initial : [{ categoria: 'HONORARIOS', concepto: '', monto: 0 }]);
  const [fee, setFee] = useState(Number(latest?.honorarios_pravia ?? quote.honorarios_pravia ?? 0));
  const [notes, setNotes] = useState(latest?.notas ?? '');
  const [approve, setApprove] = useState(true);
  const [origin, setOrigin] = useState<'MANUAL' | 'IMPORTADO'>('MANUAL');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const total = concepts.reduce((sum, item) => sum + Number(item.monto || 0), 0);
  const subtotals = quoteSubtotals(concepts.filter((item): item is QuoteConcept => Boolean(item.categoria)) as QuoteConcept[]);

  const update = (index: number, field: keyof EditableConcept, value: string) => setConcepts((current) => current.map((item, itemIndex) => itemIndex === index
    ? { ...item, [field]: field === 'monto' ? Number(value) : value } as EditableConcept
    : item));
  const move = (index: number, direction: -1 | 1) => setConcepts((current) => {
    const target = index + direction;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const importFile = async (file?: File) => {
    if (!file) return;
    setImporting(true); setError(''); setImportNotice('');
    try {
      const result = await quotesService.extractBudget(file);
      if (result.error || !result.rubros.length) throw new Error(result.error || 'No se detectaron conceptos identificables.');
      const rows: EditableConcept[] = result.rubros.map((item) => ({
        concepto: item.nombre_original || item.concepto,
        monto: Number(item.monto),
        categoria: categories.includes(item.categoria as QuoteConceptCategory) ? item.categoria as QuoteConceptCategory : '',
      }));
      setConcepts(rows); setOrigin('IMPORTADO');
      setImportNotice(`${rows.length} renglones detectados. Revisa concepto, categoría e importe antes de confirmar.${result.suma_valida ? ' La suma coincide con el total identificado.' : ' La suma requiere revisión manual.'}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos leer el documento.');
    } finally { setImporting(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (concepts.some((item) => !item.categoria || !item.concepto.trim() || item.monto <= 0)) return setError('Revisa todos los conceptos, asigna su categoría y usa importes mayores que cero.');
    if (fee < 0 || fee > total) return setError('La participación PRAVIA no puede superar el total.');
    setSaving(true); setError('');
    try {
      const confirmed = concepts as QuoteConcept[];
      const result = await quotesService.createVersion(quote.id, {
        conceptos: confirmed.map((item) => ({ categoria: item.categoria, concepto: item.concepto, importe: item.monto })),
        desglose_notaria: { rubros: confirmed }, desglose_pravia: { participacion_pravia: fee },
        total_notaria: total, honorarios_pravia: fee, notas: notes || undefined, aprobada: approve, origen: origin,
      });
      onCreated(result.version);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos crear la nueva versión.'); setSaving(false);
    }
  };

  return <QuoteDrawer title={`Nueva versión · v${quote.version_actual + 1}`} subtitle="Captura manual o importa un documento; ambas rutas guardan el mismo presupuesto estructurado." onClose={onClose} footer={<><button type="button" className={styles.secondaryButton} onClick={onClose}>Cancelar</button><button type="submit" form="edit-quote-version" className={styles.primaryButton} disabled={saving || importing}>{saving && <LoaderCircle size={17} className={styles.spin} />}Crear versión</button></>}>
    <form id="edit-quote-version" className={styles.quoteForm} onSubmit={submit}><fieldset><legend>Conceptos</legend>
      <div className={styles.budgetEntryModes}><span>Captura manual</span><label className={styles.importBudgetButton}><FileUp size={17} />{importing ? 'Analizando…' : 'Importar documento'}<input type="file" accept="application/pdf,.pdf" disabled={importing} onChange={(event) => void importFile(event.target.files?.[0])} /></label></div>
      {importNotice && <div className={styles.importNotice} role="status">{importNotice}</div>}
      {error && <div className={styles.formError} role="alert">{error}</div>}
      <div className={styles.conceptHeader}><span>Categoría</span><span>Concepto</span><span>Importe MXN</span><span>Orden</span><span /></div>
      {concepts.map((item, index) => <div className={styles.conceptRow} key={index}>
        <select aria-label={`Categoría concepto ${index + 1}`} value={item.categoria} onChange={(event) => update(index, 'categoria', event.target.value)}><option value="">Revisar categoría…</option>{categories.map((category) => <option key={category} value={category}>{quoteCategoryLabel(category)}</option>)}</select>
        <input aria-label={`Descripción concepto ${index + 1}`} value={item.concepto} onChange={(event) => update(index, 'concepto', event.target.value)} />
        <input aria-label={`Importe concepto ${index + 1}`} type="number" min="0" step=".01" value={item.monto || ''} onChange={(event) => update(index, 'monto', event.target.value)} />
        <span className={styles.conceptOrder}><button type="button" aria-label={`Subir concepto ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button type="button" aria-label={`Bajar concepto ${index + 1}`} disabled={index === concepts.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button></span>
        <button type="button" aria-label={`Eliminar concepto ${index + 1}`} disabled={concepts.length === 1} onClick={() => setConcepts((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={17} /></button>
      </div>)}
      <button type="button" className={styles.addConcept} onClick={() => setConcepts((current) => [...current, { categoria: 'IMPUESTOS_DERECHOS', concepto: '', monto: 0 }])}><Plus size={16} />Agregar concepto</button>
      <div className={styles.totalsBox}><label><span>Participación interna PRAVIA</span><input type="number" min="0" step=".01" value={fee || ''} onChange={(event) => setFee(Number(event.target.value))} /></label><dl>{Object.entries(subtotals).map(([category, subtotal]) => <div key={category}><dt>{quoteCategoryLabel(category as QuoteConceptCategory)}</dt><dd>{money(subtotal)}</dd></div>)}<div><dt>Total cliente</dt><dd>{money(total)}</dd></div></dl></div>
      <label className={styles.textareaLabel}><span>Notas de versión</span><textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      <label className={styles.checkboxLabel}><input type="checkbox" checked={approve} onChange={(event) => setApprove(event.target.checked)} /><span><strong>Marcar como versión vigente</strong><small>La versión aprobada anterior conservará su contenido, pero dejará de ser la vigente.</small></span></label>
    </fieldset></form>
  </QuoteDrawer>;
}
