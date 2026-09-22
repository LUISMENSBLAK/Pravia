import { ArrowDown, ArrowUp, Filter, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ExpedienteListResult } from '../expedientes.types';
import styles from '../Expedientes.module.css';

type Props = { values: Record<string, string>; facets: ExpedienteListResult['facets']; onChange(field: string, value: string): void };

function ColumnFilter({ label, active, onClear, children, sort, onSort }: { label: string; active: boolean; onClear(): void; children: ReactNode; sort?: 'asc' | 'desc' | null; onSort?(): void }) {
  return <div className={styles.columnHeader}>
    <span>{label}</span>
    {onSort && <button type="button" className={`${styles.sortButton} ${sort ? styles.headerControlActive : ''}`} aria-label={`Ordenar ${label} ${sort === 'asc' ? 'descendente' : 'ascendente'}`} onClick={onSort}>{sort === 'desc' ? <ArrowDown /> : <ArrowUp />}</button>}
    <details className={styles.columnFilter}>
      <summary className={active ? styles.headerControlActive : ''} aria-label={`Filtrar ${label}`}><Filter />{active && <i aria-hidden="true" />}</summary>
      <div className={styles.columnFilterPanel}>
        <strong>Filtrar {label}</strong>
        {children}
        {active && <button type="button" className={styles.clearColumnFilter} onClick={onClear}><X />Limpiar este filtro</button>}
      </div>
    </details>
  </div>;
}

const sortDirection = (sort: string, field: string) => sort.startsWith(`${field}:`) ? sort.split(':')[1] as 'asc' | 'desc' : null;

export function ExpedienteFilters({ values, facets, onChange }: Props) {
  const changeSort = (field: string) => { const current = sortDirection(values.sort || '', field); onChange('sort', `${field}:${current === 'asc' ? 'desc' : 'asc'}`); };
  return <tr className={styles.columnHeaders}>
    <th aria-label="Folio"><ColumnFilter label="Folio" active={Boolean(values.folio)} onClear={() => onChange('folio', '')} sort={sortDirection(values.sort || '', 'numero_pravia')} onSort={() => changeSort('numero_pravia')}><input aria-label="Filtrar por folio" value={values.folio || ''} onChange={(event) => onChange('folio', event.target.value)} placeholder="EXP-0001-2026" /></ColumnFilter></th>
    <th aria-label="Acto"><ColumnFilter label="Acto" active={Boolean(values.actType)} onClear={() => onChange('actType', '')}><select aria-label="Filtrar por acto" value={values.actType || ''} onChange={(event) => onChange('actType', event.target.value)}><option value="">Todos</option>{facets.actTypes.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select></ColumnFilter></th>
    <th aria-label="Cliente"><ColumnFilter label="Cliente" active={Boolean(values.client)} onClear={() => onChange('client', '')}><input aria-label="Filtrar por cliente" value={values.client || ''} onChange={(event) => onChange('client', event.target.value)} placeholder="Nombre o razón social" /></ColumnFilter></th>
    <th aria-label="Etapa"><ColumnFilter label="Etapa" active={Boolean(values.stage)} onClear={() => onChange('stage', '')}><select aria-label="Filtrar por etapa" value={values.stage || ''} onChange={(event) => onChange('stage', event.target.value)}><option value="">Todas</option>{facets.stages.map((name) => <option key={name}>{name}</option>)}</select></ColumnFilter></th>
    <th aria-label="Responsable"><ColumnFilter label="Responsable" active={Boolean(values.responsible)} onClear={() => onChange('responsible', '')}><select aria-label="Filtrar por responsable" value={values.responsible || ''} onChange={(event) => onChange('responsible', event.target.value)}><option value="">Todos</option>{facets.responsibles.map((item) => <option key={item.id} value={item.id}>{`${item.nombre} ${item.apellido || ''}`.trim()}</option>)}</select></ColumnFilter></th>
    <th aria-label="Número de escritura"><ColumnFilter label="Número escritura" active={Boolean(values.deedNumber)} onClear={() => onChange('deedNumber', '')} sort={sortDirection(values.sort || '', 'numero_escritura')} onSort={() => changeSort('numero_escritura')}><input aria-label="Filtrar por número de escritura" value={values.deedNumber || ''} onChange={(event) => onChange('deedNumber', event.target.value)} placeholder="Número" /></ColumnFilter></th>
    <th aria-label="Fecha de escritura"><ColumnFilter label="Fecha escritura" active={Boolean(values.deedDateFrom || values.deedDateTo)} onClear={() => onChange('deedDateRange', '')} sort={sortDirection(values.sort || '', 'fecha_escritura')} onSort={() => changeSort('fecha_escritura')}><label>Desde<input aria-label="Escritura desde" type="date" value={values.deedDateFrom || ''} onChange={(event) => onChange('deedDateFrom', event.target.value)} /></label><label>Hasta<input aria-label="Escritura hasta" type="date" value={values.deedDateTo || ''} onChange={(event) => onChange('deedDateTo', event.target.value)} /></label></ColumnFilter></th>
    <th aria-label="Vulnerable"><ColumnFilter label="Vulnerable" active={Boolean(values.risk)} onClear={() => onChange('risk', '')}><select aria-label="Filtrar por vulnerabilidad" value={values.risk || ''} onChange={(event) => onChange('risk', event.target.value)}><option value="">Todos</option><option value="ATTENTION">Requiere atención</option><option value="EVALUATED">Evaluado</option><option value="UNEVALUATED">Sin evaluar</option></select></ColumnFilter></th>
    <th aria-label="Cumplimiento"><ColumnFilter label="Cumplimiento" active={Boolean(values.compliance)} onClear={() => onChange('compliance', '')}><select aria-label="Filtrar por cumplimiento" value={values.compliance || ''} onChange={(event) => onChange('compliance', event.target.value)}><option value="">Todos</option><option value="COMPLETE">Completo</option><option value="PENDING">Pendiente</option><option value="OVERDUE">Vencido</option><option value="UNEVALUATED">Sin evaluar</option></select></ColumnFilter></th>
    <th><span className={styles.srOnly}>Acciones</span></th>
  </tr>;
}
