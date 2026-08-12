import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  fullWidth?: boolean;
};

export function Button({ variant = 'primary', fullWidth = false, className = '', ...props }: ButtonProps) {
  return <button className={`${styles.button} ${styles[variant]} ${fullWidth ? styles.fullWidth : ''} ${className}`} {...props} />;
}
