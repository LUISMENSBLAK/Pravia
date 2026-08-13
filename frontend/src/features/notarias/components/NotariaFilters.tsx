import { Filter, RotateCcw, Search } from 'lucide-react';
import { useState } from 'react';
import type { NotariaListResult } from '../notarias.types';
import styles from '../Notarias.module.css';

export function NotariaFilters({ values, facets, onChange, onClear }: { values: Record<string, string>; facets: NotariaListResult['facets']; onChange(field: string, value: string): void; onClear(): void }) {
  const [open, setOpen] = useState(false);
  return <section className={`${styles.filters} ${open ? styles.filtersOpen : ''}`} aria-label="Filtros de notarías">
    <label className={`${styles.field} ${styles.searchField}`}><span className={styles.srOnly}>Buscar notarías</span><div><Search size={17} /><input value={values.search} onChange={(event) => onChange('search', event.target.value)} placeholder="Buscar por número, titular, ciudad, correo o teléfono..." /></div></label>
    <label className={styles.field}><span>Estado</span><select aria-label="Estado geográfico" value={values.state} onChange={(event) => onChange('state', event.target.value)}><option value="">Todos</option>{facets.states.map((value) => <option key={value}>{value}</option>)}</select></label>
    <label className={styles.field}><span>Ciudad</span><select aria-label="Ciudad" value={values.city} onChange={(event) => onChange('city', event.target.value)}><option value="">Todas</option>{facets.cities.map((value) => <option key={value}>{value}</option>)}</select></label>
    <label className={styles.field}><span>Estatus</span><select aria-label="Estatus de servicio" value={values.status} onChange={(event) => onChange('status', event.target.value)}><option value="">Todos</option><option value="ACTIVA">Activa</option><option value="INACTIVA">Inactiva</option></select></label>
    <label className={styles.field}><span>Ordenar</span><select aria-label="Ordenar notarías" value={values.sort} onChange={(event) => onChange('sort', event.target.value)}><option value="numero:asc">Número · ascendente</option><option value="numero:desc">Número · descendente</option><option value="titular:asc">Titular · A–Z</option><option value="updated_at:desc">Actualización reciente</option></select></label>
    <button type="button" className={styles.clearButton} onClick={onClear}><RotateCcw size={15} />Limpiar</button>
    <button type="button" className={styles.mobileFilterToggle} onClick={() => setOpen((value) => !value)}><Filter size={16} />{open ? 'Ocultar filtros' : 'Filtros'}</button>
  </section>;
}
