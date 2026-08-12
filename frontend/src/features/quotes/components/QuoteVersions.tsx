import { CheckCircle2, Clock3 } from 'lucide-react';
import { money, shortDate } from '../quoteFormatters';
import type { QuoteVersion } from '../quotes.types';
import styles from '../Quotes.module.css';

export function QuoteVersions({ versions }: { versions: QuoteVersion[] }) {
  return <section className={styles.detailSection}><header><div><h2>Versiones</h2><p>Consulta la versión vigente y las anteriores.</p></div></header>{versions.length ? <ol className={styles.versionList}>{versions.map((version) => <li key={version.id}><span>{version.aprobada ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}</span><div><strong>v{version.version}{version.aprobada ? ' · Vigente' : ''}</strong><small>{shortDate(version.created_at)}{version.notas ? ` · ${version.notas}` : ''}</small></div><b>{money(version.total_cliente)}</b></li>)}</ol> : <p className={styles.sectionEmpty}>Aún no hay versiones registradas.</p>}</section>;
}
