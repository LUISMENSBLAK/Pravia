import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import styles from './Input.module.css';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  leadingIcon?: ReactNode;
  trailingAction?: ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, leadingIcon, trailingAction, id, className = '', ...props }, ref,
) {
  const inputId = id ?? props.name;
  const errorId = error && inputId ? `${inputId}-error` : undefined;
  return (
    <div className={`${styles.field} ${className}`}>
      <label className={styles.label} htmlFor={inputId}>{label}</label>
      <div className={`${styles.control} ${error ? styles.invalid : ''}`}>
        {leadingIcon && <span className={styles.leading}>{leadingIcon}</span>}
        <input ref={ref} id={inputId} className={styles.input} aria-invalid={Boolean(error)} aria-describedby={errorId} {...props} />
        {trailingAction && <span className={styles.trailing}>{trailingAction}</span>}
      </div>
      {error && <span id={errorId} className={styles.error} role="alert">{error}</span>}
    </div>
  );
});
