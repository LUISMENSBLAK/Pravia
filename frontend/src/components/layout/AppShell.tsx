import { useEffect, useState } from 'react';
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

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, String(collapsed));
  }, [collapsed]);

  if (!user) return null;

  return (
    <div className={`${styles.shell} ${collapsed ? styles.collapsed : ''}`} key={user.organization?.id || 'organization'}>
      <a className={styles.skipLink} href="#main-content">Saltar al contenido</a>
      <Sidebar user={user} collapsed={collapsed} mobileOpen={mobileOpen} onToggle={() => setCollapsed((value) => !value)} onCloseMobile={() => setMobileOpen(false)} />
      <div className={styles.main}>
        <Topbar user={user} onOpenMobile={() => setMobileOpen(true)} onLogout={logout} onSwitchOrganization={switchOrganization} />
        <main className={styles.workspace} id="main-content"><Outlet /></main>
      </div>
      <AssistantLayer mobileSidebarOpen={mobileOpen} />
    </div>
  );
}
