import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type { MiDiaScope } from '../domain/miDiaCardCatalog';
import { resolveAssistantTimeRange, resolveAssistantUpcomingDayWindow, safeAssistantTimezone } from './assistantTime';
import { miDiaDashboardScope } from './miDiaDashboardScope';

type Actor = NonNullable<Request['user']>;
export type ComplianceCardKey = 'PLD_INCOMPLETE' | 'NOTICES_PENDING' | 'NOTICES_UPCOMING' | 'NOTICES_OVERDUE' | 'CRITICAL_ALERTS';
export type ComplianceCardResult = { count: number; items: Array<{
  id: string; folio: string; nombre: string; estado: string; href: string;
}> };

/** Reads the state persisted by Cumplimiento; Mi Día never reevaluates legal obligations. */
export class MiDiaComplianceCardsService {
  constructor(private readonly db: PrismaClient) {}

  async read(actor: Actor, key: ComplianceCardKey, options: {
    scope: MiDiaScope; requestedUserId?: unknown; limit?: number;
    window?: number; timezone?: string; now?: Date; offset?: number;
  }): Promise<ComplianceCardResult> {
    if (!actor.permissions.includes('compliance.read') || !actor.permissions.includes('expedientes.read')) {
      throw new Error('MIDIA_COMPLIANCE_READ_DENIED');
    }
    if (key === 'CRITICAL_ALERTS' && !actor.permissions.includes('ai.work.read')) {
      throw new Error('MIDIA_CRITICAL_ALERTS_READ_DENIED');
    }
    const { caseWhere } = miDiaDashboardScope(actor, options.requestedUserId, options.scope);
    if (key === 'CRITICAL_ALERTS') {
      const states = await this.db.expedienteComplianceState.findMany({
        where: { organization_id: actor.organizationId, expediente: { is: caseWhere },
          current_review_id: { not: null } },
        select: { expediente_id: true, current_review_id: true,
          expediente: { select: { numero_pravia: true } } },
      });
      if (!states.length) return { count: 0, items: [] };
      const byCase = new Map(states.map((state) => [state.expediente_id, state.expediente.numero_pravia]));
      const where: Prisma.ComplianceAlertWhereInput = {
        organization_id: actor.organizationId, level: 'CRITICA', status: 'ABIERTA',
        OR: states.flatMap((state) => state.current_review_id
          ? [{ expediente_id: state.expediente_id, review_id: state.current_review_id }] : []),
      };
      const [count, rows] = await Promise.all([
        this.db.complianceAlert.count({ where }),
        this.db.complianceAlert.findMany({ where,
          select: { id: true, expediente_id: true, message: true },
          orderBy: [{ deadline: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
          skip: Math.max(0, options.offset ?? 0), take: options.limit ?? 5 }),
      ]);
      return { count, items: rows.flatMap((row) => byCase.has(row.expediente_id)
        ? [{ id: row.id, folio: byCase.get(row.expediente_id)!, nombre: row.message,
          estado: 'CRITICA', href: `/expedientes/${row.expediente_id}#cumplimiento` }]
        : []) };
    }
    if (key !== 'PLD_INCOMPLETE') {
      const states = await this.db.expedienteComplianceState.findMany({
        where: { organization_id: actor.organizationId, expediente: { is: caseWhere },
          current_review_id: { not: null } },
        select: { expediente_id: true, current_review_id: true,
          expediente: { select: { numero_pravia: true } } },
      });
      if (!states.length) return { count: 0, items: [] };
      const byCase = new Map(states.map((state) => [state.expediente_id, state.expediente.numero_pravia]));
      const now = options.now ?? new Date();
      const timezone = safeAssistantTimezone(options.timezone);
      const today = resolveAssistantTimeRange('TODAY', timezone, now);
      const pendingStates = ['PENDIENTE', 'INFORMACION_INCOMPLETA', 'VALIDADO',
        'LISTO_PARA_PRESENTAR', 'PRESENTADO', 'ACUSE_CARGADO'] as const;
      const dueAt: Prisma.DateTimeNullableFilter<'ComplianceObligation'> | undefined = key === 'NOTICES_OVERDUE'
        ? { lt: today.from }
        : key === 'NOTICES_UPCOMING'
          ? (() => { const range = resolveAssistantUpcomingDayWindow(
            [3, 7, 15].includes(options.window ?? 7) ? options.window as 3 | 7 | 15 : 7, timezone, now);
            return { gte: range.from, lt: range.to }; })()
          : undefined;
      const where: Prisma.ComplianceObligationWhereInput = {
        organization_id: actor.organizationId, freshness: 'CURRENT',
        // Pair both IDs: independent IN lists could admit a mismatched review/case combination.
        OR: states.flatMap((state) => state.current_review_id
          ? [{ review_id: state.current_review_id, expediente_id: state.expediente_id }] : []),
        avi_state: { in: [...pendingStates] },
        ...(dueAt ? { due_at: dueAt } : {}),
      };
      const [count, rows] = await Promise.all([
        this.db.complianceObligation.count({ where }),
        this.db.complianceObligation.findMany({ where,
          select: { id: true, expediente_id: true, avi_state: true, due_at: true },
          orderBy: [{ due_at: 'asc' }, { id: 'asc' }], skip: Math.max(0, options.offset ?? 0), take: options.limit ?? 5 }),
      ]);
      const label = key === 'NOTICES_OVERDUE' ? 'Aviso vencido'
        : key === 'NOTICES_UPCOMING' ? 'Aviso por vencer' : 'Aviso pendiente';
      const formatDate = (date: Date | null) => date
        ? ` · ${new Intl.DateTimeFormat('es-MX', { timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric' }).format(date)}`
        : '';
      return { count, items: rows.flatMap((row) => row.expediente_id && byCase.has(row.expediente_id)
        ? [{ id: row.id, folio: byCase.get(row.expediente_id)!,
          nombre: `${label}${formatDate(row.due_at)}`, estado: row.avi_state,
          href: `/expedientes/${row.expediente_id}#cumplimiento` }]
        : []) };
    }
    // The same persisted state set powers Cumplimiento H8's INCOMPLETOS filter.
    const where: Prisma.ExpedienteComplianceStateWhereInput = {
      organization_id: actor.organizationId, expediente: { is: caseWhere },
      state: { in: ['PENDIENTE', 'EN_PROCESO', 'LISTO', 'VENCIDO'] },
    };
    const [count, rows] = await Promise.all([
      this.db.expedienteComplianceState.count({ where }),
      this.db.expedienteComplianceState.findMany({ where,
        select: { id: true, state: true, expediente: { select: { id: true, numero_pravia: true } } },
        orderBy: [{ updated_at: 'desc' }, { id: 'asc' }], skip: Math.max(0, options.offset ?? 0), take: options.limit ?? 5 }),
    ]);
    return { count, items: rows.map((row) => ({ id: row.id, folio: row.expediente.numero_pravia,
      nombre: 'Expediente PLD', estado: row.state, href: `/expedientes/${row.expediente.id}#cumplimiento` })) };
  }
}
