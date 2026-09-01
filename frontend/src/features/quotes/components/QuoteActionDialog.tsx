import { useEffect, useRef, type PropsWithChildren, type ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from '../Quotes.module.css';

export function QuoteActionDialog({ title, description, onClose, children, footer }: PropsWithChildren<{ title: string; description?: string; onClose: () => void; footer: ReactNode }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') ?? []);
    focusables()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previouslyFocused?.focus();
    };
  }, [onClose]);
  return <div className={styles.dialogBackdrop} role="presentation"><div className={styles.dialog} ref={ref} role="dialog" aria-modal="true" aria-labelledby="quote-dialog-title" aria-describedby={description ? 'quote-dialog-description' : undefined}><header><div><h2 id="quote-dialog-title">{title}</h2>{description && <p id="quote-dialog-description">{description}</p>}</div><button type="button" onClick={onClose} aria-label="Cerrar"><X size={19} /></button></header><div className={styles.dialogBody}>{children}</div><footer>{footer}</footer></div></div>;
}
