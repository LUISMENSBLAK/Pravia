import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../../../components/ui/IconButton';
import { Tooltip } from '../../../components/ui/Tooltip';
import styles from './Catalogs.module.css';

export function CatalogModal({ title, description, children, onClose }: { title: string; description?: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const modal = ref.current;
    const initialFocus = modal?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
      ?? modal?.querySelector<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    initialFocus?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key !== 'Tab' || !modal) return;
      const items = [...modal.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((item) => !item.hasAttribute('disabled'));
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="catalog-modal-title" aria-describedby={description ? 'catalog-modal-description' : undefined}>
      <header className={styles.modalHeader}>
        <div><h2 id="catalog-modal-title">{title}</h2>{description && <p id="catalog-modal-description">{description}</p>}</div>
        <Tooltip label="Cerrar" placement="left"><IconButton type="button" className={styles.closeButton} onClick={onClose} aria-label="Cerrar diálogo"><X size={18} /></IconButton></Tooltip>
      </header>
      <div className={styles.modalBody}>{children}</div>
    </section>
  </div>;
}
