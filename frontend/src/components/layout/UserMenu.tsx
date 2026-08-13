import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { SessionUser } from '../../features/auth/auth.types';
import { humanizeRole } from '../../lib/formatters';
import { Avatar } from '../ui/Avatar';
import styles from './UserMenu.module.css';

export function UserMenu({ user, onLogout }: { user: SessionUser; onLogout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, []);

  const logout = async () => {
    setLeaving(true);
    try { await onLogout(); } finally { setLeaving(false); }
  };
  const go = (path: string) => { setOpen(false); navigate(path); };

  return (
    <div className={styles.root} ref={rootRef}>
      <button className={styles.trigger} type="button" onClick={() => setOpen((value) => !value)} aria-label={`Menú de usuario de ${user.name}`} aria-expanded={open} aria-haspopup="menu">
        <Avatar name={user.name} />
        <span className={styles.summary}>
          <strong>{user.name}</strong>
          <small>{user.notary ?? (user.role ? humanizeRole(user.role) : user.email)}</small>
        </span>
        <ChevronDown className={open ? styles.chevronOpen : ''} size={17} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.identity}>
            <strong>{user.name}</strong>
            {user.email && <span>{user.email}</span>}
          </div>
          <button type="button" role="menuitem" onClick={() => go('/configuracion/perfil')}><UserRound size={17} />Mi perfil</button>
          <button type="button" role="menuitem" onClick={() => go('/configuracion/seguridad')}><ShieldCheck size={17} />Seguridad y sesiones</button>
          <button type="button" role="menuitem" onClick={() => go('/configuracion')}><Settings size={17} />Configuración</button>
          <span className={styles.separator} />
          <button type="button" role="menuitem" onClick={logout} disabled={leaving}>
            <LogOut size={17} aria-hidden="true" />
            {leaving ? 'Cerrando sesión…' : 'Cerrar sesión'}
          </button>
        </div>
      )}
    </div>
  );
}
