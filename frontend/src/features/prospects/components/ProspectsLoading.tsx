import { Skeleton } from '../../../components/ui/Skeleton';
import styles from '../ProspectsPage.module.css';

export function ProspectsLoading() {
  return <div role="status" aria-label="Cargando prospectos" className={styles.loading}><div className={styles.loadingMetrics}>{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} />)}</div><Skeleton className={styles.loadingFilters} /><div className={styles.loadingColumns}>{Array.from({ length: 4 }, (_, col) => <div key={col}><Skeleton />{Array.from({ length: 3 }, (_, card) => <Skeleton key={card} />)}</div>)}</div></div>;
}
