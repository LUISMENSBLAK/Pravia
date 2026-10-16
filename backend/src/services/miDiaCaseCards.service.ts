import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type { MiDiaScope } from '../domain/miDiaCardCatalog';
import { miDiaDashboardScope } from './miDiaDashboardScope';
import { MiDiaProcessCardsService } from './miDiaProcessCards.service';
import { EXPEDIENTE_MACROPHASE_STATUSES } from '../domain/expedienteReadModel';

type Actor = NonNullable<Request['user']>;
export type CaseCardKey = 'CASES_INACTIVE' | 'CASES_DELAYED' | 'CASES_BLOCKED' | 'POSTSIGN_PENDING' | 'DELIVERIES_PENDING' | 'MY_ACTIVE_CASES';
export type CaseCardResult = { count: number; items: Array<{
  id: string; folio: string; cliente: string | null; estado: string;
  contexto: string | null; href: string;
}> };

export class MiDiaCaseCardsService {
  constructor(private readonly prisma: PrismaClient) {}

  async read(actor: Actor, key: CaseCardKey, options: {
    scope: MiDiaScope; requestedUserId?: unknown; window?: number; limit?: number; offset?: number; now?: Date;
  }): Promise<CaseCardResult> {
    if (!actor.permissions.includes('expedientes.read')) return { count: 0, items: [] };
    const now = options.now ?? new Date();
    const { caseWhere } = miDiaDashboardScope(actor,
      key === 'MY_ACTIVE_CASES' ? undefined : options.requestedUserId,
      key === 'MY_ACTIVE_CASES' ? 'OWN' : options.scope);
    let condition: Prisma.ExpedienteWhereInput;
    if (key === 'CASES_INACTIVE') {
      const cutoff = new Date(now);
      cutoff.setUTCDate(cutoff.getUTCDate() - (options.window ?? 7));
      condition = { created_at: { lt: cutoff }, estatus: { notIn: ['ENTREGADO', 'CANCELADO'] },
        actividades: { none: { organization_id: actor.organizationId, created_at: { gte: cutoff } } } };
    } else if (key === 'CASES_BLOCKED') {
      condition = { OR: [{ estatus: 'SUSPENDIDO' }, { tareas_externas: { some: { estatus: 'BLOQUEADA' } } }] };
    } else if (key === 'POSTSIGN_PENDING') {
      const pendingPostsign = await this.prisma.expedienteSeguimientoActividad.findMany({
        where: { organization_id: actor.organizationId, en_alcance: true,
          estado: { in: ['NO_INICIADO', 'EN_PROCESO', 'EN_ESPERA_EXTERNA', 'BLOQUEADO'] },
          fecha_completada_actual: null,
          etapa_nombre_snapshot: { equals: 'Postfirma', mode: 'insensitive' } },
        select: { expediente_id: true }, distinct: ['expediente_id'],
      });
      condition = { id: { in: pendingPostsign.map((item) => item.expediente_id) },
        estatus: { in: ['FIRMADO', 'POST_FIRMA'] }, fecha_real_firma: { not: null } };
    } else if (key === 'DELIVERIES_PENDING') {
      condition = { estatus: 'LISTO_ENTREGA', fecha_entrega_cliente: null };
    } else if (key === 'MY_ACTIVE_CASES') {
      condition = { abogado_id: actor.id, estatus: { in: [
        ...EXPEDIENTE_MACROPHASE_STATUSES.INTEGRACION,
        ...EXPEDIENTE_MACROPHASE_STATUSES.PROYECTO,
        ...EXPEDIENTE_MACROPHASE_STATUSES.FIRMA,
        ...EXPEDIENTE_MACROPHASE_STATUSES.POSTFIRMA,
      ] } };
    } else {
      const overdue = await new MiDiaProcessCardsService(this.prisma).read(actor, 'OVERDUE_PROCESSES', {
        scope: 'ORGANIZATION', now, limit: Number.MAX_SAFE_INTEGER,
      });
      condition = { id: { in: [...new Set(overdue.items.map((item) => item.expediente_id))] } };
    }
    const where: Prisma.ExpedienteWhereInput = { AND: [caseWhere, condition] };
    const [count, rows] = await Promise.all([
      this.prisma.expediente.count({ where }),
      this.prisma.expediente.findMany({ where,
        select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true,
          actividades: { where: { organization_id: actor.organizationId }, orderBy: { created_at: 'desc' }, take: 1,
            select: { created_at: true } },
          tareas_externas: { where: { estatus: 'BLOQUEADA' }, take: 1, select: { descripcion: true } },
        },
        orderBy: key === 'CASES_INACTIVE' ? { created_at: 'asc' } : { updated_at: 'desc' },
        skip: Math.max(0, options.offset ?? 0),
        take: options.limit ?? 5,
      }),
    ]);
    return { count, items: rows.map((row) => ({
      id: row.id, folio: row.numero_pravia, cliente: row.cliente_alias, estado: row.estatus,
      contexto: key === 'CASES_INACTIVE' ? row.actividades[0]?.created_at?.toISOString() ?? null
        : key === 'CASES_BLOCKED' ? row.tareas_externas[0]?.descripcion ?? null : null,
      href: key === 'MY_ACTIVE_CASES' ? `/expedientes/${row.id}`
        : `/expedientes/${row.id}#${key === 'CASES_INACTIVE' ? 'actividad' : 'seguimiento'}`,
    })) };
  }
}
