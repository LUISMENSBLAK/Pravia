import { Menu } from 'lucide-react';
import type { SessionUser } from '../../features/auth/auth.types';
import { IconButton } from '../ui/IconButton';
import { BrandLogo } from './BrandLogo';
import { GlobalSearch } from './GlobalSearch';
import { NotificationButton } from './NotificationButton';
import { UserMenu } from './UserMenu';
import styles from './Topbar.module.css';

type TopbarProps = { user: SessionUser; onOpenMobile: () => void; onLogout: () => Promise<void>; onSwitchOrganization: (organizationId: string) => Promise<void> };

export function Topbar({ user, onOpenMobile, onLogout, onSwitchOrganization }: TopbarProps) {
  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <IconButton className={styles.menuButton} onClick={onOpenMobile} aria-label="Abrir navegación"><Menu size={21} /></IconButton>
        <BrandLogo className={styles.mobileLogo} />
        <GlobalSearch />
      </div>
      <div className={styles.actions}>
        {(user.organizations?.length || 0) > 1 && <label className={styles.organizationPicker}>
          <span>Organización</span>
          <select value={user.organization?.id || ''} onChange={(event) => void onSwitchOrganization(event.target.value)}>
            {user.organizations!.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>}
        <NotificationButton />
        <span className={styles.divider} aria-hidden="true" />
        <UserMenu user={user} onLogout={onLogout} />
      </div>
    </header>
  );
}
