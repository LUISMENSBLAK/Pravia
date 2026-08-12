import { Skeleton } from '../../../components/ui/Skeleton';
import styles from '../Quotes.module.css';

export function QuotesLoading() {
  return <div className={styles.loading} aria-label="Cargando cotizaciones"><div className={styles.loadingMetrics}>{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} />)}</div><Skeleton className={styles.loadingFilters} /><div className={styles.loadingBody}><Skeleton /><Skeleton /></div></div>;
}
