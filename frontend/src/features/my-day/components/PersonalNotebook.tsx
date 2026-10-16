import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './WidgetCard';
import { miDiaNotebookService, type PersonalTask, type SystemTask } from '../miDiaNotebook.service';
import styles from './PersonalNotebook.module.css';

type View = 'DAY' | 'UPCOMING' | 'HISTORY';
const shiftDay = (day: string, amount: number) => {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

export function PersonalNotebook({ className = '' }: { className?: string }) {
  const [date, setDate] = useState('');
  const [today, setToday] = useState('');
  const [view, setView] = useState<View>('DAY');
  const [tasks, setTasks] = useState<PersonalTask[]>([]);
  const [systemItems, setSystemItems] = useState<SystemTask[]>([]);
  const [systemHasMore, setSystemHasMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const result = await miDiaNotebookService.list(date || undefined, view, signal);
      if (signal?.aborted) return;
      setTasks(result.tasks);
      setSystemItems(result.systemItems ?? []);
      setSystemHasMore(result.systemHasMore ?? false);
      setHasMore(result.hasMore);
      setToday(result.today);
      if (!date) setDate(result.selected);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la libreta.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [date, view]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !date || saving) return;
    setSaving(true); setError('');
    try {
      await miDiaNotebookService.create(title.trim(), date);
      setTitle('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la tarea.');
    } finally { setSaving(false); }
  };

  const setCompleted = async (task: PersonalTask, completed: boolean) => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      await miDiaNotebookService.update(task.id, { completed });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la tarea.');
    } finally { setSaving(false); }
  };

  return <WidgetCard title="Agenda personal" className={className} action={<span className={styles.source}>Libreta privada</span>}>
    <div className={styles.controls}>
      <div className={styles.views} aria-label="Vista de la libreta">
        {([['DAY', 'Día'], ['UPCOMING', 'Próximas'], ['HISTORY', 'Historial']] as const).map(([key, label]) =>
          <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}
      </div>
      {view === 'DAY' && <div className={styles.dateControls}>
        <button type="button" aria-label="Día anterior" onClick={() => setDate((value) => shiftDay(value, -1))} disabled={!date}><ChevronLeft size={17} /></button>
        <input aria-label="Fecha de la libreta" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <button type="button" aria-label="Día siguiente" onClick={() => setDate((value) => shiftDay(value, 1))} disabled={!date}><ChevronRight size={17} /></button>
        {today && date !== today && <button type="button" onClick={() => setDate(today)}>Hoy</button>}
      </div>}
    </div>
    {loading ? <WidgetLoading rows={3} /> : error ? <WidgetError message={error} onRetry={() => void load()} /> : tasks.length === 0 ?
      <WidgetEmpty>{view === 'DAY' ? 'No hay tareas personales para este día.' : view === 'UPCOMING' ? 'No hay tareas futuras.' : 'Aún no hay tareas realizadas o canceladas.'}</WidgetEmpty> :
      <ul className={styles.list}>{tasks.map((task) => <li key={task.id}>
        <label className={styles.task}>
          <input type="checkbox" checked={Boolean(task.completed_at)} disabled={saving || Boolean(task.canceled_at)} onChange={(event) => void setCompleted(task, event.target.checked)} />
          <span className={task.completed_at ? styles.done : ''}>{task.title}</span>
        </label>
        {task.original_on.slice(0, 10) !== task.effective_on.slice(0, 10) && <small>Programada originalmente: {task.original_on.slice(0, 10)}</small>}
        {task.completed_at && <small>Realizada: {new Date(task.completed_at).toLocaleString('es-MX')}</small>}
      </li>)}</ul>}
    {hasMore && <p className={styles.more}>Hay más tareas fuera de este lote. La lista no está completa.</p>}
    {!loading && !error && systemItems.length > 0 && <div className={styles.systemSection}>
      <strong>Del sistema · solo lectura</strong>
      <ul className={styles.list}>{systemItems.map((item) => <li key={item.id}>
        <Link to={item.href}>{item.title}</Link>
        <small>Abre la tarea en su expediente; su estado se modifica sólo en el origen.</small>
      </li>)}</ul>
    </div>}
    {!loading && !error && systemHasMore && <p className={styles.more}>Hay más tareas del sistema en la fuente; esta vista muestra sólo las primeras 100.</p>}
    {view === 'DAY' && <form className={styles.addForm} onSubmit={(event) => void add(event)}>
      <input aria-label="Nueva tarea personal" placeholder="Agregar algo por hacer" maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} />
      <button type="submit" disabled={!title.trim() || !date || saving}><Plus size={16} />Agregar</button>
    </form>}
  </WidgetCard>;
}
