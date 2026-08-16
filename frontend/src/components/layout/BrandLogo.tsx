import styles from './BrandLogo.module.css';

export function BrandLogo({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return (
    <span className={`${styles.frame} ${compact ? styles.compact : styles.full} ${className}`}>
      <img
        src={compact ? '/brand/pravia-os/pravia-os-isotipo.png' : '/brand/pravia-os/pravia-os-lockup.png'}
        alt={compact ? 'PRAVIA OS' : 'PRAVIA OS — Plataforma Notarial'}
      />
    </span>
  );
}
