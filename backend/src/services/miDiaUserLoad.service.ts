import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { EXPEDIENTE_MACROPHASE_STATUSES } from '../domain/expedienteReadModel';

type Actor = NonNullable<Request['user']>;
export type UserLoadResult = { count: number; items: Array<{
  id: string; nombre: string; expedientes: number; procesos: number; href: string;
}> };

/** Two separately labelled real workloads. No synthetic combined score or TEAM expansion. */
export class MiDiaUserLoadService {
  constructor(private readonly db: PrismaClient) {}

  async read(actor: Actor, options: { limit?: number; requestedUserId?: unknown }): Promise<UserLoadResult> {
    if (actor.scope !== 'GLOBAL' || !actor.permissions.includes('reportes.read')
      || !actor.permissions.includes('expedientes.read')) throw new Error('MIDIA_USER_LOAD_READ_DENIED');
    const requestedId = typeof options.requestedUserId === 'string' && options.requestedUserId !== 'TODOS'
      ? options.requestedUserId : null;
    const [members, cases] = await Promise.all([
      this.db.organizationMembership.findMany({ where: { organization_id: actor.organizationId,
        status: 'ACTIVE', user: { activo: true }, ...(requestedId ? { user_id: requestedId } : {}) },
      select: { user_id: true, user: { select: { nombre: true, apellido: true } } },
      orderBy: [{ user: { nombre: 'asc' } }, { user_id: 'asc' }] }),
      this.db.expediente.findMany({ where: {
        organization_id: actor.organizationId, archived_at: null,
        estatus: { in: [
          ...EXPEDIENTE_MACROPHASE_STATUSES.INTEGRACION,
          ...EXPEDIENTE_MACROPHASE_STATUSES.PROYECTO,
          ...EXPEDIENTE_MACROPHASE_STATUSES.FIRMA,
          ...EXPEDIENTE_MACROPHASE_STATUSES.POSTFIRMA,
        ] },
      }, select: { id: true, abogado_id: true } }),
    ]);
    const processes = await this.db.expedienteSeguimientoActividad.groupBy({ by: ['responsable_id'], where: {
        organization_id: actor.organizationId, en_alcance: true,
        estado: { in: ['NO_INICIADO', 'EN_PROCESO', 'EN_ESPERA_EXTERNA', 'BLOQUEADO'] },
        responsable_id: { not: null }, ...(requestedId ? { responsable_id: requestedId } : {}),
        expediente_id: { in: cases.map((row) => row.id) },
      }, _count: { id: true } });
    const caseByUser = new Map<string, number>();
    for (const row of cases) caseByUser.set(row.abogado_id, (caseByUser.get(row.abogado_id) ?? 0) + 1);
    const processByUser = new Map(processes.map((row) => [row.responsable_id,
      typeof row._count === 'object' ? row._count.id ?? 0 : 0]));
    return { count: members.length, items: members.slice(0, options.limit ?? 10).map((member) => ({
      id: member.user_id, nombre: `${member.user.nombre} ${member.user.apellido}`.trim(),
      expedientes: caseByUser.get(member.user_id) ?? 0,
      procesos: processByUser.get(member.user_id) ?? 0,
      href: `/reportes?view=abogados&abogado_id=${encodeURIComponent(member.user_id)}`,
    })) };
  }
}
