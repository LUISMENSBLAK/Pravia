import styles from './Skeleton.module.css';

export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`${styles.skeleton} ${className}`} aria-hidden="true" />;
}
