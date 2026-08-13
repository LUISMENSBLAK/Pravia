import styles from '../Notarias.module.css';

const colors = ['#123d72','#2f7f79','#6ca7c7','#d09a2d','#d97b78','#9aa8ba'];
export function NotariaDistribution({ distribution }: { distribution: { total: number; items: Array<{ label: string; value: number; percentage: number }> } }) {
  let cursor = 0; const segments = distribution.items.map((item, index) => { const start = cursor; cursor += item.percentage; return `${colors[index % colors.length]} ${start}% ${cursor}%`; });
  return <section className={styles.distribution} aria-label="Distribución por entidad federativa"><header><div><h2>Distribución por estado</h2><p>Ubicación registrada en el directorio</p></div></header><div className={styles.distributionBody}><div className={styles.donut} style={{ background: distribution.total ? `conic-gradient(${segments.join(',')})` : 'var(--color-surface-subtle)' }} aria-label={`${distribution.total} notarías distribuidas por estado`}><span><strong>{distribution.total}</strong><small>Total</small></span></div><ul>{distribution.items.map((item, index) => <li key={item.label}><i style={{ background: colors[index % colors.length] }} /><span>{item.label}</span><b>{item.value}</b><small>{item.percentage}%</small></li>)}</ul></div></section>;
}
