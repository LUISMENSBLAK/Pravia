import { useEffect, useRef, useState } from 'react';
import { Command, Search, X } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import styles from './GlobalSearch.module.css';

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)} aria-label="Abrir búsqueda global">
        <Search size={18} aria-hidden="true" />
        <span>Buscar expedientes, prospectos, notarías, contactos...</span>
        <kbd><Command size={12} /> K</kbd>
      </button>
      <IconButton className={styles.mobileTrigger} onClick={() => setOpen(true)} aria-label="Abrir búsqueda global">
        <Search size={20} />
      </IconButton>

      {open && (
        <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="search-title">
            <div className={styles.searchControl}>
              <Search size={20} aria-hidden="true" />
              <input ref={inputRef} aria-label="Buscar en PRAVIA OS" placeholder="Buscar en PRAVIA OS..." />
              <IconButton onClick={() => setOpen(false)} aria-label="Cerrar búsqueda"><X size={19} /></IconButton>
            </div>
            <div className={styles.empty}>
              <span id="search-title">Búsqueda global</span>
              <p>Este control está preparado para conectarse al buscador unificado en una próxima fase.</p>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
