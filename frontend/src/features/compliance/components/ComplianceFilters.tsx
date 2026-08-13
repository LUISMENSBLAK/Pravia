import { Filter, Search, X } from 'lucide-react';
import styles from '../Compliance.module.css';

export function ComplianceFilters({ filters, catalogs, onChange, onClear }: { filters: Record<string, string>; catalogs: any; onChange: (key: string, value: string) => void; onClear: () => void }) {
  return <section className={styles.filterPanel} aria-label="Filtros de revisiones">
    <label className={styles.search}><Search/><input aria-label="Buscar expediente" value={filters.search || ''} onChange={event => onChange('search', event.target.value)} placeholder="Buscar expediente o cliente…" /></label>
    <details className={styles.moreFilters}><summary><Filter/>Filtros</summary><div>
      <label><span>Estado</span><select value={filters.estatus || 'TODOS'} onChange={e=>onChange('estatus',e.target.value)}><option value="TODOS">Todos</option><option value="BORRADOR">Borrador</option><option value="PENDIENTE_REVISION">Pendiente de revisión</option><option value="REQUIERE_AJUSTES">Con observaciones</option><option value="CONFIRMADO">Confirmado</option></select></label>
      <label><span>Área</span><select value={filters.tipo || 'TODOS'} onChange={e=>onChange('tipo',e.target.value)}><option value="TODOS">UIF e ISR</option><option value="UIF">UIF</option><option value="ISR">ISR</option></select></label>
      <label><span>Responsable</span><select value={filters.responsable_id || ''} onChange={e=>onChange('responsable_id',e.target.value)}><option value="">Todos</option>{catalogs.usuarios.map((u:any)=><option key={u.id} value={u.id}>{u.nombre} {u.apellido}</option>)}</select></label>
      <label><span>Resultado</span><select value={filters.resultado || 'TODOS'} onChange={e=>onChange('resultado',e.target.value)}><option value="TODOS">Todos</option><option value="INCOMPLETO">Requiere información</option><option value="REQUIERE_AVISO">Requiere acción UIF</option><option value="SIN_AVISO_POR_UMBRAL">Sin aviso por umbral</option><option value="INSUMOS_INCOMPLETOS">ISR incompleto</option><option value="LISTO_PARA_REVISION_FISCAL">Listo para revisión fiscal</option></select></label>
      <label><span>Desde</span><input type="date" value={filters.desde || ''} onChange={e=>onChange('desde',e.target.value)}/></label>
      <label><span>Hasta</span><input type="date" value={filters.hasta || ''} onChange={e=>onChange('hasta',e.target.value)}/></label>
      <button type="button" onClick={onClear}><X/>Limpiar</button>
    </div></details>
  </section>;
}
