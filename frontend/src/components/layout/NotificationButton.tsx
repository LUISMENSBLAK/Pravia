import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IconButton } from '../ui/IconButton';
import { settingsService } from '../../features/settings/settings.service';
import type { NotificationItem } from '../../features/settings/settings.types';
import styles from './NotificationButton.module.css';

export function NotificationButton() {
  const [open, setOpen] = useState(false); const [items, setItems] = useState<NotificationItem[]>([]); const [unread, setUnread] = useState(0); const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null); const navigate = useNavigate();
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, []);
  const load = () => { setLoading(true); settingsService.notifications().then((payload) => { setItems(payload.notifications.slice(0, 5)); setUnread(payload.unread); }).catch(() => undefined).finally(() => setLoading(false)); };
  useEffect(() => { load(); const timer = window.setInterval(load, 60_000); return () => window.clearInterval(timer); }, []);
  const toggle = () => { setOpen((value) => !value); if (!open) load(); };
  const openItem = async (item: NotificationItem) => { if (!item.read_at) await settingsService.readNotification(item.id); setOpen(false); if (item.href) navigate(item.href); else navigate('/configuracion/notificaciones'); };
  return <div className={styles.root} ref={rootRef}>
    <IconButton onClick={toggle} aria-label={`${unread} notificaciones sin leer`} aria-expanded={open}><Bell size={20} strokeWidth={1.8} />{unread > 0 && <span className={styles.count}>{unread > 9 ? '9+' : unread}</span>}</IconButton>
    {open && <div className={styles.popover}><header><strong>Notificaciones</strong>{unread > 0 && <button onClick={async () => { await settingsService.readAllNotifications(); load(); }} aria-label="Marcar todas como leídas"><CheckCheck size={16} /></button>}</header>{loading && !items.length ? <p>Cargando…</p> : items.length ? <div className={styles.items}>{items.map((item) => <button key={item.id} className={!item.read_at ? styles.unread : ''} onClick={() => openItem(item)}><strong>{item.title}</strong><small>{item.body}</small></button>)}</div> : <p>No tienes notificaciones.</p>}<button className={styles.all} onClick={() => { setOpen(false); navigate('/configuracion/notificaciones'); }}>Ver centro de notificaciones</button></div>}
  </div>;
}
