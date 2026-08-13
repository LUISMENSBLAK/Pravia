import { AlertTriangle, CheckCircle2, CircleDot, Clock3, ListTodo } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { agendaService } from './agenda.service';
import type { AgendaCatalogs, AgendaEvent, AgendaTask, AgendaView } from './agenda.types';
import { addDays, dateKey, parseDateKey, rangeForView } from './agenda.utils';
import { AgendaHeader } from './components/AgendaHeader';
import { AgendaList } from './components/AgendaList';
import { DayCalendar } from './components/DayCalendar';
import { EventDrawer } from './components/EventDrawer';
import { MiniCalendar } from './components/MiniCalendar';
import { MonthCalendar } from './components/MonthCalendar';
import { NewEventFlow } from './components/NewEventFlow';
import { TeamFilters } from './components/TeamFilters';
import { UpcomingEvents } from './components/UpcomingEvents';
import { WeekCalendar } from './components/WeekCalendar';
import styles from './Agenda.module.css';

type LoadStatus = 'loading' | 'ready' | 'error';
const storedView = (): AgendaView => {
  const saved = window.localStorage.getItem('pravia-agenda-view') as AgendaView | null;
  if (saved && ['day', 'week', 'month', 'list'].includes(saved)) return saved;
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches ? 'day' : 'week';
};

const moveDate = (date: Date, view: AgendaView, amount: number) => {
  if (view === 'month') return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
  return addDays(date, amount * (view === 'week' ? 7 : view === 'list' ? 30 : 1));
};

