import type { PropsWithChildren } from 'react';
import styles from './Tooltip.module.css';

export function Tooltip({ label, children, disabled = false, placement = 'right' }: PropsWithChildren<{ label: string; disabled?: boolean; placement?: 'left' | 'right' }>) {
  if (disabled) return children;
  return <span className={styles.wrapper}>{children}<span className={`${styles.tip} ${styles[placement]}`} role="tooltip">{label}</span></span>;
}
