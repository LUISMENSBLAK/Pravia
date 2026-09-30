import { ChevronDown, Eye, FileText } from 'lucide-react';
import type { AssistantSource } from '../assistant.types';
import styles from './AssistantDrawer.module.css';

export function AssistantSources({ sources, onOpenDocument }: { sources?: AssistantSource[]; onOpenDocument?(source: AssistantSource): void }) {
  if (!sources?.length) return null;
  return (
    <details className={styles.sources}>
      <summary>Fuentes ({sources.length}) <ChevronDown size={14} aria-hidden="true" /></summary>
      <ul>{sources.map((source) => <li key={source.id}><FileText size={15} aria-hidden="true" /><div><strong>{source.label}</strong>{source.document && <span>{source.document}</span>}{typeof source.page === 'number' && <span>Página {source.page}</span>}{source.reference && source.type !== 'Documento' && <span>{source.reference}</span>}</div>{source.type === 'Documento' && source.entityId && onOpenDocument && <button type="button" className={styles.sourceOpen} onClick={() => onOpenDocument(source)}><Eye size={14} />Abrir</button>}</li>)}</ul>
    </details>
  );
}
