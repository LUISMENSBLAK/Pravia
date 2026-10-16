import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { formatRemainingBusinessDays, isDependencySatisfied } from './expedienteSeguimiento.service';
import { miDiaDashboardScope } from './miDiaDashboardScope';
import type { MiDiaScope } from '../domain/miDiaCardCatalog';

type Actor = NonNullable<Request['user']>;
export type ProcessCardKey = 'MY_PENDING' | 'OVERDUE_PROCESSES' | 'DUE_TODAY' | 'UPCOMING_DUE'
  | 'CATASTRO_PENDING' | 'RPP_PENDING' | 'TESTIMONIES_PENDING' | 'CAN_ADVANCE_TODAY';
export type ProcessCardItem = {
  id: string; expediente_id: string; folio: string; nombre: string;
  estado: string; responsable_id: string | null; fecha_objetivo: Date | null;
  dias_restantes: number | null; href: string;
};
export type ProcessCardResult = { count: number; items: ProcessCardItem[] };

const activeStates = ['NO_INICIADO', 'EN_PROCESO', 'EN_ESPERA_EXTERNA', 'BLOQUEADO'] as const;
const processCodes: Partial<Record<ProcessCardKey, string[]>> = {
  CATASTRO_PENDING: ['SOLVENCIA_INGRESO', 'SOLVENCIA_OBTENCION'],
  RPP_PENDING: ['RPP_INGRESO', 'RPP_OBTENCION'],
  TESTIMONIES_PENDING: ['ARMADO_TESTIMONIO'],
};
const day = (value: Date) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

/** Read-only adapter over EXP-005 snapshots. It never advances a process or infers a missing due date. */
export class MiDiaProcessCardsService {
  constructor(private readonly prisma: PrismaClient) {}

  async read(actor: Actor, key: ProcessCardKey, options: {
    scope: MiDiaScope; requestedUserId?: unknown; limit?: number; offset?: number; window?: number; now?: Date;
  }): Promise<ProcessCardResult> {
    if (!actor.permissions.includes('expedientes.read')) return { count: 0, items: [] };
    if (key === 'CAN_ADVANCE_TODAY'
      && (!actor.permissions.includes('expedientes.write') || !actor.permissions.includes('ai.work.read'))) {
      throw new Error('MIDIA_PROCESS_ACTION_READ_DENIED');
    }
    // The process owner, not the case's lawyer/creator, defines OWN for this source.
    // The underlying object-access boundary remains in force for non-global actors.
    const { caseWhere } = miDiaDashboardScope(actor, undefined, 'ORGANIZATION');
    const selectedUserId = actor.scope === 'GLOBAL' && options.scope === 'ORGANIZATION'
      && typeof options.requestedUserId === 'string' && options.requestedUserId !== 'TODOS'
      ? options.requestedUserId : null;
    const categoryCodes = processCodes[key];
    const cases = await this.prisma.expediente.findMany({
      where: categoryCodes && key === 'TESTIMONIES_PENDING'
        ? { AND: [caseWhere, { estatus: { notIn: ['ENTREGADO', 'CANCELADO'] }, fecha_entrega_cliente: null }] }
        : caseWhere,
      select: { id: true, numero_pravia: true },
    });
    if (!cases.length) return { count: 0, items: [] };
    const caseById = new Map(cases.map((item) => [item.id, item.numero_pravia]));
    const where: Prisma.ExpedienteSeguimientoActividadWhereInput = {
      organization_id: actor.organizationId, expediente_id: { in: cases.map((item) => item.id) },
      en_alcance: true, estado: { in: [...activeStates] },
      ...(categoryCodes ? { fecha_completada_actual: null,
        concepto_maestro: { is: { organization_id: actor.organizationId, codigo: { in: categoryCodes } } } } : {}),
      ...((options.scope === 'OWN' || actor.scope !== 'GLOBAL')
        ? { responsable_id: actor.id } : selectedUserId ? { responsable_id: selectedUserId } : {}),
    };
    const activities = await this.prisma.expedienteSeguimientoActividad.findMany({
      where, select: { id: true, expediente_id: true, actividad_nombre_snapshot: true,
        estado: true, responsable_id: true, primera_fecha_inicio: true, duracion_estimada: true,
        excepcion_operativa: true, fecha_objetivo_proyectada: true },
    });
    if (!activities.length) return { count: 0, items: [] };
    const dependencies = await this.prisma.expedienteSeguimientoDependencia.findMany({
      where: { organization_id: actor.organizationId, actividad_id: { in: activities.map((item) => item.id) }, bloqueante: true },
      select: { actividad_id: true, depende_actividad_id: true },
    });
    const dependencyStates = dependencies.length ? await this.prisma.expedienteSeguimientoActividad.findMany({
      where: { organization_id: actor.organizationId, id: { in: dependencies.map((item) => item.depende_actividad_id) } },
      select: { id: true, estado: true },
    }) : [];
    const stateById = new Map(dependencyStates.map((item) => [item.id, item.estado]));
    const blocked = new Set(dependencies.filter((item) => !isDependencySatisfied(stateById.get(item.depende_actividad_id)))
      .map((item) => item.actividad_id));
    const now = options.now ?? new Date();
    const today = day(now);
    const windowEndDate = new Date(now);
    windowEndDate.setUTCDate(windowEndDate.getUTCDate() + (options.window ?? 7));
    const windowEnd = day(windowEndDate);
    const matching = activities.flatMap((activity): ProcessCardItem[] => {
      const isBlocked = activity.estado === 'BLOQUEADO' || blocked.has(activity.id);
      if (key === 'CAN_ADVANCE_TODAY' && (isBlocked
        || !['NO_INICIADO', 'EN_PROCESO', 'EN_ESPERA_EXTERNA'].includes(activity.estado))) return [];
      const override = activity.excepcion_operativa && typeof activity.excepcion_operativa === 'object' && !Array.isArray(activity.excepcion_operativa)
        ? activity.excepcion_operativa as Record<string, unknown> : {};
      const duration = Number.isInteger(override.duracion_estimada) ? Number(override.duracion_estimada) : activity.duracion_estimada;
      const remaining = isBlocked ? null : formatRemainingBusinessDays(activity.primera_fecha_inicio, duration, now);
      const due = remaining?.due ?? null;
      const dueDay = due ? day(due) : null;
      const matches = key === 'MY_PENDING' || key === 'CAN_ADVANCE_TODAY' || categoryCodes ? true
        : key === 'OVERDUE_PROCESSES' ? dueDay !== null && dueDay < today
          : key === 'DUE_TODAY' ? dueDay === today
            : dueDay !== null && dueDay > today && dueDay <= windowEnd;
      if (!matches) return [];
      return [{ id: activity.id, expediente_id: activity.expediente_id,
        folio: caseById.get(activity.expediente_id) ?? 'Expediente', nombre: activity.actividad_nombre_snapshot,
        estado: isBlocked ? 'BLOQUEADO' : activity.estado, responsable_id: activity.responsable_id,
        fecha_objetivo: due, dias_restantes: remaining?.value ?? null,
        href: `/expedientes/${activity.expediente_id}?process_id=${activity.id}#seguimiento` }];
    }).sort((a, b) => (a.fecha_objetivo?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.fecha_objetivo?.getTime() ?? Number.MAX_SAFE_INTEGER)
      || a.folio.localeCompare(b.folio) || a.id.localeCompare(b.id));
    const offset = Math.max(0, options.offset ?? 0);
    return { count: matching.length, items: matching.slice(offset, offset + (options.limit ?? 10)) };
  }
}
