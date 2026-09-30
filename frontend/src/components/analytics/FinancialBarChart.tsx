import { useId, useState } from 'react';
import styles from './FinancialBarChart.module.css';

export type FinancialBarDatum = { period: string; generated: number; collected: number; difference?: number };

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 });
const periodLabel = (value: string) => {
  if (/^\d{4}-\d{2}$/.test(value)) return new Intl.DateTimeFormat('es-MX', { month: 'short', year: '2-digit' }).format(new Date(`${value}-02T12:00:00`));
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`));
  return value;
};

export function FinancialBarChart({ data, ariaLabel = 'Generado y cobrado por periodo', emptyMessage = 'AÚN NO HAY MOVIMIENTOS EN ESTE PERIODO', onSelect }: { data: FinancialBarDatum[]; ariaLabel?: string; emptyMessage?: string; onSelect?: (item: FinancialBarDatum) => void }) {
  const titleId = useId();
  const [active, setActive] = useState<number | null>(null);
  if (!data.length || !data.some((item) => item.generated || item.collected)) return <div className={styles.empty} role="status"><strong>{emptyMessage}</strong><span>Los indicadores aparecerán cuando existan movimientos reales dentro del periodo seleccionado.</span></div>;
  const width = 760; const height = 278; const left = 58; const right = 14; const top = 26; const bottom = 42;
  const plot = height - top - bottom; const max = Math.max(...data.flatMap((item) => [item.generated, item.collected]), 1);
  const slot = (width - left - right) / data.length; const bar = Math.min(24, Math.max(7, slot * .27));
  return <div className={styles.wrap}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId}>
      <title id={titleId}>{ariaLabel}</title>
      {[0, .25, .5, .75, 1].map((fraction) => <g key={fraction}><line x1={left} x2={width - right} y1={top + plot * (1 - fraction)} y2={top + plot * (1 - fraction)} className={styles.grid}/><text x={left - 9} y={top + plot * (1 - fraction) + 4} textAnchor="end" className={styles.axis}>{compact.format(max * fraction)}</text></g>)}
      {data.map((item, index) => {
        const center = left + slot * index + slot / 2; const generatedHeight = item.generated / max * plot; const collectedHeight = item.collected / max * plot;
        return <g key={`${item.period}-${index}`} className={styles.group} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => onSelect?.(item)} tabIndex={onSelect ? 0 : undefined} role={onSelect ? 'button' : undefined} aria-label={`${periodLabel(item.period)}: generado ${currency.format(item.generated)}, cobrado ${currency.format(item.collected)}, diferencia ${currency.format(item.generated - item.collected)}`}>
          <rect x={center - bar - 2} y={top + plot - generatedHeight} width={bar} height={Math.max(generatedHeight, 1)} rx="4" className={styles.generated}/>
          <rect x={center + 2} y={top + plot - collectedHeight} width={bar} height={Math.max(collectedHeight, 1)} rx="4" className={styles.collected}/>
          {item.generated > 0 && <text x={center - bar / 2 - 2} y={Math.max(11, top + plot - generatedHeight - 6)} textAnchor="middle" className={styles.value}>{compact.format(item.generated)}</text>}
          {item.collected > 0 && <text x={center + bar / 2 + 2} y={Math.max(11, top + plot - collectedHeight - 6)} textAnchor="middle" className={styles.value}>{compact.format(item.collected)}</text>}
          <text x={center} y={height - 15} textAnchor="middle" className={styles.axis}>{periodLabel(item.period)}</text>
          {active === index && <g className={styles.tooltip} pointerEvents="none"><rect x={Math.min(width - 222, Math.max(left, center - 102))} y={top + 7} width="204" height="68" rx="8"/><text x={Math.min(width - 212, Math.max(left + 10, center - 92))} y={top + 26}>{periodLabel(item.period)}</text><text x={Math.min(width - 212, Math.max(left + 10, center - 92))} y={top + 43}>Generado {currency.format(item.generated)}</text><text x={Math.min(width - 212, Math.max(left + 10, center - 92))} y={top + 60}>Cobrado {currency.format(item.collected)} · Δ {currency.format(item.generated - item.collected)}</text></g>}
        </g>;
      })}
    </svg>
    <div className={styles.legend} aria-hidden="true"><span><i data-series="generated"/>Generado</span><span><i data-series="collected"/>Cobrado</span></div>
    <table className="sr-only"><caption>{ariaLabel}</caption><thead><tr><th>Periodo</th><th>Generado</th><th>Cobrado</th><th>Diferencia</th></tr></thead><tbody>{data.map((item) => <tr key={item.period}><td>{periodLabel(item.period)}</td><td>{currency.format(item.generated)}</td><td>{currency.format(item.collected)}</td><td>{currency.format(item.generated - item.collected)}</td></tr>)}</tbody></table>
  </div>;
}
