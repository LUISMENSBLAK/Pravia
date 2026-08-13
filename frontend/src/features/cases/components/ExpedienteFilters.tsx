import { RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { ExpedienteListResult } from '../expedientes.types';
import { statusLabels } from '../expedienteFormatters';
import styles from '../Expedientes.module.css';
type Props = { values: Record<string, string>; facets: ExpedienteListResult['facets']; onChange(field: string, value: string): void; onClear(): void };
export function ExpedienteFilters({ values, facets, onChange, onClear }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const select = (label: string, field: string, options: Array<{ value: string; label: string }>) => <label className={styles.field}><span>{label}</span><select value={values[field] || ''} onChange={(event) => onChange(field, event.target.value)}><option value="">Todos</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
  return <section className={`${styles.filters} ${mobileOpen ? styles.filtersOpen : ''}`} aria-label="Filtros de expedientes">
    <label className={`${styles.field} ${styles.searchField}`}><span>Buscar</span><div><Search size={16} /><input value={values.search || ''} onChange={(event) => onChange('search', event.target.value)} placeholder="Folio, cliente, acto, notaría…" /></div></label>
    <button type="button" className={styles.mobileFilterToggle} aria-expanded={mobileOpen} onClick={() => setMobileOpen((value) => !value)}><SlidersHorizontal size={16} />{mobileOpen ? 'Ocultar filtros' : 'Más filtros'}</button>
    {select('Etapa', 'stage', facets.stages.map((name) => ({ value: name, label: name })))}
    {select('Responsable', 'responsible', facets.responsibles.map((item) => ({ value: item.id, label: `${item.nombre} ${item.apellido || ''}`.trim() })))}
    {select('Notaría', 'notary', facets.notaries.map((item) => ({ value: item.id, label: item.numero_notaria ? `Notaría ${item.numero_notaria} · ${item.municipio || item.nombre}` : item.nombre })))}
    {select('Riesgo', 'risk', [{ value: 'ATTENTION', label: 'Requiere atención' }, { value: 'EVALUATED', label: 'Evaluado' }, { value: 'UNEVALUATED', label: 'Sin evaluar' }])}
    <label className={styles.field}><span>Actualización</span><div className={styles.dateRange}><input aria-label="Actualizado desde" type="date" value={values.dateFrom || ''} onChange={(event) => onChange('dateFrom', event.target.value)} /><input aria-label="Actualizado hasta" type="date" value={values.dateTo || ''} onChange={(event) => onChange('dateTo', event.target.value)} /></div></label>
    {select('Tipo de acto', 'actType', facets.actTypes.map((item) => ({ value: item.id, label: item.nombre })))}
    <label className={styles.field}><span>Cliente</span><input value={values.client || ''} onChange={(event) => onChange('client', event.target.value)} placeholder="Nombre o razón social" /></label>
    {select('Estado', 'status', Object.entries(statusLabels).map(([value, label]) => ({ value, label })))}
    {select('Orden', 'sort', [{ value: 'updated_at:desc', label: 'Actualización reciente' }, { value: 'updated_at:asc', label: 'Actualización antigua' }, { value: 'numero_pravia:asc', label: 'Folio ascendente' }, { value: 'numero_pravia:desc', label: 'Folio descendente' }])}
    <button type="button" className={styles.savedFilters} disabled title="Los filtros guardados se habilitarán cuando exista un contrato persistente"><SlidersHorizontal size={16} />Filtros guardados</button>
    <button type="button" className={styles.clearButton} onClick={onClear}><RotateCcw size={16} />Limpiar filtros</button>
  </section>;
}
