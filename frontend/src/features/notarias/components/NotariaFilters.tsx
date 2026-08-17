import { RotateCcw, Search } from 'lucide-react';
import styles from '../Notarias.module.css';

export function NotariaFilters({ values, onChange, onClear }: { values: { search: string; state: string }; onChange(field: string, value: string): void; onClear(): void }) {
  return <section className={styles.filters} aria-label="Filtros de notarías">
    <label className={`${styles.field} ${styles.searchField}`}><span className={styles.srOnly}>Buscar notarías</span><div><Search size={17} /><input value={values.search} onChange={(event) => onChange('search', event.target.value)} placeholder="Buscar por número, titular, correo o teléfono..." /></div></label>
    <label className={styles.field}><span>Estado</span><select aria-label="Estado" value={values.state} onChange={(event) => onChange('state', event.target.value)}><option value="">Todos</option><option value="Nayarit">Nayarit</option><option value="Jalisco">Jalisco</option></select></label>
    <button type="button" className={styles.clearButton} onClick={onClear}><RotateCcw size={15} />Limpiar</button>
  </section>;
}
