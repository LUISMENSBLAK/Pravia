import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, CircleHelp, FileUp, LoaderCircle, Plus, Save, Sparkles, Trash2, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { AIProcessingStatus } from '../../../components/feedback/AIProcessingStatus';
import { money, quoteCategoryLabel } from '../quoteFormatters';
import { quotesService } from '../quotes.service';
import type { Quote, QuoteBudget, QuoteConceptCategory } from '../quotes.types';
import styles from '../Quotes.module.css';

const categories: QuoteConceptCategory[] = ['HONORARIOS', 'IMPUESTOS_DERECHOS', 'OTRO_GASTO'];
type Row = { categoria: QuoteConceptCategory | ''; concepto: string; importe: string;
  tratamiento_iva: 'SIN_IMPUESTO' | 'GRAVADO' | 'EXENTO' | 'NO_OBJETO' | 'REQUIERE_REVISION' | '';
  iva_tasa: string; regla_fiscal_fuente: string; regla_fiscal_version: string };
const emptyRow = (): Row => ({ categoria: 'HONORARIOS', concepto: '', importe: '', tratamiento_iva: '', iva_tasa: '', regla_fiscal_fuente: '', regla_fiscal_version: '' });
const fromQuote = (quote: Quote): Row[] => quote.presupuesto?.concepts?.length
  ? quote.presupuesto.concepts.filter((row) => row.categoria !== 'IVA_HONORARIOS').map((row) => ({ categoria: row.categoria, concepto: row.concepto, importe: String(row.importe),
    tratamiento_iva: row.tratamiento_iva ?? '', iva_tasa: row.iva_tasa ?? '', regla_fiscal_fuente: row.regla_fiscal_fuente ?? '', regla_fiscal_version: row.regla_fiscal_version ?? '' }))
  : [emptyRow()];
const fingerprint = (rows: Row[]) => JSON.stringify(rows.map((row) => ({ ...row, concepto: row.concepto.trim(), importe: row.importe.trim() })));

