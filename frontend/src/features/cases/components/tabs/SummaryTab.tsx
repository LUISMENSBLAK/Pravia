import { CalendarCheck2, Clock3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { expedientesService } from '../../expedientes.service';
import type { ExpedienteDetail, ExpedienteSeguimiento } from '../../expedientes.types';
import { fullName, statusLabels } from '../../expedienteFormatters';
import { DeliveryPanel } from '../DeliveryPanel';
import styles from '../../Expedientes.module.css';

export function SummaryTab({ expediente, onChanged }: { expediente: ExpedienteDetail; onChanged(): void }) {
  const [timing, setTiming] = useState<ExpedienteSeguimiento['resumen_temporal'] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    expedientesService.seguimiento(expediente.id, controller.signal).then((result) => setTiming(result.resumen_temporal)).catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setTiming(null);
    });
    return () => controller.abort();
  }, [expediente.id]);
  const notary = expediente.notaria?.numero_notaria ? `Notaría ${expediente.notaria.numero_notaria}` : expediente.notaria?.nombre || 'Sin notaría asignada';
  return <div className={styles.tabStack}>
    <section className={styles.summarySheet} aria-label="Resumen operativo del expediente">
      <header><div><small>Resumen del expediente</small><h2>{expediente.numero_pravia}</h2><p>{expediente.tipo_acto.nombre}</p></div><span className={`${styles.phaseBadge} ${styles[`phase${expediente.macrofase}`]}`}>{statusLabels[expediente.estatus]}</span></header>
      <div className={styles.summaryFacts}>
        <article><small>Cliente / solicitante</small><strong>{expediente.cliente_principal || expediente.cliente_alias || 'Sin cliente'}</strong></article>
        <article><small>Responsable</small><strong>{fullName(expediente.abogado)}</strong></article>
        <article><small>Etapa actual</small><strong>{expediente.etapaActual?.nombre_snapshot || expediente.etapa_actual_nombre || 'Sin etapa configurada'}</strong></article>
        <article><small>Notaría</small><strong>{notary}</strong></article>
      </div>
      <div className={styles.temporalIndicators} aria-label="Tiempos operativos de Seguimiento">
        <article><span><Clock3 /></span><div><small>Tiempo estimado a firma</small><strong>{timing ? timing.dias_habiles_a_firma : '—'} días hábiles</strong></div></article>
        <article><span><CalendarCheck2 /></span><div><small>Tiempo estimado de entrega</small><strong>{timing ? timing.dias_habiles_a_entrega : '—'} días hábiles</strong></div></article>
      </div>
    </section>
    <DeliveryPanel expediente={expediente} onChanged={onChanged} />
  </div>;
}
