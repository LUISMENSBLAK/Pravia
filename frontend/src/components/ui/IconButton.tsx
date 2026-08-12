import type { ButtonHTMLAttributes } from 'react';
import styles from './IconButton.module.css';

export function IconButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`${styles.button} ${className}`} {...props} />;
}
