import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { MyDayData } from '../myDay.types';
import { formatCurrency } from '../formatters';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import styles from './FinancialSummary.module.css';

export function FinancialSummary({ finance, loading, error, onRetry }: { finance: MyDayData['finance']; loading: boolean; error?: string; onRetry: () => void }) {
  const values = finance?.months?.flatMap((month) => [month.invoiced ?? 0, month.collected ?? 0, month.receivable ?? 0]) ?? [];
  const max = Math.max(1, ...values);
  return (
    <WidgetCard id="resumen-financiero" title="Resumen financiero" action={<Link to="/finanzas">Ver reporte completo</Link>} className={styles.card}>
      {loading ? <WidgetLoading rows={2} /> : error ? <WidgetError message="No pudimos cargar el resumen financiero." onRetry={onRetry} /> : !finance || finance.metrics.length === 0 ? (
        <WidgetEmpty>Sin información financiera disponible.</WidgetEmpty>
      ) : (
        <div className={styles.content}>
          <div className={styles.metrics}>
            {finance.metrics.slice(0, 4).map((metric) => <div key={metric.key}><span>{metric.label}</span><strong>{formatCurrency(metric.value, metric.currency)}</strong></div>)}
          </div>
          {finance.months && finance.months.length > 0 && (
            <div className={styles.chart} aria-label="Resumen financiero mensual">
              {finance.months.slice(-5).map((month) => (
                <div className={styles.month} key={month.label}>
                  <div className={styles.bars}>
                    <i className={styles.invoiced} style={{ '--bar-height': `${Math.max(8, ((month.invoiced ?? 0) / max) * 100)}%` } as CSSProperties} />
                    <i className={styles.collected} style={{ '--bar-height': `${Math.max(8, ((month.collected ?? 0) / max) * 100)}%` } as CSSProperties} />
                    <i className={styles.receivable} style={{ '--bar-height': `${Math.max(8, ((month.receivable ?? 0) / max) * 100)}%` } as CSSProperties} />
                  </div>
                  <span>{month.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  );
}
