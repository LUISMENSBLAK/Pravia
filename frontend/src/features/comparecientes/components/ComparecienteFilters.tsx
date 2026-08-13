import { Filter, RotateCcw, Search } from 'lucide-react';
import { useState } from 'react';
import styles from '../Comparecientes.module.css';

export function ComparecienteFilters({ values, onChange, onClear }: { values: Record<string, string>; onChange(field: string, value: string): void; onClear(): void }) {
  const [open, setOpen] = useState(false);
  return <section className={`${styles.filters} ${open ? styles.filtersOpen : ''}`} aria-label="Filtros de comparecientes">
    <label className={`${styles.field} ${styles.searchField}`}><span>Buscar</span><div><Search size={17} /><input value={values.search} onChange={(event) => onChange('search', event.target.value)} placeholder="Nombre, razón social, RFC, CURP, correo o teléfono…" /></div></label>
    <label className={styles.field}><span>Tipo de persona</span><select value={values.type} onChange={(event) => onChange('type', event.target.value)}><option value="">Todos</option><option value="FISICA">Persona física</option><option value="MORAL">Persona moral</option></select></label>
    <label className={styles.field}><span>Estatus de identidad</span><select value={values.identity} onChange={(event) => onChange('identity', event.target.value)}><option value="">Todos</option><option value="VERIFICADA">Verificada</option><option value="PENDIENTE">Pendiente</option><option value="OBSERVACION">Observación</option></select></label>
    <label className={styles.field}><span>Cumplimiento</span><select value={values.compliance} onChange={(event) => onChange('compliance', event.target.value)}><option value="">Todos</option><option value="COMPLETO">Completo</option><option value="PENDIENTE">Pendiente</option><option value="OBSERVACION">Observación</option><option value="NO_CONFIGURADO">No configurado</option></select></label>
    <label className={styles.field}><span>Actualización</span><select value={values.updated} onChange={(event) => onChange('updated', event.target.value)}><option value="">Cualquier fecha</option><option value="HOY">Hoy</option><option value="7_DIAS">Últimos 7 días</option><option value="30_DIAS">Últimos 30 días</option></select></label>
    <label className={styles.field}><span>Ordenar</span><select value={values.sort} onChange={(event) => onChange('sort', event.target.value)}><option value="updated_at:desc">Actualización reciente</option><option value="updated_at:asc">Actualización antigua</option><option value="nombre:asc">Nombre A–Z</option><option value="nombre:desc">Nombre Z–A</option></select></label>
    <button type="button" className={styles.mobileFilterToggle} onClick={() => setOpen((value) => !value)}><Filter size={16} />{open ? 'Ocultar filtros' : 'Filtros'}</button>
    <button type="button" className={styles.clearButton} onClick={onClear}><RotateCcw size={15} />Limpiar</button>
  </section>;
}
