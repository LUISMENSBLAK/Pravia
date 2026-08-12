import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, LoaderCircle, Plus, Search, Trash2 } from 'lucide-react';
import { ApiError } from '../../../services/api/client';
import { money } from '../quoteFormatters';
import { quotesService } from '../quotes.service';
import type { NotaryOption, ProspectCandidate, Quote, QuoteConcept, QuoteConceptCategory } from '../quotes.types';
import { QuoteDrawer } from './QuoteDrawer';
import styles from '../Quotes.module.css';

const STEPS = ['Cliente', 'Notaría', 'Conceptos', 'Condiciones', 'Revisión'];
const categories: QuoteConceptCategory[] = ['HONORARIOS', 'DERECHOS', 'IMPUESTOS', 'GASTOS', 'OTROS'];
const newConcept = (): QuoteConcept => ({ categoria: 'HONORARIOS', concepto: '', monto: 0 });

export function NewQuoteFlow({ initialProspectId, onClose, onCreated }: { initialProspectId?: string; onClose: () => void; onCreated: (quote: Quote) => void }) {
  const [step, setStep] = useState(0); const [prospects, setProspects] = useState<ProspectCandidate[]>([]); const [notaries, setNotaries] = useState<NotaryOption[]>([]);
  const [prospectId, setProspectId] = useState(initialProspectId ?? ''); const [notaryId, setNotaryId] = useState(''); const [search, setSearch] = useState('');
  const [concepts, setConcepts] = useState<QuoteConcept[]>([newConcept()]); const [praviaFee, setPraviaFee] = useState(0); const [notes, setNotes] = useState(''); const [approve, setApprove] = useState(true);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving'>('loading'); const [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); Promise.all([quotesService.prospects('', controller.signal), quotesService.notaries('', controller.signal)]).then(([p, n]) => { if (controller.signal.aborted) return; setProspects(p); setNotaries(n); setStatus('ready'); }).catch(() => { if (controller.signal.aborted) return; setError('No pudimos cargar prospectos y notarías.'); setStatus('ready'); }); return () => controller.abort(); }, []);
  const filteredProspects = useMemo(() => prospects.filter((item) => `${item.nombre} ${item.tipo_acto || ''}`.toLowerCase().includes(search.toLowerCase())), [prospects, search]);
  const selectedProspect = prospects.find((item) => item.id === prospectId); const selectedNotary = notaries.find((item) => item.id === notaryId);
  const total = concepts.reduce((sum, item) => sum + (Number.isFinite(item.monto) ? item.monto : 0), 0);
  const updateConcept = (index: number, field: keyof QuoteConcept, value: string) => setConcepts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: field === 'monto' ? Number(value) : value } as QuoteConcept : item));
  const next = () => {
    setError('');
    if (step === 0 && !prospectId) return setError('Selecciona un prospecto sin cotización vigente.');
    if (step === 1 && !notaryId) return setError('Selecciona la notaría que preparará el presupuesto.');
    if (step === 2 && (!concepts.length || concepts.some((item) => !item.concepto.trim() || item.monto <= 0))) return setError('Cada concepto necesita descripción e importe mayor que cero.');
    if (step === 2 && (praviaFee < 0 || praviaFee > total)) return setError('La participación PRAVIA debe estar entre cero y el total.');
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setStatus('saving'); setError('');
    try {
      const quote = await quotesService.create(prospectId, notaryId);
      const result = await quotesService.createVersion(quote.id, { desglose_notaria: { rubros: concepts }, desglose_pravia: { participacion_pravia: praviaFee }, total_notaria: total, honorarios_pravia: praviaFee, notas: notes || undefined, aprobada: approve });
      onCreated({ ...quote, ...result.cotizacion, versiones: [result.version] });
    } catch (caught) {
      const alreadyExists = caught instanceof ApiError && caught.status === 409;
      setError(alreadyExists ? 'Este prospecto ya tiene una cotización. Selecciona otro para continuar.' : 'No pudimos crear la cotización. Revisa la información e inténtalo nuevamente.'); setStatus('ready');
    }
  };
  const footer = <>{step > 0 && <button type="button" className={styles.secondaryButton} onClick={() => setStep((current) => current - 1)} disabled={status === 'saving'}><ArrowLeft size={17} />Atrás</button>}<span className={styles.drawerSpacer} />{step < STEPS.length - 1 ? <button type="button" className={styles.primaryButton} onClick={next} disabled={status !== 'ready'}>Continuar<ArrowRight size={17} /></button> : <button type="submit" form="new-quote-form" className={styles.primaryButton} disabled={status === 'saving'}>{status === 'saving' && <LoaderCircle size={17} className={styles.spin} />}Crear cotización</button>}</>;
  return <QuoteDrawer title="Nueva cotización" subtitle="Crea un presupuesto a partir de un prospecto." onClose={onClose} footer={footer}>
    <ol className={styles.stepper}>{STEPS.map((label, index) => <li key={label} className={index === step ? styles.stepActive : index < step ? styles.stepDone : ''}><span>{index < step ? <Check size={14} /> : index + 1}</span><b>{label}</b></li>)}</ol>
    <form id="new-quote-form" onSubmit={submit} className={styles.quoteForm} noValidate>
      {error && <div className={styles.formError} role="alert">{error}</div>}
      {status === 'loading' ? <div className={styles.formLoading}><LoaderCircle className={styles.spin} />Cargando catálogos…</div> : <>
        {step === 0 && <fieldset><legend>Cliente / prospecto</legend><p>Selecciona el prospecto al que pertenecerá esta cotización.</p><label className={styles.searchField}><Search size={17} /><span className={styles.srOnly}>Buscar prospecto</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o acto…" /></label><div className={styles.choiceList}>{filteredProspects.map((item) => <label key={item.id} className={prospectId === item.id ? styles.choiceSelected : ''}><input type="radio" name="prospect" value={item.id} checked={prospectId === item.id} onChange={() => setProspectId(item.id)} /><span><strong>{item.nombre}</strong><small>{item.tipo_acto || 'Acto por definir'}{item.email ? ` · ${item.email}` : ''}</small></span><Check size={17} /></label>)}</div>{!filteredProspects.length && <p className={styles.inlineEmpty}>No hay prospectos disponibles sin cotización.</p>}</fieldset>}
        {step === 1 && <fieldset><legend>Notaría responsable</legend><p>La cotización se crea en borrador; el envío a notaría se registrará después con evidencia.</p><div className={styles.choiceList}>{notaries.map((item) => <label key={item.id} className={notaryId === item.id ? styles.choiceSelected : ''}><input type="radio" name="notary" value={item.id} checked={notaryId === item.id} onChange={() => setNotaryId(item.id)} /><span><strong>{item.nombre}</strong><small>{[item.numero_notaria && `Notaría ${item.numero_notaria}`, item.municipio, item.entidad_federativa].filter(Boolean).join(' · ')}</small></span><Check size={17} /></label>)}</div></fieldset>}
        {step === 2 && <fieldset><legend>Conceptos e importes</legend><p>El valor de operación no forma parte de estos totales.</p><div className={styles.conceptHeader}><span>Categoría</span><span>Concepto</span><span>Importe MXN</span><span /></div>{concepts.map((item, index) => <div className={styles.conceptRow} key={index}><select aria-label={`Categoría concepto ${index + 1}`} value={item.categoria} onChange={(event) => updateConcept(index, 'categoria', event.target.value)}>{categories.map((category) => <option key={category}>{category.charAt(0) + category.slice(1).toLowerCase()}</option>)}</select><input aria-label={`Descripción concepto ${index + 1}`} value={item.concepto} onChange={(event) => updateConcept(index, 'concepto', event.target.value)} placeholder="Ej. Honorarios notariales" /><input aria-label={`Importe concepto ${index + 1}`} type="number" min="0" step="0.01" value={item.monto || ''} onChange={(event) => updateConcept(index, 'monto', event.target.value)} /><button type="button" aria-label={`Eliminar concepto ${index + 1}`} onClick={() => setConcepts((current) => current.filter((_, itemIndex) => itemIndex !== index))} disabled={concepts.length === 1}><Trash2 size={17} /></button></div>)}<button type="button" className={styles.addConcept} onClick={() => setConcepts((current) => [...current, newConcept()])}><Plus size={16} />Agregar concepto</button><div className={styles.totalsBox}><label><span>Participación interna PRAVIA</span><input type="number" min="0" step="0.01" value={praviaFee || ''} onChange={(event) => setPraviaFee(Number(event.target.value))} /></label><dl><div><dt>Subtotal notarial</dt><dd>{money(total)}</dd></div><div><dt>Total cliente</dt><dd>{money(total)}</dd></div></dl></div></fieldset>}
        {step === 3 && <fieldset><legend>Vigencia y condiciones</legend><p>La fecha límite se define al solicitar el presupuesto a la notaría.</p><label className={styles.textareaLabel}><span>Condiciones / notas de esta versión</span><textarea rows={7} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Condiciones, exclusiones o aclaraciones para esta versión." /></label><label className={styles.checkboxLabel}><input type="checkbox" checked={approve} onChange={(event) => setApprove(event.target.checked)} /><span><strong>Aprobar esta versión como vigente</strong><small>Solo una versión puede estar vigente. Esto no la marca como enviada.</small></span></label></fieldset>}
        {step === 4 && <fieldset><legend>Revisión final</legend><p>Revisa la información antes de crear la cotización.</p><div className={styles.reviewGrid}><article><small>Prospecto</small><strong>{selectedProspect?.nombre}</strong><span>{selectedProspect?.tipo_acto || 'Acto por definir'}</span></article><article><small>Notaría</small><strong>{selectedNotary?.nombre}</strong><span>Solicitud en borrador</span></article><article><small>Versión</small><strong>v1 {approve ? '· Vigente' : '· Sin aprobar'}</strong><span>{concepts.length} concepto{concepts.length === 1 ? '' : 's'}</span></article><article><small>Total cliente</small><strong>{money(total)}</strong><span>Participación PRAVIA {money(praviaFee)}</span></article></div><ul className={styles.reviewConcepts}>{concepts.map((item, index) => <li key={index}><span>{item.categoria.charAt(0) + item.categoria.slice(1).toLowerCase()} · {item.concepto}</span><strong>{money(item.monto)}</strong></li>)}</ul></fieldset>}
      </>}
    </form>
  </QuoteDrawer>;
}
