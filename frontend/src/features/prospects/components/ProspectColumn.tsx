import type { Prospect, ProspectStage } from '../prospects.types';
import { ProspectCard } from './ProspectCard';
import styles from '../ProspectsPage.module.css';

export function ProspectColumn({ id, label, prospects, total, onCreate }: { id: ProspectStage; label: string; prospects: Prospect[]; total?: number; onCreate?: () => void }) {
  return (
    <section className={`${styles.column} ${styles[`stage${id}`]}`} aria-labelledby={`stage-${id}`}>
      <header><h2 id={`stage-${id}`}>{label} <span>{total ?? prospects.length}</span></h2></header>
      <div className={styles.cardStack}>
        {prospects.map((prospect) => <ProspectCard key={prospect.id} prospect={prospect} />)}
        {!prospects.length && <div className={styles.columnEmpty}><p>No hay prospectos en esta etapa.</p>{onCreate && <button type="button" onClick={onCreate}>Crear prospecto</button>}</div>}
      </div>
    </section>
  );
}
