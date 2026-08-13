import { AlertCircle, CheckCircle2, CircleDashed, MinusCircle } from 'lucide-react';
import type { ExpedienteDetail } from '../expedientes.types';
import { readinessLabel } from '../expedienteFormatters';
import styles from '../Expedientes.module.css';
const icon = { COMPLETO: CheckCircle2, PENDIENTE: AlertCircle, NO_APLICA: MinusCircle, NO_CONFIGURADO: CircleDashed };
export function ExpedienteReadiness({ readiness }: { readiness: ExpedienteDetail['readiness'] }) { const completed = readiness.indicators.filter((item) => item.state === 'COMPLETO').length; const total = readiness.indicators.length; return <section className={styles.readinessCard}><header><div><span>Preparación de la operación</span><h2>¿Está listo para avanzar?</h2></div><b>{completed} de {total} completos</b></header><div className={styles.readinessGrid}>{readiness.indicators.map((item) => { const Icon = icon[item.state]; return <article key={item.key} className={styles[`readiness${item.state}`]}><Icon size={18} /><div><strong>{item.label}</strong><span>{readinessLabel(item.state)}</span><small>{item.detail}</small></div></article>; })}</div></section>; }
