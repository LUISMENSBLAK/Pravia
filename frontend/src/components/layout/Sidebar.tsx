import type { LucideIcon } from 'lucide-react';
import {
  CalendarDays, Calculator, ChartNoAxesColumnIncreasing, CircleDollarSign, ContactRound, FileText,
  FolderClosed, Landmark, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck, Sun, UsersRound,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { BrandLogo } from './BrandLogo';
import { Tooltip } from '../ui/Tooltip';
import styles from './Sidebar.module.css';
import type { SessionUser } from '../../features/auth/auth.types';

type NavItem = { label: string; to: string; icon: LucideIcon };

const navigation: NavItem[] = [
  { label: 'Mi Día', to: '/mi-dia', icon: Sun },
  { label: 'Prospectos', to: '/prospectos', icon: UsersRound },
  { label: 'Cotizaciones', to: '/cotizaciones', icon: FileText },
  { label: 'Expedientes', to: '/expedientes', icon: FolderClosed },
  { label: 'Notarías', to: '/notarias', icon: Landmark },
  { label: 'Comparecientes', to: '/comparecientes', icon: ContactRound },
  { label: 'Finanzas', to: '/finanzas', icon: CircleDollarSign },
  { label: 'Agenda', to: '/agenda', icon: CalendarDays },
  { label: 'Reportes', to: '/reportes', icon: ChartNoAxesColumnIncreasing },
  { label: 'Cálculo ISR', to: '/calculo-isr', icon: Calculator },
  { label: 'Riesgos / UIF', to: '/riesgos', icon: ShieldCheck },
];

function SidebarLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate: () => void }) {
  const Icon = item.icon;
  return (
    <Tooltip label={item.label} disabled={!collapsed}>
      <NavLink
        to={item.to}
        onClick={onNavigate}
        className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
      >
        <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
        <span className={styles.label}>{item.label}</span>
      </NavLink>
    </Tooltip>
  );
}

type SidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggle: () => void;
  onCloseMobile: () => void;
  user?: SessionUser | null;
};

export function Sidebar({ collapsed, mobileOpen, onToggle, onCloseMobile, user }: SidebarProps) {
  const localISRFixture = import.meta.env.DEV && window.location.pathname.startsWith('/calculo-isr') && new URLSearchParams(window.location.search).get('visual') === '1';
  const visibleNavigation = navigation.filter((item) => {
    if (!user?.permissions) return true;
    if (item.to === '/finanzas') return user.permissions.includes('finanzas.read');
    if (item.to === '/reportes') return user.permissions.includes('reportes.read');
    if (item.to === '/calculo-isr') return localISRFixture || user.permissions.includes('isr.read');
    if (item.to === '/riesgos') return user.permissions.some((permission) => ['compliance.read', 'cumplimiento.read'].includes(permission));
    return true;
  });
  return (
    <>
      <button
        type="button"
        className={`${styles.backdrop} ${mobileOpen ? styles.backdropVisible : ''}`}
        onClick={onCloseMobile}
        aria-label="Cerrar navegación"
        tabIndex={mobileOpen ? 0 : -1}
      />
      <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''} ${mobileOpen ? styles.mobileOpen : ''}`} aria-label="Navegación principal">
        <div className={styles.brand}>
          <BrandLogo className={styles.fullBrandLogo} />
          <BrandLogo compact className={styles.compactBrandLogo} />
        </div>

        <nav className={styles.nav}>
          {visibleNavigation.map((item) => <SidebarLink key={item.to} item={item} collapsed={collapsed} onNavigate={onCloseMobile} />)}
        </nav>

        <div className={styles.footer}>
          <Tooltip label="Configuración" disabled={!collapsed}>
            <NavLink to="/configuracion" onClick={onCloseMobile} className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}>
              <Settings size={20} strokeWidth={1.8} aria-hidden="true" />
              <span className={styles.label}>Configuración</span>
            </NavLink>
          </Tooltip>
          <button type="button" className={`${styles.link} ${styles.collapseButton}`} onClick={onToggle} aria-label={collapsed ? 'Expandir navegación' : 'Colapsar navegación'}>
            {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
            <span className={styles.label}>Colapsar navegación</span>
          </button>
        </div>
      </aside>
    </>
  );
}
