import { Skeleton } from '../../../components/ui/Skeleton';
import styles from '../Expedientes.module.css';
export function ExpedientesLoading() { return <div className={styles.loading} aria-label="Cargando expedientes"><div className={styles.loadingMetrics}>{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} />)}</div><Skeleton className={styles.loadingFilters} /><Skeleton className={styles.loadingTable} /></div>; }
