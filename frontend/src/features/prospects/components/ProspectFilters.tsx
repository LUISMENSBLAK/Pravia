import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { ProspectCatalogService, ProspectCatalogStage, ProspectPriority } from '../prospects.types';
import { CatalogCombobox } from './CatalogCombobox';
import styles from '../ProspectsPage.module.css';

type Props = {
  search: string;
  operationalStageCode: string;
  serviceCode: string;
  priority: ProspectPriority | '';
  services: ProspectCatalogService[];
  stages: ProspectCatalogStage[];
  onChange: (field: 'search' | 'stage' | 'service' | 'priority', value: string) => void;
  onClear: () => void;
};

export function ProspectFilters(props: Props) {
  const active = Boolean(props.search || props.operationalStageCode || props.serviceCode || props.priority);
  return (
    <section className={styles.filters} aria-label="Filtros de prospectos">
      <label className={styles.searchField}>
        <span className={styles.srOnly}>Buscar prospecto</span><Search size={19} aria-hidden="true" />
        <input value={props.search} onChange={(event) => props.onChange('search', event.target.value)} placeholder="Buscar prospecto, contacto o servicio..." />
      </label>
      <CatalogCombobox compact label="Etapa" value={props.operationalStageCode} options={props.stages} placeholder="Todas" emptyLabel="Todas" onChange={(value) => props.onChange('stage', value)} />
      <CatalogCombobox compact label="Servicio" value={props.serviceCode} options={props.services} placeholder="Todos" emptyLabel="Todos" onChange={(value) => props.onChange('service', value)} />
      <label className={styles.selectField}><span>Prioridad</span><select value={props.priority} onChange={(event) => props.onChange('priority', event.target.value)}><option value="">Todas</option><option value="ALTA">Alta</option><option value="MEDIA">Media</option><option value="BAJA">Baja</option></select></label>
      <button className={styles.clearButton} type="button" onClick={props.onClear} disabled={!active}><span className={styles.clearIcon}>{active ? <X size={17} /> : <SlidersHorizontal size={17} />}</span>Limpiar</button>
    </section>
  );
}
