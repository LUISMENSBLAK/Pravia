import { useEffect, useRef, type PropsWithChildren, type ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from '../ProspectsPage.module.css';

export function DrawerShell({ title, subtitle, onClose, children, footer }: PropsWithChildren<{ title: string; subtitle?: string; onClose: () => void; footer?: ReactNode }>) {
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    const focusables = () => Array.from(drawer?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') ?? []);
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add(styles.drawerOpen);
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.classList.remove(styles.drawerOpen); previous?.focus(); };
  }, [onClose]);
  return (
    <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside className={styles.drawer} ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className={styles.drawerHeader}><div><h2 id="drawer-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button></header>
        <div className={styles.drawerBody}>{children}</div>{footer && <footer className={styles.drawerFooter}>{footer}</footer>}
      </aside>
    </div>
  );
}
