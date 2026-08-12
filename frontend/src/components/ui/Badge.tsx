import type { PropsWithChildren } from 'react';
import styles from './Badge.module.css';

export function Badge({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: 'neutral' | 'success' | 'warning' | 'danger' }>) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