export function AgendaPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryDate = new URLSearchParams(location.search).get('date');
  const [date, setDateState] = useState(() => queryDate ? parseDateKey(queryDate) : new Date());
  const [view, setViewState] = useState<AgendaView>(storedView);
  const [catalogs, setCatalogs] = useState<AgendaCatalogs | null>(null);
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [tasks, setTasks] = useState<AgendaTask[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<AgendaEvent | null>(null);
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState('');
  const selectedEventId = new URLSearchParams(location.hash.replace(/^#/, '')).get('evento');
  const range = useMemo(() => rangeForView(date, view), [date, view]);

  const setDate = useCallback((next: Date) => {
    setDateState(next);
    const params = new URLSearchParams(location.search);
    params.set('date', dateKey(next));
    navigate({ pathname: '/agenda', search: params.toString(), hash: location.hash }, { replace: true });
  }, [location.hash, location.search, navigate]);

  const setView = (next: AgendaView) => {
    setViewState(next);
    window.localStorage.setItem('pravia-agenda-view', next);
  };

  useEffect(() => {
    const controller = new AbortController();
    agendaService.catalogs(controller.signal).then(setCatalogs).catch(() => setStatus('error'));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!catalogs) return;
    const controller = new AbortController();
    setStatus('loading');
    Promise.all([
      agendaService.list(range.from, range.to, undefined, controller.signal),
      agendaService.tasks(undefined, controller.signal),
    ]).then(([calendar, taskResult]) => {
      setEvents(calendar.eventos);
      setTasks(taskResult.tareas);
      setStatus('ready');
    }).catch((reason) => { if (reason?.name !== 'AbortError') setStatus('error'); });
    return () => controller.abort();
  }, [catalogs, range.from.getTime(), range.to.getTime(), revision]);

  const visibleEvents = useMemo(() => selectedUsers.length
    ? events.filter((event) => event.user_id && selectedUsers.includes(event.user_id))
    : events, [events, selectedUsers]);
  const visibleTasks = useMemo(() => selectedUsers.length
    ? tasks.filter((task) => selectedUsers.includes(task.asignado_a.id))
    : tasks, [tasks, selectedUsers]);
  const upcoming = useMemo(() => visibleEvents
    .filter((event) => event.estatus === 'ACTIVO' && new Date(event.fecha_inicio) >= new Date())
    .sort((left, right) => +new Date(left.fecha_inicio) - +new Date(right.fecha_inicio)), [visibleEvents]);
  const currentUserId = user?.id || '';
  const canWrite = Boolean(catalogs?.permisos.escribir);

  const openEvent = (event: AgendaEvent) => navigate({ pathname: '/agenda', search: location.search, hash: `evento=${event.id}` }, { replace: true });
  const closeEvent = () => navigate({ pathname: '/agenda', search: location.search }, { replace: true });
  const changed = () => setRevision((value) => value + 1);
  const saved = () => {
    setNewOpen(false); setEditing(null); changed(); setToast('Evento guardado correctamente.');
    window.setTimeout(() => setToast(''), 2600);
  };

  return <main className={styles.agendaPage}>
    <AgendaHeader date={date} view={view} canWrite={canWrite} onView={setView} onMove={(amount) => setDate(moveDate(date, view, amount))} onToday={() => setDate(new Date())} onNew={() => { setEditing(null); setNewOpen(true); }} />
    {status === 'loading' && <div className={styles.agendaLoading} aria-label="Cargando agenda"><span /><div><i /><i /><i /></div></div>}
    {status === 'error' && <section className={styles.agendaError} role="alert"><span><AlertTriangle /></span><h2>No pudimos cargar la agenda.</h2><p>Conservamos tus filtros. Intenta nuevamente.</p><button type="button" className={styles.secondaryButton} onClick={changed}>Reintentar</button></section>}
    {status === 'ready' && catalogs && <div className={styles.agendaLayout}>
      <aside className={styles.leftRail}>
        <MiniCalendar selected={date} onSelect={setDate} />
        <TeamFilters users={catalogs.usuarios} selected={selectedUsers} canManage={catalogs.permisos.gestionar_equipo} onChange={setSelectedUsers} />
        <section className={styles.tasksPanel}><header><ListTodo size={17} /><div><h2>Tareas por vencer</h2><p>Separadas de los eventos</p></div></header>
          {visibleTasks.length ? <ol>{visibleTasks.slice(0, 4).map((task) => <li key={task.id}><span>{task.estatus === 'COMPLETADA' ? <CheckCircle2 /> : <CircleDot />}</span><div><strong>{task.titulo}</strong><small>{task.expediente?.numero_pravia || 'Sin expediente'}{task.fecha_limite ? ` · ${new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(new Date(task.fecha_limite))}` : ''}</small></div><em data-priority={task.prioridad}>{task.prioridad}</em></li>)}</ol> : <p className={styles.railEmpty}>No hay tareas dentro de tu alcance.</p>}
        </section>
      </aside>
      <section className={styles.calendarCard}>
        <div className={styles.timezoneNote}><Clock3 size={13} />Zona horaria: {catalogs.timezone}</div>
        {view === 'week' && <WeekCalendar date={date} events={visibleEvents} timezone={catalogs.timezone} onOpen={openEvent} />}
        {view === 'day' && <DayCalendar date={date} events={visibleEvents} timezone={catalogs.timezone} canWrite={canWrite} onOpen={openEvent} onNew={() => setNewOpen(true)} />}
        {view === 'month' && <MonthCalendar date={date} events={visibleEvents} timezone={catalogs.timezone} onDay={(next) => { setDate(next); setView('day'); }} onOpen={openEvent} />}
        {view === 'list' && <AgendaList events={visibleEvents} timezone={catalogs.timezone} canWrite={canWrite} onOpen={openEvent} onNew={() => setNewOpen(true)} />}
      </section>
      <UpcomingEvents events={upcoming} timezone={catalogs.timezone} onOpen={openEvent} onAll={() => setView('list')} />
    </div>}
    {catalogs && newOpen && <NewEventFlow catalogs={catalogs} date={date} currentUserId={currentUserId} initial={editing} onClose={() => { setNewOpen(false); setEditing(null); }} onSaved={saved} />}
    {catalogs && selectedEventId && <EventDrawer id={selectedEventId} canWrite={canWrite} timezone={catalogs.timezone} onClose={closeEvent} onChanged={changed} onEdit={(event) => { closeEvent(); setEditing(event); setNewOpen(true); }} />}
    <div className={`${styles.toast} ${toast ? styles.toastVisible : ''}`} role="status">{toast}</div>
  </main>;
}
