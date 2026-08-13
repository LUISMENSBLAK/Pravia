import type { PropsWithChildren, ReactNode } from 'react';
import styles from '../Comparecientes.module.css';
export function SectionCard({ title, subtitle, action, children }: PropsWithChildren<{ title: string; subtitle?: string; action?: ReactNode }>) { return <section className={styles.sectionCard}><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>{children}</section>; }
export function Empty({ children }: PropsWithChildren) { return <p className={styles.sectionEmpty}>{children}</p>; }
