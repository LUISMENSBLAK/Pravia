import styles from './Avatar.module.css';

const initials = (name: string) => name
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase())
  .join('') || 'U';

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return <span className={`${styles.avatar} ${styles[size]}`} aria-hidden="true">{initials(name)}</span>;
}
