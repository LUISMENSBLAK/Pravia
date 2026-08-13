import { TipoEvento } from '@prisma/client';

type AgendaActor = { id: string; rol: string } | null | undefined;

export function canManageAgendaTeam(actor: AgendaActor) {
  return Boolean(actor && ['DIRECCION', 'ADMINISTRACION'].includes(actor.rol));
}

export function canAssignAgendaResponsibility(actor: AgendaActor, requestedResponsibleId: unknown) {
  if (!actor) return false;
  const responsibleId = String(requestedResponsibleId || actor.id);
  return canManageAgendaTeam(actor) || responsibleId === actor.id;
}

export const AGENDA_EVENT_TYPES: TipoEvento[] = [
  'PERSONAL',
  'DESPACHO',
  'FIRMA',
  'AUDIENCIA',
  'VENCIMIENTO',
  'CITA',
  'NOTARIA',
  'SEGUIMIENTO',
  'OTRO',
];

export const AGENDA_TIME_ZONE = process.env.AGENDA_TIME_ZONE || 'America/Mexico_City';

export class AgendaError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
  }
}

export function normalizeAgendaType(value: unknown): TipoEvento {
  const normalized = String(value || '').trim().toUpperCase();
  if (!AGENDA_EVENT_TYPES.includes(normalized as TipoEvento)) {
    throw new AgendaError('Selecciona un tipo de evento válido.', 'AGENDA_TYPE_INVALID');
  }
  return normalized as TipoEvento;
}

export function parseAgendaRange(input: {
  fechaInicio: unknown;
  fechaFin?: unknown;
  todoElDia?: boolean;
}) {
  const parseDate = (value: unknown, message: string, code: string) => {
    if (value instanceof Date) return new Date(value);
    const source = String(value || '').trim();
    if (source && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(source)) {
      throw new AgendaError('Indica la fecha y hora con una zona horaria explícita.', 'AGENDA_TIMEZONE_REQUIRED');
    }
    const parsed = new Date(source);
    if (Number.isNaN(parsed.getTime())) throw new AgendaError(message, code);
    return parsed;
  };
  const start = parseDate(input.fechaInicio, 'La fecha de inicio no es válida.', 'AGENDA_START_INVALID');
  const end = input.fechaFin ? parseDate(input.fechaFin, 'La fecha final no es válida.', 'AGENDA_END_INVALID') : null;
  if (end && end.getTime() < start.getTime()) {
    throw new AgendaError('La fecha final no puede ser anterior al inicio.', 'AGENDA_RANGE_INVALID');
  }
  const maxDuration = 366 * 24 * 60 * 60 * 1000;
  if (end && end.getTime() - start.getTime() > maxDuration) {
    throw new AgendaError('Un evento no puede abarcar más de un año.', 'AGENDA_RANGE_TOO_LONG');
  }
  return { start, end, allDay: Boolean(input.todoElDia) };
}

export function agendaRangesOverlap(
  first: { start: Date; end?: Date | null },
  second: { start: Date; end?: Date | null },
) {
  const defaultDuration = 30 * 60 * 1000;
  const firstEnd = first.end || new Date(first.start.getTime() + defaultDuration);
  const secondEnd = second.end || new Date(second.start.getTime() + defaultDuration);
  return first.start < secondEnd && second.start < firstEnd;
}

export function normalizeReminders(value: unknown): number[] {
  if (value === undefined || value === null || value === '') return [];
  const raw = Array.isArray(value) ? value : [value];
  const unique = [...new Set(raw.map(Number))];
  if (unique.some((minutes) => !Number.isInteger(minutes) || minutes < 0 || minutes > 43_200)) {
    throw new AgendaError('Los recordatorios deben expresarse en minutos, entre 0 y 43,200.', 'AGENDA_REMINDER_INVALID');
  }
  return unique.sort((a, b) => a - b);
}