export function QuoteConcepts({ quote, canWrite: canWriteInput, onSaved, notify }: {
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
  const [preview, setPreview] = useState<QuoteBudget['totals'] | null>(null);
  const [previewError, setPreviewError] = useState('');
  const canWrite = canWriteInput && !['ACEPTADA', 'ACEPTO_ANTICIPO', 'CONVERTIDA_EXPEDIENTE'].includes(String(quote.workflow?.stage ?? quote.estado));
  const { user } = useAuth();
  const proposal = quote.propuestasIA?.[0];
  const evidenceLayers = proposal?.evidence_packet.layers;
  const canUseAI = canWrite && Boolean(user?.permissions?.includes('ai.use'));

  useEffect(() => {
    const next = fromQuote(quote);
    setRows(next); setBaseline(fingerprint(next)); setOperationContext(quote.contexto_operacion ?? ''); setOrigin('MANUAL'); setError('');
  }, [quote.id, quote.updated_at, quote.presupuesto]);

  const dirty = fingerprint(rows) !== baseline || operationContext.trim() !== (quote.contexto_operacion ?? '').trim();
  const concepts = useMemo(() => rows.map((row) => ({ categoria: row.categoria as QuoteConceptCategory, concepto: row.concepto.trim(), importe: row.importe,
    tratamiento_iva: row.categoria === 'OTRO_GASTO' ? row.tratamiento_iva || 'REQUIERE_REVISION' : null,
    iva_tasa: row.categoria === 'OTRO_GASTO' && row.tratamiento_iva === 'GRAVADO' ? row.iva_tasa : null,
    regla_fiscal_fuente: row.categoria === 'OTRO_GASTO' ? row.regla_fiscal_fuente.trim() || null : null,
    regla_fiscal_version: row.categoria === 'OTRO_GASTO' ? row.regla_fiscal_version.trim() || null : null,
  })), [rows]);
  useEffect(() => {
    setPreview(null);
    if (!canWrite || !rows.every((row) => row.categoria && row.concepto.trim() && /^\d+(?:\.\d{1,2})?$/.test(row.importe))) { setPreview(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void quotesService.previewBudget(quote.id, concepts, controller.signal).then((result) => { setPreview(result.totals); setPreviewError(''); })
        .catch((cause) => { if (!(cause instanceof DOMException && cause.name === 'AbortError')) { setPreview(null); setPreviewError(cause instanceof Error ? cause.message : 'No pudimos calcular el presupuesto.'); } });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [canWrite, concepts, quote.id, rows]);
  const displayedTotals = dirty ? preview : quote.presupuesto?.totals;

  const update = (index: number, field: keyof Row, value: string) => setRows((current) => current.map((row, rowIndex) => rowIndex === index
    ? field === 'categoria' && value !== 'OTRO_GASTO' ? { ...row, categoria: value as Row['categoria'], tratamiento_iva: '', iva_tasa: '', regla_fiscal_fuente: '', regla_fiscal_version: '' }
      : field === 'tratamiento_iva' && value !== 'GRAVADO' ? { ...row, tratamiento_iva: value as Row['tratamiento_iva'], iva_tasa: '' }
        : { ...row, [field]: value }
    : row));
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
        tratamiento_iva: '', iva_tasa: '', regla_fiscal_fuente: '', regla_fiscal_version: '',
      })));
      setOrigin('IMPORTADO');
      setImportNotice(`${result.rubros.length} renglones detectados. Revisa categoría, concepto e importe antes de guardar.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos leer el documento.'); }
    finally { setImporting(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (rows.some((row) => !row.categoria || !row.concepto.trim() || !/^\d+(?:\.\d{1,2})?$/.test(row.importe) || Number(row.importe) <= 0)) {
      setError('Completa categoría, concepto e importe mayor que cero en cada renglón.'); return;
    }
    setSaving(true); setError('');
    try {
      await quotesService.updateBudget(quote.id, {
        concepts,
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
    {previewError && <div className={styles.formError} role="alert">{previewError}</div>}
    {!canWrite && canWriteInput && <div className={styles.importNotice} role="status">La cotización aceptada o convertida conserva su presupuesto histórico. No se recalcula automáticamente.</div>}
    <form onSubmit={submit}>
      <label className={styles.operationContextField}><span>Contexto de la operación</span><textarea rows={3} value={operationContext} disabled={!canWrite || saving} onChange={(event) => setOperationContext(event.target.value)} placeholder="Describe los datos que deben considerarse en esta cotización." maxLength={4000} /><small>Este mismo contexto alimenta la captura manual, el ejemplo cargado y la propuesta con IA.</small></label>
      <div className={styles.inlineConceptHeader} aria-hidden="true"><span>Categoría</span><span>Concepto</span><span>Importe MXN</span><span>Orden</span><span /></div>
      <div className={styles.inlineConceptRows}>
        {rows.map((row, index) => <div className={styles.inlineConceptRow} key={index}>
          <label><span>Categoría</span><select aria-label={`Categoría concepto ${index + 1}`} value={row.categoria} disabled={!canWrite || saving} onChange={(event) => update(index, 'categoria', event.target.value)}><option value="">Selecciona…</option>{categories.map((category) => <option key={category} value={category}>{quoteCategoryLabel(category)}</option>)}</select></label>
          <label><span>Concepto</span><input aria-label={`Concepto ${index + 1}`} value={row.concepto} disabled={!canWrite || saving} onChange={(event) => update(index, 'concepto', event.target.value)} /></label>
          <label><span>Importe MXN</span><input aria-label={`Importe concepto ${index + 1}`} type="number" min="0.01" step="0.01" value={row.importe} disabled={!canWrite || saving} onChange={(event) => update(index, 'importe', event.target.value)} /></label>
          {row.categoria === 'OTRO_GASTO' && <div className={styles.inlineTaxFields}>
            <label><span>Tratamiento fiscal</span><select aria-label={`Tratamiento fiscal concepto ${index + 1}`} value={row.tratamiento_iva} disabled={!canWrite || saving} onChange={(event) => update(index, 'tratamiento_iva', event.target.value)}><option value="">Selecciona…</option><option value="SIN_IMPUESTO">Sin impuesto configurado</option><option value="GRAVADO">Gravado según regla</option><option value="EXENTO">Exento</option><option value="NO_OBJETO">No objeto</option><option value="REQUIERE_REVISION">Requiere revisión</option></select></label>
            {row.tratamiento_iva === 'GRAVADO' && <label><span>Tasa configurada (0–1)</span><input aria-label={`Tasa IVA concepto ${index + 1}`} inputMode="decimal" placeholder="0.160000" value={row.iva_tasa} disabled={!canWrite || saving} onChange={(event) => update(index, 'iva_tasa', event.target.value)} /></label>}
            {row.tratamiento_iva && row.tratamiento_iva !== 'REQUIERE_REVISION' && <><label><span>Fuente aprobada</span><input aria-label={`Fuente fiscal concepto ${index + 1}`} maxLength={240} value={row.regla_fiscal_fuente} disabled={!canWrite || saving} onChange={(event) => update(index, 'regla_fiscal_fuente', event.target.value)} /></label><label><span>Versión de regla</span><input aria-label={`Versión fiscal concepto ${index + 1}`} maxLength={80} value={row.regla_fiscal_version} disabled={!canWrite || saving} onChange={(event) => update(index, 'regla_fiscal_version', event.target.value)} /></label></>}
          </div>}
          <span className={styles.conceptOrder}><button type="button" aria-label={`Subir concepto ${index + 1}`} disabled={!canWrite || saving || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button><button type="button" aria-label={`Bajar concepto ${index + 1}`} disabled={!canWrite || saving || index === rows.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button></span>
          <button type="button" className={styles.iconDangerButton} aria-label={`Eliminar concepto ${index + 1}`} disabled={!canWrite || saving || rows.length === 1} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={17} /></button>
        </div>)}
      </div>
      {canWrite && <button type="button" className={styles.addConcept} disabled={saving} onClick={() => setRows((current) => [...current, emptyRow()])}><Plus size={16} />Agregar concepto</button>}
      <div className={styles.inlineBudgetTotals} aria-live="polite">{displayedTotals ? <dl>
        <div><dt>Impuestos y derechos</dt><dd>{money(displayedTotals.impuestos_derechos)}</dd></div>
        <div><dt>Honorarios base</dt><dd>{money(displayedTotals.honorarios)}</dd></div>
        <div><dt>IVA de honorarios (automático)</dt><dd>{money(displayedTotals.iva_honorarios)}</dd></div>
        <div><dt>Subtotal honorarios</dt><dd>{money(displayedTotals.subtotal_honorarios)}</dd></div>
        <div><dt>Otros gastos</dt><dd>{money(displayedTotals.otros_gastos)}</dd></div>
        <div><dt>IVA de otros gastos configurados</dt><dd>{money(displayedTotals.iva_otros_gastos)}</dd></div>
        <div className={styles.inlineBudgetGrandTotal}><dt>{displayedTotals.requires_review ? 'Total provisional · requiere revisión' : 'Total cliente'}</dt><dd>{money(displayedTotals.total)}</dd></div>
      </dl> : <span role="status">Calculando presupuesto…</span>}</div>
      {canWrite && <footer className={styles.inlineBudgetActions}><span>{dirty ? 'Hay cambios sin guardar.' : 'Presupuesto guardado.'}</span><div><button type="button" className={styles.secondaryButton} disabled={!dirty || saving} onClick={discard}>Descartar</button><button type="submit" className={styles.primaryButton} disabled={!dirty || saving || importing}>{saving ? <LoaderCircle className={styles.spin} size={17} /> : <Save size={17} />}Guardar cambios</button></div></footer>}
    </form>
  </section>;
}
