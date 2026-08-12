import { useEffect, useRef, type PropsWithChildren, type ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from '../Quotes.module.css';

export function QuoteActionDialog({ title, description, onClose, children, footer }: PropsWithChildren<{ title: string; description?: string; onClose: () => void; footer: ReactNode }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus(); const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, [onClose]);
  return <div className={styles.dialogBackdrop}><div className={styles.dialog} ref={ref} role="dialog" aria-modal="true" aria-labelledby="quote-dialog-title"><header><div><h2 id="quote-dialog-title">{title}</h2>{description && <p>{description}</p>}</div><button type="button" onClick={onClose} aria-label="Cerrar"><X size={19} /></button></header><div className={styles.dialogBody}>{children}</div><footer>{footer}</footer></div></div>;
}
