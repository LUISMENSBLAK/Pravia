import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import styles from './NotificationButton.module.css';

export function NotificationButton() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, []);
  return (
    <div className={styles.root} ref={rootRef}>
      <IconButton onClick={() => setOpen((value) => !value)} aria-label="Notificaciones" aria-expanded={open}>
        <Bell size={20} strokeWidth={1.8} />
      </IconButton>
      {open && <div className={styles.popover} role="status"><strong>Notificaciones</strong><p>El centro de notificaciones se conectará en una próxima fase.</p></div>}
    </div>
  );
}
