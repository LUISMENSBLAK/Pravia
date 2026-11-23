import type { ProjectReport } from '../expedientes.types';
import styles from '../Expedientes.module.css';

const groups = ['CRÍTICAS', 'REVISAR', 'PENDIENTES', 'INFORMATIVAS'] as const;
type Observation = ProjectReport['observaciones'][number];
const category = (item: Observation) => item.categoria || (item.nivel_riesgo === 'ALTO' ? 'CRÍTICAS'
  : /FALTANTE|PENDIENTE|NO_LE[IÍ]DO|NO_LEGIBLE/i.test(item.tipo_discrepancia) ? 'PENDIENTES'
    : item.nivel_riesgo === 'INFORMATIVO' ? 'INFORMATIVAS' : 'REVISAR');

export function ProjectionObservations({ observations }: { observations: Observation[] }) {
  return <div aria-label="Observaciones de proyección">{groups.map((group) => {
    const items = observations.filter((item) => category(item) === group);
    return <section key={group} aria-label={group}><h3>{group}</h3>{!items.length ? <p>SIN OBSERVACIONES.</p>
      : <div className={styles.projectObservations}>{items.map((item) => <article key={item.id} data-risk={item.nivel_riesgo}>
        <header><strong>{item.titulo}</strong><span>{item.tipo_discrepancia.replaceAll('_', ' ')}</span></header>
        <dl><div><dt>Capítulo / cláusula / ubicación</dt><dd>{item.ubicacion}</dd></div>
          <div><dt>Problema detectado</dt><dd>{item.dato_proyecto}</dd></div>
          <div><dt>Documento de origen</dt><dd>{item.documento_fuente}</dd></div>
          <div><dt>Dato de la fuente</dt><dd>{item.dato_fuente}</dd></div>
          <div><dt>Recomendación concreta</dt><dd>{item.recomendacion}</dd></div></dl>
      </article>)}</div>}</section>;
  })}</div>;
}
