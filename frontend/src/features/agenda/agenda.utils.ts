import type { AgendaEvent, AgendaView } from './agenda.types';

export const DAY_MS = 86_400_000;
export const pad = (value: number) => String(value).padStart(2, '0');
export const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const parseDateKey = (value: string) => { const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day, 12); };
export const addDays = (date: Date, amount: number) => { const result = new Date(date); result.setDate(result.getDate() + amount); return result; };
export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
export const startOfWeek = (date: Date) => { const result = startOfDay(date); result.setDate(result.getDate() - ((result.getDay() + 6) % 7)); return result; };
export const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
export const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
export const sameDay = (left: Date, right: Date) => dateKey(left) === dateKey(right);

export const rangeForView = (date: Date, view: AgendaView) => {
  if (view === 'day') return { from: startOfDay(date), to: new Date(startOfDay(date).getTime() + DAY_MS - 1) };
  if (view === 'month') return { from: startOfWeek(startOfMonth(date)), to: new Date(addDays(startOfWeek(endOfMonth(date)), 7).getTime() - 1) };
  if (view === 'list') return { from: startOfDay(date), to: new Date(addDays(startOfDay(date), 30).getTime() - 1) };
  const from = startOfWeek(date); return { from, to: new Date(addDays(from, 7).getTime() - 1) };
};

export const formatPeriod = (date: Date, view: AgendaView) => {
  if (view === 'day') return new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  if (view === 'month') return new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(date);
  if (view === 'list') return `Desde ${new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)}`;
  const from = startOfWeek(date); const to = addDays(from, 6);
  const sameMonth = from.getMonth() === to.getMonth();
  return sameMonth
    ? `${from.getDate()}–${to.getDate()} de ${new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(to)}`
    : `${new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(from)}–${new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(to)}`;
};

export const eventEnd = (event: AgendaEvent) => new Date(event.fecha_fin || new Date(event.fecha_inicio).getTime() + 30 * 60_000);
export const eventDurationMinutes = (event: AgendaEvent) => Math.max(30, Math.round((eventEnd(event).getTime() - new Date(event.fecha_inicio).getTime()) / 60_000));
export const zonedParts = (value: Date | string, timeZone: string) => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(new Date(value)); const get=(type:Intl.DateTimeFormatPartTypes)=>Number(parts.find((part)=>part.type===type)?.value||0); return { year:get('year'),month:get('month'),day:get('day'),hour:get('hour'),minute:get('minute') }; };
export const dateKeyInZone = (value: Date | string, timeZone: string) => { const part=zonedParts(value,timeZone); return `${part.year}-${pad(part.month)}-${pad(part.day)}`; };
export const eventTime = (event: AgendaEvent, timeZone?: string) => {
  const formatter = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone?{timeZone}:{}) });
  return event.todo_el_dia ? 'Todo el día' : `${formatter.format(new Date(event.fecha_inicio))} – ${formatter.format(eventEnd(event))}`;
};
export const eventTypeLabel = (value: string) => ({ PERSONAL: 'Personal', DESPACHO: 'Despacho', FIRMA: 'Firma', AUDIENCIA: 'Audiencia', VENCIMIENTO: 'Vencimiento', CITA: 'Cita', NOTARIA: 'Notaría', SEGUIMIENTO: 'Seguimiento', OTRO: 'Otro' }[value] || value);
export const eventStatusLabel = (value: string) => ({ ACTIVO: 'Activo', COMPLETADO: 'Realizado', CANCELADO: 'Cancelado' }[value] || value.toLocaleLowerCase('es-MX'));

export const zonedLocalToIso = (date: string, time: string, timeZone: string) => {
  const [year, month, day] = date.split('-').map(Number); const [hour, minute] = time.split(':').map(Number);
  const tentative = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(tentative));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  const represented = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(tentative - (represented - tentative)).toISOString();
};

const rangesOverlap = (first: { start: Date; end: Date }, second: { start: Date; end: Date }) => first.start < second.end && second.start < first.end;

export const layoutOverlaps = (events: AgendaEvent[]) => {
  const sorted = [...events].sort((a, b) => new Date(a.fecha_inicio).getTime() - new Date(b.fecha_inicio).getTime());
  const active: Array<{ end: number; lane: number }> = [];
  const placed = sorted.map((event) => {
    const start = new Date(event.fecha_inicio).getTime();
    for (let index = active.length - 1; index >= 0; index -= 1) if (active[index].end <= start) active.splice(index, 1);
    const used = new Set(active.map((item) => item.lane)); let lane = 0; while (used.has(lane)) lane += 1;
    active.push({ end: eventEnd(event).getTime(), lane });
    return { event, lane };
  });
  return placed.map((item) => ({ ...item, lanes: Math.max(1, ...placed.filter((candidate) => rangesOverlap({ start: new Date(item.event.fecha_inicio), end: eventEnd(item.event) }, { start: new Date(candidate.event.fecha_inicio), end: eventEnd(candidate.event) })).map((candidate) => candidate.lane + 1)) }));
};
