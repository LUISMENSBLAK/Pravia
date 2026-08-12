import { compactMoney } from '../quoteFormatters';
import type { QuoteAnalyticsMonth } from '../quotes.types';
import styles from '../Quotes.module.css';

export function QuoteAnalytics({ data, period, onPeriod }: { data: QuoteAnalyticsMonth[]; period: '6m' | 'year'; onPeriod: (value: '6m' | 'year') => void }) {
  const hasData = data.some((item) => item.sentCount > 0);
  const maxAmount = Math.max(1, ...data.flatMap((item) => [item.sentAmount, item.acceptedAmount]));
  const width = 480;
  const height = 290;
  const plotTop = 30;
  const plotBottom = 230;
  const slot = data.length ? width / data.length : width;
  const points = data.map((item, index) => `${index * slot + slot / 2},${plotBottom - (item.rate / 100) * (plotBottom - plotTop)}`).join(' ');
  return <section className={styles.analytics} aria-labelledby="quote-analytics-title">
    <header><div><h2 id="quote-analytics-title">Conversión de cotizaciones</h2><p>Importe enviado y aceptado por cohorte de envío.</p></div><select aria-label="Periodo de analítica" value={period} onChange={(event) => onPeriod(event.target.value as '6m' | 'year')}><option value="6m">Últimos 6 meses</option><option value="year">Este año</option></select></header>
    {!hasData ? <div className={styles.analyticsEmpty}><strong>No hay suficiente histórico</strong><p>La gráfica aparecerá cuando existan cotizaciones registradas como enviadas al cliente.</p></div> : <>
      <div className={styles.chartLegend}><span><i className={styles.legendSent} />Enviado</span><span><i className={styles.legendAccepted} />Aceptado</span><span><i className={styles.legendRate} />Tasa</span></div>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Barras de importes enviados y aceptados, con línea de tasa de conversión mensual">
        {[0, .5, 1].map((factor) => <g key={factor}><line x1="0" x2={width} y1={plotBottom - factor * (plotBottom - plotTop)} y2={plotBottom - factor * (plotBottom - plotTop)} className={styles.gridLine} /><text x="2" y={plotBottom - factor * (plotBottom - plotTop) - 5} className={styles.axisValue}>{compactMoney(maxAmount * factor)}</text></g>)}
        {data.map((item, index) => {
          const x = index * slot + slot / 2;
          const sentHeight = (item.sentAmount / maxAmount) * (plotBottom - plotTop);
          const acceptedHeight = (item.acceptedAmount / maxAmount) * (plotBottom - plotTop);
          return <g key={item.key}><rect x={x - 20} y={plotBottom - sentHeight} width="17" height={sentHeight} rx="3" className={styles.barSent} /><rect x={x + 3} y={plotBottom - acceptedHeight} width="17" height={acceptedHeight} rx="3" className={styles.barAccepted} /><text x={x} y="267" textAnchor="middle" className={styles.axisLabel}>{item.label}</text><title>{`${item.label}: enviado ${compactMoney(item.sentAmount)}, aceptado ${compactMoney(item.acceptedAmount)}, tasa ${item.rate}%`}</title></g>;
        })}
        <polyline points={points} className={styles.rateLine} />
        {data.map((item, index) => <circle key={item.key} cx={index * slot + slot / 2} cy={plotBottom - (item.rate / 100) * (plotBottom - plotTop)} r="4" className={styles.ratePoint}><title>{`${item.label}: ${item.rate}%`}</title></circle>)}
      </svg>
    </>}
  </section>;
}
