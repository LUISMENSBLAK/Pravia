import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellRing, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IconButton } from '../ui/IconButton';
import { settingsService } from '../../features/settings/settings.service';
import type { NotificationItem } from '../../features/settings/settings.types';
import { browserNotificationSupport, requestBrowserNotifications, showBrowserNotification, type BrowserNotificationSupport } from '../../features/notifications/browserNotifications';
import styles from './NotificationButton.module.css';

export function NotificationButton() {
  const [open, setOpen] = useState(false); const [items, setItems] = useState<NotificationItem[]>([]); const [unread, setUnread] = useState(0); const [loading, setLoading] = useState(false);
  const [browserPermission, setBrowserPermission] = useState<BrowserNotificationSupport>(() => browserNotificationSupport());
  const rootRef = useRef<HTMLDivElement>(null); const navigate = useNavigate();
  const initialized = useRef(false); const delivered = useRef(new Set<string>()); const signature = useRef('');
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, []);
  const load = useCallback(() => {
    setLoading(true);
    settingsService.notifications().then((payload) => {
      const active = payload.notifications.filter((item) => item.status === 'ACTIVE');
      const nextSignature = active.map((item) => `${item.id}:${item.last_reminder_at || item.updated_at || item.created_at}:${item.read_at || ''}`).join('|');
      setItems(active.slice(0, 5)); setUnread(payload.unread);
      if (initialized.current && nextSignature !== signature.current) {
        window.dispatchEvent(new CustomEvent('pravia:notifications-changed', { detail: { unread: payload.unread } }));
      }
      if (initialized.current) {
        active.filter((item) => !item.read_at).forEach((item) => {
          const deliveryKey = `${item.id}:${item.last_reminder_at || item.created_at}`;
          if (!delivered.current.has(deliveryKey)) { delivered.current.add(deliveryKey); void showBrowserNotification(item); }
        });
      } else {
        active.forEach((item) => delivered.current.add(`${item.id}:${item.last_reminder_at || item.created_at}`));
      }
      initialized.current = true; signature.current = nextSignature;
    }).catch(() => undefined).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load(); const timer = window.setInterval(load, 30_000);
    const refresh = () => load(); window.addEventListener('pravia:data-changed', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('pravia:data-changed', refresh); };
  }, [load]);
  const toggle = () => { setOpen((value) => !value); if (!open) load(); };
  const openItem = async (item: NotificationItem) => { if (!item.read_at) await settingsService.readNotification(item.id); setOpen(false); if (item.href) navigate(item.href); else navigate('/configuracion/notificaciones'); };
  const enableBrowserNotifications = async () => setBrowserPermission(await requestBrowserNotifications());
  return <div className={styles.root} ref={rootRef}>
    <IconButton onClick={toggle} aria-label={`${unread} notificaciones sin leer`} aria-expanded={open}><Bell size={20} strokeWidth={1.8} />{unread > 0 && <span className={styles.count}>{unread > 9 ? '9+' : unread}</span>}</IconButton>
    {open && <div className={styles.popover} role="dialog" aria-label="Notificaciones"><header><strong>Notificaciones</strong>{unread > 0 && <button onClick={async () => { await settingsService.readAllNotifications(); load(); }} aria-label="Marcar todas como leídas"><CheckCheck size={16} /></button>}</header>{browserPermission === 'default' && <button className={styles.permission} type="button" onClick={() => void enableBrowserNotifications()}><BellRing size={15} />Activar avisos del navegador</button>}{browserPermission === 'denied' && <p className={styles.permissionDenied}>Los avisos del navegador están bloqueados. El centro interno seguirá funcionando.</p>}<div aria-live="polite">{loading && !items.length ? <p>Cargando…</p> : items.length ? <div className={styles.items}>{items.map((item) => <button key={item.id} className={!item.read_at ? styles.unread : ''} onClick={() => openItem(item)}><span className={styles.itemTop}><strong>{item.title}</strong><i data-priority={item.priority}>{item.priority === 'URGENT' ? 'Urgente' : item.priority === 'IMPORTANT' ? 'Importante' : 'Aviso'}</i></span><small>{item.body}</small></button>)}</div> : <p>No tienes notificaciones activas.</p>}</div><button className={styles.all} onClick={() => { setOpen(false); navigate('/configuracion/notificaciones'); }}>Ver centro de notificaciones</button></div>}
  </div>;
}
