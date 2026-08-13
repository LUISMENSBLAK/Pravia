import { AlertCircle, CheckCircle2, CircleDashed, MinusCircle } from 'lucide-react';
import type { ComparecienteDetail, HealthState } from '../comparecientes.types';
import styles from '../Comparecientes.module.css';

const labels: Record<HealthState, string> = { COMPLETO: 'Completo', PENDIENTE: 'Pendiente', OBSERVACION: 'Observación', NO_APLICA: 'No aplica', NO_CONFIGURADO: 'No configurado' };
const icons = { COMPLETO: CheckCircle2, PENDIENTE: CircleDashed, OBSERVACION: AlertCircle, NO_APLICA: MinusCircle, NO_CONFIGURADO: CircleDashed };
export function ComparecienteHealth({ item }: { item: ComparecienteDetail }) { return <section className={styles.health} aria-label="Preparación del compareciente">{item.health.map((dimension) => { const Icon = icons[dimension.state]; return <article key={dimension.key} className={styles[`health_${dimension.state}`]}><Icon size={18} /><div><strong>{dimension.label}</strong><span>{labels[dimension.state]}</span></div></article>; })}</section>; }
