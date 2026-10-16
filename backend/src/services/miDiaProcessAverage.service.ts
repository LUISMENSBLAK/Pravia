import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { miDiaPeriodRange, type MiDiaPeriod } from '../domain/miDiaPeriod';
import type { MiDiaScope } from '../domain/miDiaCardCatalog';
import { miDiaDashboardScope } from './miDiaDashboardScope';
import { operationalDaysBetween } from './expedienteSeguimiento.service';

type Actor = NonNullable<Request['user']>;
export type ProcessAverageResult = { count: number; items: Array<{
  key: string; nombre: string; unidad: 'HABILES' | 'NATURALES';
  promedio_dias: number; procesos: number; href: string;
}> };

/** Completed EXP-005 facts only; a missing start/end cannot contribute a made-up duration. */
export class MiDiaProcessAverageService {
  constructor(private readonly db: PrismaClient) {}

  async read(actor: Actor, options: { scope: MiDiaScope; requestedUserId?: unknown;
    period?: MiDiaPeriod; timezone?: string; now?: Date; limit?: number }): Promise<ProcessAverageResult> {
    if (!actor.permissions.includes('expedientes.read')) throw new Error('MIDIA_PROCESS_AVERAGE_READ_DENIED');
    const { from, to } = miDiaPeriodRange(options.period ?? 'MONTH', options.timezone, options.now);
    // EXP-005 has its own responsible. Case access remains an additional object boundary.
    const { caseWhere } = miDiaDashboardScope(actor, undefined, 'ORGANIZATION');
    const cases = await this.db.expediente.findMany({ where: caseWhere, select: { id: true } });
    if (!cases.length) return { count: 0, items: [] };
    const selectedUserId = actor.scope === 'GLOBAL' && options.scope === 'ORGANIZATION'
      && typeof options.requestedUserId === 'string' && options.requestedUserId !== 'TODOS'
      ? options.requestedUserId : null;
    const rows = await this.db.expedienteSeguimientoActividad.findMany({ where: {
      organization_id: actor.organizationId, expediente_id: { in: cases.map((item) => item.id) }, en_alcance: true,
      estado: 'COMPLETADO', primera_fecha_inicio: { not: null },
      fecha_completada_actual: { gte: from, lt: to },
      ...(options.scope === 'OWN' || actor.scope !== 'GLOBAL'
        ? { responsable_id: actor.id } : selectedUserId ? { responsable_id: selectedUserId } : {}),
    }, select: { id: true, expediente_id: true, proceso_clave: true,
      actividad_nombre_snapshot: true, tipo_dias: true, excepcion_operativa: true,
      primera_fecha_inicio: true, fecha_completada_actual: true },
    orderBy: [{ fecha_completada_actual: 'desc' }, { id: 'asc' }] });
    const groups = new Map<string, { key: string; nombre: string; unidad: 'HABILES' | 'NATURALES';
      sum: number; count: number; href: string }>();
    let count = 0;
    for (const row of rows) {
      if (!row.primera_fecha_inicio || !row.fecha_completada_actual
        || row.fecha_completada_actual < row.primera_fecha_inicio) continue;
      const override = row.excepcion_operativa && typeof row.excepcion_operativa === 'object'
        && !Array.isArray(row.excepcion_operativa) ? row.excepcion_operativa as Record<string, unknown> : {};
      const unidad = override.tipo_dias === 'HABILES' || override.tipo_dias === 'NATURALES'
        ? override.tipo_dias : row.tipo_dias;
      const key = `${row.proceso_clave}:${unidad}`;
      const current = groups.get(key) ?? { key, nombre: row.actividad_nombre_snapshot, unidad,
        sum: 0, count: 0,
        href: `/expedientes/${row.expediente_id}?process_id=${row.id}#seguimiento` };
      current.sum += operationalDaysBetween(row.primera_fecha_inicio, row.fecha_completada_actual, unidad);
      current.count += 1;
      groups.set(key, current);
      count += 1;
    }
    return { count, items: [...groups.values()].sort((a, b) => b.count - a.count
      || a.nombre.localeCompare(b.nombre) || a.key.localeCompare(b.key))
      .slice(0, options.limit ?? 10).map(({ sum, count: processes, ...item }) => ({
        ...item, procesos: processes, promedio_dias: Math.round(sum / processes * 10) / 10,
      })) };
  }
}
