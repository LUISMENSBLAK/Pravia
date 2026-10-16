import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { miDiaPeriodRange, type MiDiaPeriod } from '../domain/miDiaPeriod';
import type { MiDiaScope } from '../domain/miDiaCardCatalog';
import { miDiaDashboardScope } from './miDiaDashboardScope';

type Actor = NonNullable<Request['user']>;
export type SigningAverageResult = { count: number; promedio_dias_naturales: number | null;
  items: Array<{ id: string; folio: string; dias_naturales: number; href: string }> };
const DAY_MS = 86_400_000;
const round = (value: number) => Math.round(value * 10) / 10;

/** Actual elapsed time from recorded case opening to actual signing, never an SLA or estimate. */
export class MiDiaSigningAverageService {
  constructor(private readonly db: PrismaClient) {}

  async read(actor: Actor, options: { scope: MiDiaScope; requestedUserId?: unknown;
    period?: MiDiaPeriod; timezone?: string; now?: Date; limit?: number }): Promise<SigningAverageResult> {
    if (!actor.permissions.includes('expedientes.read')) throw new Error('MIDIA_SIGNING_AVERAGE_READ_DENIED');
    const { caseWhere } = miDiaDashboardScope(actor, options.requestedUserId, options.scope);
    const { from, to } = miDiaPeriodRange(options.period ?? 'MONTH', options.timezone, options.now);
    const where: Prisma.ExpedienteWhereInput = { AND: [caseWhere,
      { fecha_real_firma: { gte: from, lt: to } }] };
    const rows = await this.db.expediente.findMany({ where,
      select: { id: true, numero_pravia: true, fecha_apertura: true, fecha_real_firma: true },
      orderBy: [{ fecha_real_firma: 'desc' }, { id: 'asc' }] });
    const valid = rows.flatMap((row) => {
      if (!row.fecha_real_firma || row.fecha_real_firma < row.fecha_apertura) return [];
      return [{ id: row.id, folio: row.numero_pravia,
        exactDays: (row.fecha_real_firma.getTime() - row.fecha_apertura.getTime()) / DAY_MS,
        href: `/expedientes/${row.id}#seguimiento` }];
    });
    return { count: valid.length,
      promedio_dias_naturales: valid.length ? round(valid.reduce((sum, row) => sum + row.exactDays, 0) / valid.length) : null,
      items: valid.slice(0, options.limit ?? 5).map(({ exactDays, ...row }) => ({ ...row, dias_naturales: round(exactDays) })) };
  }
}
