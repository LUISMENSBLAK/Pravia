import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { ProspectPriority, ProspectStage } from '../prospects.types';
import { STAGES } from '../prospects.types';
import styles from '../ProspectsPage.module.css';

type Props = {
  search: string; stage: ProspectStage | ''; service: string; priority: ProspectPriority | ''; source: string;
  services: string[]; sources: string[];
  onChange: (field: 'search' | 'stage' | 'service' | 'priority' | 'source', value: string) => void;
  onClear: () => void;
};

export function ProspectFilters(props: Props) {
  const active = Boolean(props.search || props.stage || props.service || props.priority || props.source);
  return (
    <section className={styles.filters} aria-label="Filtros de prospectos">
      <label className={styles.searchField}>
        <span className={styles.srOnly}>Buscar prospecto</span><Search size={19} aria-hidden="true" />
        <input value={props.search} onChange={(event) => props.onChange('search', event.target.value)} placeholder="Buscar prospecto, contacto o servicio..." />
      </label>
      <label className={styles.selectField}><span>Etapa</span><select value={props.stage} onChange={(event) => props.onChange('stage', event.target.value)}><option value="">Todas</option>{STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
      <label className={styles.selectField}><span>Servicio</span><select value={props.service} onChange={(event) => props.onChange('service', event.target.value)}><option value="">Todos</option>{props.services.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className={styles.selectField}><span>Prioridad</span><select value={props.priority} onChange={(event) => props.onChange('priority', event.target.value)}><option value="">Todas</option><option value="ALTA">Alta</option><option value="MEDIA">Media</option><option value="BAJA">Baja</option></select></label>
      <label className={styles.selectField}><span>Origen</span><select value={props.source} onChange={(event) => props.onChange('source', event.target.value)}><option value="">Todos</option>{props.sources.map((value) => <option key={value}>{value}</option>)}</select></label>
      <button className={styles.clearButton} type="button" onClick={props.onClear} disabled={!active}><span className={styles.clearIcon}>{active ? <X size={17} /> : <SlidersHorizontal size={17} />}</span>Limpiar</button>
    </section>
  );
}
