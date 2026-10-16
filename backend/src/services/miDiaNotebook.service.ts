import type { Request } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import { NOTARIA_WEEK_DAYS, type NotariaWeekDay, type NotariaWeeklySchedule } from '../domain/notariaConfiguration';
import { MiDiaConfigurationError } from './miDiaConfiguration.service';
import { miDiaDashboardScope } from './miDiaDashboardScope';
import { resolveReportingPeriod } from '../domain/reportingCore';

type Actor = NonNullable<Request['user']>;
type TaskInput = Record<string, unknown>;
const dayMs = 86_400_000;
const iso = (day: Date) => day.toISOString().slice(0, 10);
const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);

function parseDay(value: unknown, fallback?: string) {
  const raw = String(value ?? fallback ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || iso(dateOnly(raw)) !== raw) {
    throw new MiDiaConfigurationError(400, 'MIDIA_DATE_INVALID', 'La fecha debe ser real y usar AAAA-MM-DD.');
  }
  return raw;
}

function todayIn(timezone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return iso(now);
  }
}

function isWorkingDay(day: string, schedule: NotariaWeeklySchedule | null) {
  const weekday = NOTARIA_WEEK_DAYS[(dateOnly(day).getUTCDay() + 6) % 7] as NotariaWeekDay;
  const configured = schedule?.[weekday];
  if (configured) return configured.cerrado === false;
  return weekday !== 'sabado' && weekday !== 'domingo';
}

function nextWorkingDay(day: string, schedule: NotariaWeeklySchedule | null) {
  let next = dateOnly(day);
  for (let tries = 0; tries < 14; tries++) {
    next = new Date(next.getTime() + dayMs);
    if (isWorkingDay(iso(next), schedule)) return iso(next);
  }
  throw new MiDiaConfigurationError(409, 'MIDIA_CALENDAR_CLOSED', 'No hay un día operativo disponible en el calendario de la notaría.');
}

export class MiDiaNotebookService {
  constructor(private readonly db: PrismaClient) {}

  private async context(actor: Actor, now = new Date()) {
    const [prefs, notary] = await Promise.all([
      this.db.userPreference.findUnique({ where: { user_id: actor.id }, select: { timezone: true } }),
      this.db.notaria.findFirst({ where: { organization_id: actor.organizationId, activa: true, archived_at: null, predeterminada: true }, select: { horario_semanal: true }, orderBy: { created_at: 'asc' } }),
    ]);
    const today = todayIn(prefs?.timezone || 'America/Mexico_City', now);
    const raw = notary?.horario_semanal;
    const schedule = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as NotariaWeeklySchedule : null;
    return { today, schedule, timezone: prefs?.timezone || 'America/Mexico_City' };
  }

  private async carry(actor: Actor, today: string, schedule: NotariaWeeklySchedule | null) {
    // El cursor por id no cambia al reprogramar effective_on. Una sola página
    // dejaría pendientes antiguos sin arrastrar cuando hay más de 500 tareas.
    let afterId: string | undefined;
    for (;;) {
      const overdue = await this.db.miDiaPersonalTask.findMany({ where: {
        organization_id: actor.organizationId, user_id: actor.id, completed_at: null, canceled_at: null,
        effective_on: { lt: dateOnly(today) }, ...(afterId ? { id: { gt: afterId } } : {}),
      }, orderBy: { id: 'asc' }, take: 500 });
      if (!overdue.length) break;
      for (const task of overdue) {
      const from = iso(task.effective_on);
      let cursor = from;
      const entries = Array.isArray(task.carry_history) ? [...task.carry_history] : [];
      while (cursor < today) {
        const next = nextWorkingDay(cursor, schedule);
        if (next > today) break;
        entries.push({ from: cursor, to: next });
        cursor = next;
      }
      if (cursor !== from) await this.db.$transaction(async (tx) => {
        const result = await tx.miDiaPersonalTask.updateMany({ where: {
          id: task.id, organization_id: actor.organizationId, user_id: actor.id, effective_on: task.effective_on,
          completed_at: null, canceled_at: null,
        }, data: { effective_on: dateOnly(cursor), carry_history: entries as Prisma.InputJsonValue } });
        if (result.count) await this.audit(tx, actor, task.id, 'CARRY_MI_DIA_TASK', { from, to: cursor, carry_history: entries });
      });
      }
      afterId = overdue[overdue.length - 1].id;
      if (overdue.length < 500) break;
    }
  }

