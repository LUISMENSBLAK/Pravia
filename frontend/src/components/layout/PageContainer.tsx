import type { PropsWithChildren, ReactNode } from 'react';
import styles from './PageContainer.module.css';

export function PageContainer({ title, subtitle, action, children }: PropsWithChildren<{ title: string; subtitle?: string; action?: ReactNode }>) {
  return (
    <div className={styles.container}>
      {(title || subtitle || action) && <header className={styles.header}>
        <div>{title && <h1>{title}</h1>}{subtitle && <p>{subtitle}</p>}</div>
        {action && <div>{action}</div>}
      </header>}
      {children}
    </div>
  );
}
