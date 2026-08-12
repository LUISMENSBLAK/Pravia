import { useEffect, useRef, type PropsWithChildren, type ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from '../Quotes.module.css';

export function QuoteDrawer({ title, subtitle, onClose, children, footer }: PropsWithChildren<{ title: string; subtitle?: string; onClose: () => void; footer?: ReactNode }>) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') ?? []);
    focusables()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const items = focusables(); const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = ''; previous?.focus(); };
  }, [onClose]);
  return <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><aside className={styles.drawer} ref={ref} role="dialog" aria-modal="true" aria-labelledby="quote-drawer-title"><header className={styles.drawerHeader}><div><h2 id="quote-drawer-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button></header><div className={styles.drawerBody}>{children}</div>{footer && <footer className={styles.drawerFooter}>{footer}</footer>}</aside></div>;
}
