import { CalendarCheck2, Clock3, FileText, ListChecks, WalletCards } from 'lucide-react';
import type { KpiMetric, MyDayData } from '../myDay.types';
import { formatNumber } from '../formatters';
import { Skeleton } from '../../../components/ui/Skeleton';
import styles from './DailyKpis.module.css';

type Tone = 'gold' | 'purple' | 'orange' | 'green';

function Kpi({ metric, icon: Icon, tone }: { metric?: KpiMetric; icon: typeof FileText; tone: Tone }) {
  return (
    <article className={styles.card}>
      <span className={`${styles.icon} ${styles[tone]}`}><Icon size={21} strokeWidth={1.8} aria-hidden="true" /></span>
      <div className={styles.copy}>
        <strong>{metric ? formatNumber(metric.value) : '—'}</strong>
        <span>{metric?.label ?? 'Dato no disponible'}</span>
        {metric?.context && <small>{metric.context}</small>}
      </div>
    </article>
  );
}

export function DailyKpis({ data, loading }: { data: MyDayData | null; loading: boolean }) {
  if (loading) {
    return <section className={styles.grid} aria-label="Indicadores del día">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className={styles.kpiSkeleton} />)}</section>;
  }
  const financeMetric = data?.permissions.canViewFinance ? data.kpis.financial : data?.kpis.operationalFallback;
  return (
    <section className={styles.grid} aria-label="Indicadores del día">
      <Kpi metric={data?.kpis.activeFiles} icon={FileText} tone="gold" />
      <Kpi metric={data?.kpis.signaturesToday} icon={CalendarCheck2} tone="purple" />
      <Kpi metric={data?.kpis.urgentPending} icon={Clock3} tone="orange" />
      <Kpi metric={financeMetric} icon={data?.permissions.canViewFinance ? WalletCards : ListChecks} tone="green" />
    </section>
  );
}
