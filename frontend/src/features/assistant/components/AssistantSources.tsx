import { ChevronDown, Eye, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AssistantSource } from '../assistant.types';
import styles from './AssistantDrawer.module.css';

export function AssistantSources({ sources, onOpenDocument }: { sources?: AssistantSource[]; onOpenDocument?(source: AssistantSource): void }) {
  if (!sources?.length) return null;
  const results = sources.filter(source => source.type === 'Resultado' && /^\/(?:cotizaciones|prospectos|comparecientes|predios|expedientes|agenda)(?:\/|#)/.test(source.reference || '') && !/[\\\r\n]/.test(source.reference || ''));
  const references = sources.filter(source => source.type !== 'Resultado');
  return (
    <>
    {!!results.length && <div className={styles.resultLinks}>{results.map(source => <Link key={source.id} to={source.reference!}><Eye size={16}/>Ver cambios</Link>)}</div>}
    {!!references.length &&
    <details className={styles.sources}>
      <summary>Fuentes ({references.length}) <ChevronDown size={14} aria-hidden="true" /></summary>
      <ul>{references.map((source) => <li key={source.id}><FileText size={15} aria-hidden="true" /><div><strong>{source.label}</strong>{source.document && <span>{source.document}</span>}{typeof source.page === 'number' && <span>Página {source.page}</span>}{source.reference && source.type !== 'Documento' && <span>{source.reference}</span>}</div>{source.type === 'Documento' && source.entityId && onOpenDocument && <button type="button" className={styles.sourceOpen} onClick={() => onOpenDocument(source)}><Eye size={14} />Abrir</button>}</li>)}</ul>
    </details>}
    </>
  );
}
