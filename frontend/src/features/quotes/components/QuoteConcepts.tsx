import { conceptsFromVersion, money } from '../quoteFormatters';
import type { QuoteVersion } from '../quotes.types';
import styles from '../Quotes.module.css';

export function QuoteConcepts({ version }: { version?: QuoteVersion }) {
  const concepts = conceptsFromVersion(version);
  return <section className={styles.detailSection}><header><div><h2>Conceptos</h2><p>Importes incluidos en la versión vigente.</p></div></header>{concepts.length ? <div className={styles.conceptsTable}>{concepts.map((item, index) => <div key={`${item.concepto}-${index}`}><span className={styles.conceptCategory}>{item.categoria.charAt(0) + item.categoria.slice(1).toLowerCase()}</span><strong>{item.concepto}</strong><b>{money(item.monto)}</b></div>)}<footer><span>Total cliente</span><strong>{money(version?.total_cliente)}</strong></footer></div> : <p className={styles.sectionEmpty}>No se capturaron conceptos en esta versión.</p>}</section>;
}
