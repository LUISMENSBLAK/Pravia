import { useEffect, useState, type FormEvent } from 'react';
import { quotesService } from '../quotes.service';
import type { Quote, QuoteActTypeOption } from '../quotes.types';
import styles from '../Quotes.module.css';

export function QuoteActSelector({ quote, onSaved }: { quote: Quote; onSaved: () => void | Promise<void> }) {
  const [options, setOptions] = useState<QuoteActTypeOption[]>([]); const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(''); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => { const abort = new AbortController(); void quotesService.actTypes(abort.signal).then((data) => setOptions(data))
    .catch(() => { if (!abort.signal.aborted) setError('No pudimos cargar los actos. Recarga la ficha para reintentar.'); })
    .finally(() => { if (!abort.signal.aborted) setLoading(false); }); return () => abort.abort(); }, []);
  const available = options.filter((option) => !quote.actos?.some((act) => act.tipo_acto_id === option.id));
  const visible = available.filter((option) => option.nombre.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!selected || saving) return; setSaving(true); setError('');
    try { await quotesService.attachAct(quote.id, selected); setSelected(''); await onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos vincular el acto.'); } finally { setSaving(false); }
  };
  return <form className={styles.dialogForm} style={{ padding: 'var(--space-4)' }} onSubmit={submit}>
    {error && <p role="alert" className={styles.formError}>{error}</p>}
    {!quote.actos?.length && <p className={styles.contractNotice}>Selecciona un acto antes de generar la cotización.</p>}
    <label><span>Buscar acto existente</span><input type="search" value={search} disabled={saving} onChange={(event) => { setSearch(event.target.value); setSelected(''); }} /></label>
    <label><span>Acto del catálogo</span><select value={selected} disabled={loading || saving} onChange={(event) => setSelected(event.target.value)}>
      <option value="">{loading ? 'Cargando actos…' : 'Selecciona un acto'}</option>{visible.map((option) => <option key={option.id} value={option.id}>{option.nombre}</option>)}
    </select></label>
    <button type="submit" className={styles.secondaryButton} disabled={!selected || saving}>{saving ? 'Vinculando acto…' : 'Agregar acto a la cotización'}</button>
  </form>;
}
