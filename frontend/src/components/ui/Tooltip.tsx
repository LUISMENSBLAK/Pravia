import type { PropsWithChildren } from 'react';
import styles from './Tooltip.module.css';

export function Tooltip({ label, children, disabled = false }: PropsWithChildren<{ label: string; disabled?: boolean }>) {
  if (disabled) return children;
  return <span className={styles.wrapper}>{children}<span className={styles.tip} role="tooltip">{label}</span></span>;
}
