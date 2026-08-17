import { LoaderCircle } from 'lucide-react';
import type { Prospect, ProspectPipelineStage } from '../prospects.types';
import { ProspectCard } from './ProspectCard';
import styles from '../ProspectsPage.module.css';

export function ProspectColumn({ id, label, prospects, total, loadingMore, onLoadMore, onCreate }: { id: ProspectPipelineStage; label: string; prospects: Prospect[]; total?: number; loadingMore?: boolean; onLoadMore?: () => void; onCreate?: () => void }) {
  return (
    <section className={`${styles.column} ${styles[`stage${id}`]}`} aria-labelledby={`stage-${id}`}>
      <header><h2 id={`stage-${id}`}>{label} <span>{total ?? prospects.length}</span></h2></header>
      <div className={styles.cardStack}>
        {prospects.map((prospect) => <ProspectCard key={prospect.id} prospect={prospect} />)}
        {!prospects.length && <div className={styles.columnEmpty}><p>No hay prospectos en esta etapa.</p>{onCreate && <button type="button" onClick={onCreate}>Crear prospecto</button>}</div>}
        {prospects.length < (total ?? 0) && <button className={styles.loadMore} type="button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore && <LoaderCircle className={styles.spin} size={15} />}Ver {Math.min(10, (total ?? 0) - prospects.length)} más</button>}
      </div>
    </section>
  );
}
