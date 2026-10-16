import { Link } from 'react-router-dom';
import type { DocumentCardData } from '../myDay.types';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import styles from './ProcessCard.module.css';

export function DocumentCard({ title, data, loading, error, onRetry, kind = 'document' }: {
  title: string; data?: DocumentCardData | null; loading: boolean; error?: string; onRetry: () => void;
  kind?: 'document' | 'format' | 'signature' | 'compliance' | 'notice' | 'finding' | 'alert';
}) {
  const noun = kind === 'alert' ? 'alerta' : kind === 'finding' ? 'hallazgo' : kind === 'format' || kind === 'signature' ? 'formato' : kind === 'compliance' ? 'expediente'
    : kind === 'notice' ? 'aviso' : 'documento';
  const empty = kind === 'alert' ? 'No hay alertas jurídicas críticas abiertas de revisiones vigentes dentro de tu alcance.'
    : kind === 'finding' ? 'No hay hallazgos persistidos en la revisión del proyecto vigente dentro de tu alcance.'
    : kind === 'format' ? 'No hay formatos pendientes de generación dentro de tu alcance.'
    : kind === 'signature' ? 'No hay formatos generados que requieran una versión firmada pendiente dentro de tu alcance.'
    : kind === 'compliance' ? 'No hay expedientes PLD incompletos dentro de tu alcance.'
      : kind === 'notice' ? 'No hay avisos en esta condición dentro de tu alcance.'
      : 'No hay documentos en esta condición dentro de tu alcance.';
  return <WidgetCard title={title} badge={data?.count}>
    {loading ? <WidgetLoading rows={3} /> : error || !data
      ? <WidgetError message={error || 'No pudimos consultar los documentos.'} onRetry={onRetry} />
      : data.count === 0 ? <WidgetEmpty>{empty}</WidgetEmpty>
        : <><p className={styles.total}>{data.count} {noun}{data.count === 1 ? '' : 's'} en total</p>
          <ul className={styles.list}>{data.items.map((item) => <li key={item.id}>
            <Link to={item.href} aria-label={`Abrir ${kind === 'finding' ? 'proyecto' : kind === 'compliance' || kind === 'notice' || kind === 'alert' || kind === 'signature' ? 'Cumplimiento' : kind === 'format' ? 'formatos' : 'documentos'} de ${item.folio}`}>
              <span><strong>{item.nombre}</strong><small>{item.folio}</small></span>
            </Link>
          </li>)}</ul></>}
  </WidgetCard>;
}
