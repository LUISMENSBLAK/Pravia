import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type { MiDiaScope } from '../domain/miDiaCardCatalog';
import { ComplianceH6Service } from './complianceH6.service';
import { miDiaDashboardScope } from './miDiaDashboardScope';
import type { CaseCardResult } from './miDiaCaseCards.service';
import { miDiaPeriodRange, type MiDiaPeriod } from '../domain/miDiaPeriod';

type Actor = NonNullable<Request['user']>;
export type SignatureCardKey = 'READY_TO_SIGN' | 'NOT_READY_TO_SIGN' | 'SIGNED_TODAY' | 'SIGNED_PERIOD' | 'SIGNED_CASES';
export type SignaturePeriod = MiDiaPeriod;

/** Uses the same H6 preflight that authorizes the canonical FIRMADO transition. */
export class MiDiaSignatureCardsService {
  constructor(private readonly prisma: PrismaClient) {}

  async read(actor: Actor, key: SignatureCardKey, options: {
    scope: MiDiaScope; requestedUserId?: unknown; window?: number; limit?: number; offset?: number; now?: Date; period?: SignaturePeriod; timezone?: string;
  }): Promise<CaseCardResult> {
    if (!actor.permissions.includes('expedientes.read')) return { count: 0, items: [] };
    const { caseWhere } = miDiaDashboardScope(actor, options.requestedUserId, options.scope);
    const now = options.now ?? new Date();
    if (key === 'SIGNED_TODAY' || key === 'SIGNED_PERIOD' || key === 'SIGNED_CASES') {
      const { from, to } = miDiaPeriodRange(key === 'SIGNED_TODAY' ? 'TODAY' : options.period ?? 'MONTH', options.timezone, now);
      const where: Prisma.ExpedienteWhereInput = { AND: [caseWhere,
        { fecha_real_firma: { gte: from, lt: to } }] };
      const [count, rows] = await Promise.all([
        this.prisma.expediente.count({ where }),
        this.prisma.expediente.findMany({ where, select: { id: true, numero_pravia: true,
          cliente_alias: true, estatus: true, fecha_real_firma: true },
          orderBy: [{ fecha_real_firma: 'desc' }, { id: 'asc' }],
          skip: Math.max(0, options.offset ?? 0), take: options.limit ?? 5 }),
      ]);
      return { count, items: rows.map((item) => ({ id: item.id, folio: item.numero_pravia,
        cliente: item.cliente_alias, estado: item.estatus,
        contexto: item.fecha_real_firma ? `Firma: ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(item.fecha_real_firma)}` : null,
        href: `/expedientes/${item.id}#seguimiento`,
      })) };
    }
    const windowEnd = new Date(now);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + (options.window ?? 7));
    const condition: Prisma.ExpedienteWhereInput = {
      estatus: 'FIRMA_PROGRAMADA', fecha_real_firma: null,
      ...(key === 'NOT_READY_TO_SIGN' ? { fecha_estimada_firma: { gte: now, lte: windowEnd } } : {}),
    };
    const candidates = await this.prisma.expediente.findMany({
      where: { AND: [caseWhere, condition] },
      select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true,
        version: true, fecha_estimada_firma: true },
      orderBy: [{ fecha_estimada_firma: 'asc' }, { id: 'asc' }],
    });
    const matches: CaseCardResult['items'] = [];
    for (let offset = 0; offset < candidates.length; offset += 8) {
      const evaluated = await Promise.all(candidates.slice(offset, offset + 8).map(async (item) => ({
        item, preflight: await ComplianceH6Service.firPreflightTx(
          this.prisma as unknown as Prisma.TransactionClient, actor.organizationId, item.id, item.version),
      })));
      for (const { item, preflight } of evaluated) {
        if (preflight.ready !== (key === 'READY_TO_SIGN')) continue;
        matches.push({ id: item.id, folio: item.numero_pravia, cliente: item.cliente_alias,
          estado: item.estatus, contexto: item.fecha_estimada_firma
            ? `Firma programada: ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(item.fecha_estimada_firma)}` : null,
          href: `/expedientes/${item.id}#seguimiento`,
        });
      }
    }
    const offset = Math.max(0, options.offset ?? 0);
    return { count: matches.length, items: matches.slice(offset, offset + (options.limit ?? 5)) };
  }
}
