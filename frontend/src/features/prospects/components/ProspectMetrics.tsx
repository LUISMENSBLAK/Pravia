import { BadgeCheck, ChartNoAxesCombined, FileText, Target, UsersRound } from 'lucide-react';
import type { Prospect, ProspectListMeta } from '../prospects.types';
import styles from '../ProspectsPage.module.css';

export function ProspectMetrics({ prospects, meta }: { prospects: Prospect[]; meta: ProspectListMeta | null }) {
  const total = meta?.total ?? prospects.length;
  const converted = meta?.metrics.accepted ?? prospects.filter((item) => item.estado === 'ACEPTADO').length;
  const active = meta?.metrics.active ?? prospects.filter((item) => !['ACEPTADO', 'PERDIDO', 'CANCELADO', 'ARCHIVADO'].includes(item.estado)).length;
  const withQuote = meta?.metrics.withQuote ?? prospects.filter((item) => Boolean(item.cotizacion)).length;
  const conversion = total ? `${((converted / total) * 100).toFixed(1)}%` : '—';
  const metrics = [
    { label: 'Total prospectos', value: total, icon: UsersRound, tone: 'gold' },
    { label: 'En proceso', value: active, icon: Target, tone: 'blue' },
    { label: 'Con cotización', value: withQuote, icon: FileText, tone: 'purple' },
    { label: 'Convertidos', value: converted, icon: BadgeCheck, tone: 'green' },
    { label: 'Tasa de conversión', value: conversion, icon: ChartNoAxesCombined, tone: 'gold' },
  ];
  return (
    <section className={styles.metrics} aria-label="Indicadores de prospectos">
      {metrics.map(({ label, value, icon: Icon, tone }) => (
        <article className={styles.metric} key={label}>
          <span className={`${styles.metricIcon} ${styles[tone]}`}><Icon size={21} aria-hidden="true" /></span>
          <div><span>{label}</span><strong>{value}</strong></div>
        </article>
      ))}
    </section>
  );
}
