import { Search, SlidersHorizontal, X } from 'lucide-react';
import { QUOTE_STATES, type QuoteState } from '../quotes.types';
import { QUOTE_STATE_LABELS } from '../quoteFormatters';
import styles from '../Quotes.module.css';

type Props = {
  search: string; state: QuoteState | ''; act: string; responsible: string; dateFrom: string; dateTo: string;
  acts: string[]; responsibles: Array<{ id: string; name: string }>;
  onChange: (field: string, value: string) => void; onClear: () => void;
};

export function QuoteFilters({ search, state, act, responsible, dateFrom, dateTo, acts, responsibles, onChange, onClear }: Props) {
  const active = Boolean(search || state || act || responsible || dateFrom || dateTo);
  return <section className={styles.filters} aria-label="Filtros de cotizaciones">
    <label className={styles.searchField}><Search size={18} aria-hidden="true" /><span className={styles.srOnly}>Buscar cotización</span><input value={search} onChange={(event) => onChange('search', event.target.value)} placeholder="Buscar folio, cliente, prospecto o acto…" /></label>
    <label className={styles.selectField}><span>Estado</span><select aria-label="Estado" value={state} onChange={(event) => onChange('state', event.target.value)}><option value="">Todos</option>{QUOTE_STATES.map((item) => <option key={item} value={item}>{QUOTE_STATE_LABELS[item]}</option>)}</select></label>
    <label className={styles.selectField}><span>Tipo de acto</span><select aria-label="Tipo de acto" value={act} onChange={(event) => onChange('act', event.target.value)}><option value="">Todos</option>{acts.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className={styles.selectField}><span>Responsable</span><select aria-label="Responsable" value={responsible} onChange={(event) => onChange('responsible', event.target.value)}><option value="">Todos</option>{responsibles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className={styles.dateGroup}><SlidersHorizontal size={16} aria-hidden="true" /><label><span>Desde</span><input aria-label="Fecha desde" type="date" value={dateFrom} onChange={(event) => onChange('dateFrom', event.target.value)} /></label><label><span>Hasta</span><input aria-label="Fecha hasta" type="date" value={dateTo} onChange={(event) => onChange('dateTo', event.target.value)} /></label></div>
    <button type="button" className={styles.clearButton} onClick={onClear} disabled={!active}><X size={16} />Limpiar</button>
  </section>;
}
