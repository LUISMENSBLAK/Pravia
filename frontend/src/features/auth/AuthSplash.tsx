import styles from './AuthSplash.module.css';

export function AuthSplash() {
  return (
    <div className={styles.splash} role="status" aria-label="Validando sesión">
      <div className={styles.mark} aria-hidden="true" />
      <span>Preparando PRAVIA OS</span>
    </div>
  );
}
