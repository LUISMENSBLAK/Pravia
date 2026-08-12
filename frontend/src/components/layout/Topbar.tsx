import { Menu } from 'lucide-react';
import type { SessionUser } from '../../features/auth/auth.types';
import { IconButton } from '../ui/IconButton';
import { BrandLogo } from './BrandLogo';
import { GlobalSearch } from './GlobalSearch';
import { NotificationButton } from './NotificationButton';
import { UserMenu } from './UserMenu';
import styles from './Topbar.module.css';

type TopbarProps = { user: SessionUser; onOpenMobile: () => void; onLogout: () => Promise<void> };

export function Topbar({ user, onOpenMobile, onLogout }: TopbarProps) {
  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <IconButton className={styles.menuButton} onClick={onOpenMobile} aria-label="Abrir navegación"><Menu size={21} /></IconButton>
        <BrandLogo className={styles.mobileLogo} />
        <GlobalSearch />
      </div>
      <div className={styles.actions}>
        <NotificationButton />
        <span className={styles.divider} aria-hidden="true" />
        <UserMenu user={user} onLogout={onLogout} />
      </div>
    </header>
  );
}
