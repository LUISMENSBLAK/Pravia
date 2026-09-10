import { useEffect, useState, type MouseEvent } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthProvider';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { AssistantLayer } from '../../features/assistant/components/AssistantLayer';
import styles from './AppShell.module.css';

const COLLAPSE_KEY = 'pravia.sidebar-collapsed';

export function AppShell() {
  const { user, logout, switchOrganization } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === 'true');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dataRevision, setDataRevision] = useState(0);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    const refresh = () => setDataRevision((value) => value + 1);
    window.addEventListener('pravia:data-changed', refresh);
    return () => window.removeEventListener('pravia:data-changed', refresh);
  }, []);

  if (!user) return null;

  const skipToContent = (event: MouseEvent<HTMLAnchorElement>) => {
    const main = document.getElementById('main-content');
    if (!main) return;
    event.preventDefault();
    main.focus();
    main.scrollIntoView?.({ block: 'start' });
  };

  return (
    <div className={`${styles.shell} ${collapsed ? styles.collapsed : ''}`} key={user.organization?.id || 'organization'}>
      <a className={styles.skipLink} href="#main-content" onClick={skipToContent}>Saltar al contenido</a>
      <Sidebar user={user} collapsed={collapsed} mobileOpen={mobileOpen} onToggle={() => setCollapsed((value) => !value)} onCloseMobile={() => setMobileOpen(false)} />
      <div className={styles.main}>
        <Topbar user={user} onOpenMobile={() => setMobileOpen(true)} onLogout={logout} onSwitchOrganization={switchOrganization} />
        <main className={styles.workspace} id="main-content" tabIndex={-1}><Outlet key={dataRevision} /></main>
      </div>
      <AssistantLayer mobileSidebarOpen={mobileOpen} />
    </div>
  );
}
