import { CalendarDays } from 'lucide-react';
import styles from './MyDayHeader.module.css';

const greeting = (date: Date) => {
  const hour = date.getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
};

export function MyDayHeader({ name, dateValue }: { name: string; dateValue?: string }) {
  const parsedDate = dateValue ? new Date(dateValue) : new Date();
  const date = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
  const firstName = name.trim().split(/\s+/)[0] ?? name;
  const formatted = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);

  return (
    <header className={styles.header}>
      <div>
        <h1>¡{greeting(date)}, {firstName}!</h1>
        <p>Aquí tienes el resumen de lo más importante para hoy.</p>
      </div>
      <time className={styles.date} dateTime={date.toISOString()}><CalendarDays size={17} aria-hidden="true" />{formatted}</time>
    </header>
  );
}
