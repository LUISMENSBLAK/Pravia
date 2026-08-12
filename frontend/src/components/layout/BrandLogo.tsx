import styles from './BrandLogo.module.css';

export function BrandLogo({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return (
    <span className={`${styles.frame} ${compact ? styles.compact : styles.full} ${className}`}>
      <img src="/brand/pravia-os/pravia-os-logo.png" alt="PRAVIA OS — Plataforma Notarial" />
    </span>
  );
}