  async list(actor: Actor, query: Record<string, unknown>, now = new Date()) {
    const { today, schedule, timezone } = await this.context(actor, now);
    await this.carry(actor, today, schedule);
    const requested = parseDay(query.date, today);
    const view = String(query.view ?? 'DAY');
    if (!['DAY', 'UPCOMING', 'HISTORY'].includes(view)) throw new MiDiaConfigurationError(400, 'MIDIA_VIEW_INVALID', 'La vista no es válida.');
    const where: Prisma.MiDiaPersonalTaskWhereInput = {
      organization_id: actor.organizationId, user_id: actor.id,
      ...(view === 'UPCOMING' ? { effective_on: { gt: dateOnly(today) }, completed_at: null, canceled_at: null } :
        view === 'HISTORY' ? { OR: [{ completed_at: { not: null } }, { canceled_at: { not: null } }] } : {}),
    };
    const matchesDay = (row: { original_on: Date; effective_on: Date; carry_history: Prisma.JsonValue }) => {
      const days = [iso(row.original_on), iso(row.effective_on), ...(Array.isArray(row.carry_history) ? row.carry_history.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const move = entry as Record<string, unknown>;
        return [String(move.from ?? ''), String(move.to ?? '')];
      }) : [])];
      return days.includes(requested);
    };
    const tasks: Awaited<ReturnType<typeof this.db.miDiaPersonalTask.findMany>> = [];
    let afterId: string | undefined;
    for (;;) {
      const rows = await this.db.miDiaPersonalTask.findMany({ where,
        orderBy: [{ effective_on: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
        ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}), take: 500,
      });
      tasks.push(...(view === 'DAY' ? rows.filter(matchesDay) : rows));
      if (tasks.length > 500 || rows.length < 500) break;
      afterId = rows[rows.length - 1].id;
    }
    // Las tareas del sistema se proyectan desde su fuente; nunca se copian a
    // MiDiaPersonalTask ni se completan desde esta libreta.
    const system = actor.permissions?.includes('expedientes.read')
      ? await this.systemItems(actor, view, requested, today, timezone) : { items: [], hasMore: false };
    return { today, selected: requested, view, tasks: tasks.slice(0, 500), hasMore: tasks.length > 500,
      systemItems: system.items, systemHasMore: system.hasMore };
  }

  private async systemItems(actor: Actor, view: string, requested: string, today: string, timezone: string) {
    const selectedRange = resolveReportingPeriod({ periodo: 'PERSONALIZADO', fecha_desde: requested,
      fecha_hasta: requested, timezone });
    const todayRange = resolveReportingPeriod({ periodo: 'PERSONALIZADO', fecha_desde: today,
      fecha_hasta: today, timezone });
    const { taskWhere } = miDiaDashboardScope(actor, undefined, 'OWN');
    const rows = await this.db.tarea.findMany({ where: {
      AND: [taskWhere, { expediente_id: { not: null } },
        view === 'HISTORY' ? { estatus: 'COMPLETADA', fecha_completada: { not: null } }
          : { estatus: { in: ['PENDIENTE', 'EN_PROCESO'] }, fecha_limite: view === 'UPCOMING'
            ? { gt: todayRange.to } : { gte: selectedRange.from, lte: selectedRange.to } }],
    }, select: { id: true, titulo: true, estatus: true, expediente_id: true, fecha_limite: true,
      fecha_completada: true }, orderBy: [{ fecha_limite: 'asc' }, { id: 'asc' }], take: 101 });
    return { items: rows.slice(0, 100).map((task) => ({ id: task.id, origin: 'SYSTEM' as const, title: task.titulo,
      status: task.estatus, dueAt: task.fecha_limite, completedAt: task.fecha_completada,
      href: `/expedientes/${task.expediente_id}#seguimiento` })), hasMore: rows.length > 100 };
  }

  async create(actor: Actor, input: TaskInput, now = new Date()) {
    const { today } = await this.context(actor, now);
    const title = String(input.title ?? '').trim();
    if (!title || title.length > 300) throw new MiDiaConfigurationError(400, 'MIDIA_TITLE_INVALID', 'Escribe un título de hasta 300 caracteres.');
    const notes = input.notes == null ? null : String(input.notes).trim();
    if (notes && notes.length > 20_000) throw new MiDiaConfigurationError(400, 'MIDIA_NOTES_INVALID', 'La nota es demasiado larga.');
    const planned = parseDay(input.date, today);
    return this.db.$transaction(async (tx) => {
      const row = await tx.miDiaPersonalTask.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, title, notes,
        original_on: dateOnly(planned), effective_on: dateOnly(planned), carry_history: [],
      } });
      await this.audit(tx, actor, row.id, 'CREATE_MI_DIA_TASK', { date: planned, title });
      return row;
    });
  }

  async update(actor: Actor, id: string, input: TaskInput) {
    return this.db.$transaction(async (tx) => {
      const row = await tx.miDiaPersonalTask.findFirst({ where: { id, organization_id: actor.organizationId, user_id: actor.id } });
      if (!row) throw new MiDiaConfigurationError(404, 'MIDIA_TASK_NOT_FOUND', 'La tarea no existe.');
      const data: Prisma.MiDiaPersonalTaskUpdateInput = {};
      if (input.title !== undefined) {
        const title = String(input.title).trim();
        if (!title || title.length > 300) throw new MiDiaConfigurationError(400, 'MIDIA_TITLE_INVALID', 'Escribe un título de hasta 300 caracteres.');
        data.title = title;
      }
      if (input.notes !== undefined) {
        const notes = input.notes == null ? null : String(input.notes).trim();
        if (notes && notes.length > 20_000) throw new MiDiaConfigurationError(400, 'MIDIA_NOTES_INVALID', 'La nota es demasiado larga.');
        data.notes = notes;
      }
      if (input.date !== undefined) {
        const next = parseDay(input.date);
        const previous = iso(row.effective_on);
        data.effective_on = dateOnly(next);
        if (next !== previous) {
          const history = Array.isArray(row.carry_history) ? [...row.carry_history] : [];
          history.push({ from: previous, to: next, reason: 'MANUAL_RESCHEDULE', at: new Date().toISOString() });
          data.carry_history = history as Prisma.InputJsonValue;
        }
      }
      if (input.completed === true && !row.completed_at) data.completed_at = new Date();
      if (input.completed === false) data.completed_at = null;
      if (input.canceled === true) data.canceled_at = new Date();
      const updated = await tx.miDiaPersonalTask.update({ where: {
        id: row.id, organization_id: actor.organizationId, user_id: actor.id,
      }, data });
      await this.audit(tx, actor, row.id, 'UPDATE_MI_DIA_TASK', { fields: Object.keys(data) });
      return updated;
    });
  }

  private audit(tx: Prisma.TransactionClient, actor: Actor, id: string, accion: string, values: Record<string, unknown>) {
    return tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id,
      accion, entidad: 'MiDiaPersonalTask', entidad_id: id, valores_nuevos: values as Prisma.InputJsonValue } });
  }
}
