import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { activeOrganizationMembershipWhere, organizationMembershipRoleSelect, usersWithEffectiveMembershipRoles } from '../auth/organizationMembership';
import { AGENDA_TIME_ZONE } from '../domain/agenda';
import type { CanonicalMovement, EconomicNature } from '../domain/financeCore';
import {
  canonicalFeeCohortTotals,
  reportFinancialTotals,
  reportingCalendarRanges,
  reportingMonthRange,
  resolveReportingPeriod,
  sortAndLimitEconomicRows,
  targetProgress,
  type ReportingPeriod,
} from '../domain/reportingCore';
import { expedienteAccessWhere } from '../middleware/auth.middleware';

type AuthUser = NonNullable<Request['user']>;
type ReportQuery = {
  periodo?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
  abogado_id?: string;
  notaria_id?: string;
  page?: string;
  page_size?: string;
};
type TargetInput = {
  alcance?: string;
  usuario_id?: string;
  periodo_inicio?: string;
  periodo_fin?: string;
  importe?: number | string;
  base?: string;
  moneda?: string;
};
type ReportContext = ReturnType<ReportingService['context']>;

const applied = ['APLICADO', 'RECIBIDO', 'VALIDADO'];
const n = (value: unknown) => Number(value || 0);
const cents = (value: number) => Math.round(value * 100);
const money = (value: number) => cents(value) / 100;
const positiveInteger = (value: unknown, fallback: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};
const person = (user?: { nombre: string; apellido: string } | null) => user ? `${user.nombre} ${user.apellido}`.trim() : 'Sin responsable';
const inRange = (date: Date | null | undefined, from: Date, to: Date) => Boolean(date && date >= from && date <= to);

export class ReportingService {
  constructor(private db: PrismaClient) {}

  context(user: AuthUser, query: ReportQuery) {
    const period = resolveReportingPeriod({ ...query, timezone: AGENDA_TIME_ZONE });
    const global = user.permissions.includes('reportes.global.read');
    const financial = user.permissions.includes('reportes.financial.read');
    const lawyerId = global && query.abogado_id && query.abogado_id !== 'TODOS'
      ? query.abogado_id
      : user.rol === 'ABOGADO' ? user.id : undefined;
    const notariaId = global && query.notaria_id && query.notaria_id !== 'TODOS' ? query.notaria_id : undefined;
    return {
      period,
      scope: {
        mode: global ? 'GLOBAL' : user.rol === 'ABOGADO' ? 'PROPIO' : 'OPERATIVO',
        lawyerId,
        notariaId,
        financial,
      },
    };
  }

  private feeWhere(ctx: ReportContext, range: { from?: Date; to?: Date } = ctx.period) {
    return {
      estado: { not: 'CANCELADO' as const },
      ...(ctx.scope.lawyerId ? { responsable_id: ctx.scope.lawyerId } : {}),
      ...(ctx.scope.notariaId ? { notaria_id: ctx.scope.notariaId } : {}),
      ...(range.from || range.to ? {
        fecha_reconocimiento: {
          ...(range.from ? { gte: range.from } : {}),
          ...(range.to ? { lte: range.to } : {}),
        },
      } : {}),
    };
  }

  private movementWhere(ctx: ReportContext, range: ReportingPeriod = ctx.period) {
    return {
      estatus: { in: applied as any },
      fecha_movimiento: { gte: range.from, lte: range.to },
      ...(ctx.scope.lawyerId ? { responsable_id: ctx.scope.lawyerId } : {}),
      ...(ctx.scope.notariaId ? { notaria_id: ctx.scope.notariaId } : {}),
    };
  }

  private expedienteWhere(user: AuthUser, ctx: ReportContext) {
    return {
      archived_at: null,
      ...expedienteAccessWhere(user),
      ...(ctx.scope.lawyerId ? { abogado_id: ctx.scope.lawyerId } : {}),
      ...(ctx.scope.notariaId ? { notaria_id: ctx.scope.notariaId } : {}),
    };
  }

  private async financialSnapshot(ctx: ReportContext, period = ctx.period) {
    const [fees, movements] = await Promise.all([
      this.db.honorarioGenerado.findMany({
        where: this.feeWhere(ctx, { from: period.from, to: period.to }),
        select: {
          id: true,
          monto: true,
          fecha_reconocimiento: true,
          fecha_vencimiento: true,
          responsable: { select: { id: true, nombre: true, apellido: true } },
          notaria: { select: { id: true, nombre: true } },
          expediente: {
            select: {
              id: true,
              numero_pravia: true,
              cliente_alias: true,
              estatus: true,
              fecha_estimada_firma: true,
              abogado: { select: { id: true, nombre: true, apellido: true } },
              notaria: { select: { id: true, nombre: true } },
            },
          },
          cotizacion: {
            select: {
              id: true,
              numero_cotizacion: true,
              prospecto: { select: { nombre: true } },
            },
          },
          distribuciones: {
            where: {
              movimiento: {
                estatus: { in: applied as any },
                naturaleza: 'INGRESO',
                fecha_movimiento: { lte: period.to },
              },
            },
            select: { monto: true },
          },
        },
        orderBy: { fecha_reconocimiento: 'desc' },
      }),
      this.db.movimientoFinanciero.findMany({
        where: this.movementWhere(ctx, period),
        select: {
          naturaleza: true,
          monto: true,
          estatus: true,
          distribuciones: { select: { monto: true, categoria: { select: { naturaleza: true } } } },
        },
      }),
    ]);

    const rows = fees.map((fee: any) => {
      const generated = money(n(fee.monto));
      const collected = money(Math.min(generated, (fee.distribuciones || []).reduce((sum: number, item: any) => sum + n(item.monto), 0)));
      const responsible = fee.responsable || fee.expediente?.abogado;
      const notaria = fee.notaria || fee.expediente?.notaria;
      return {
        ...fee,
        generated,
        collected,
        pending: money(Math.max(0, generated - collected)),
        responsibleId: responsible?.id || 'SIN_RESPONSABLE',
        responsibleName: person(responsible),
        notariaId: notaria?.id || 'SIN_NOTARIA',
        notariaName: notaria?.nombre || 'Sin notaría',
      };
    });
    const canonicalMovements = movements.map((movement: any): CanonicalMovement => ({
      nature: movement.naturaleza,
      amount: n(movement.monto),
      status: movement.estatus,
      allocations: (movement.distribuciones || []).map((distribution: any) => ({
        nature: distribution.categoria.naturaleza as EconomicNature,
        amount: n(distribution.monto),
      })),
    }));
    const movementTotals = reportFinancialTotals([], canonicalMovements);
    const totals = canonicalFeeCohortTotals(
      rows.map((row: any) => ({ generated: row.generated, collected: row.collected })),
      movementTotals,
    );
    return { totals, rows };
  }

  private groupFees(rows: any[], key: 'responsible' | 'notaria') {
    const grouped = new Map<string, any>();
    for (const row of rows) {
      const id = key === 'responsible' ? row.responsibleId : row.notariaId;
      const name = key === 'responsible' ? row.responsibleName : row.notariaName;
      const current = grouped.get(id) || { id, nombre: name, generated: 0, collected: 0, pending: 0, expedientes: new Set<string>() };
      current.generated = money(current.generated + row.generated);
      current.collected = money(current.collected + row.collected);
      current.pending = money(current.pending + row.pending);
      current.expedientes.add(row.expediente?.id || row.cotizacion?.id || row.id);
      grouped.set(id, current);
    }
    return [...grouped.values()].map((item) => ({
      ...item,
      expedientes: item.expedientes.size,
      porcentaje_cobrado: item.generated ? Math.round((item.collected / item.generated) * 1000) / 10 : null,
    })).sort((left, right) => right.generated - left.generated);
  }

  private async activeTarget(ctx: ReportContext, lawyerId?: string) {
    if (!ctx.scope.financial) return null;
    return this.db.metaHonorario.findFirst({
      where: {
        activa: true,
        periodo_inicio: { lte: ctx.period.to },
        periodo_fin: { gte: ctx.period.from },
        ...(lawyerId ? { alcance: 'ABOGADO', usuario_id: lawyerId } : { alcance: 'DESPACHO' }),
      },
      orderBy: { periodo_inicio: 'desc' },
    });
  }

  private async financialTendency(ctx: ReportContext) {
    const periods = Array.from({ length: 6 }, (_, index) => {
      const range = reportingMonthRange(index - 5, ctx.period.timezone, ctx.period.to);
      return { ...ctx.period, ...range };
    });
    const snapshots = await Promise.all(periods.map((period) => this.financialSnapshot(ctx, period)));
    return periods.map((period, index) => ({
      periodo: new Intl.DateTimeFormat('en-CA', { timeZone: ctx.period.timezone, year: 'numeric', month: '2-digit' }).format(period.from),
      generados: snapshots[index].totals.honorarios_generados,
      cobrados: snapshots[index].totals.honorarios_cobrados,
    }));
  }

  async canonicalFinancials(ctx: ReportContext) {
    if (!ctx.scope.financial) return null;
    return (await this.financialSnapshot(ctx)).totals;
  }

  async catalogs(user: AuthUser) {
    const global = user.permissions.includes('reportes.global.read');
    const [users, notarias] = await Promise.all([
      this.db.user.findMany({
        where: { activo: true, organizationMemberships: { some: activeOrganizationMembershipWhere(user.organizationId, ['DIRECCION', 'ADMINISTRACION', 'ABOGADO']) }, ...(!global ? { id: user.id } : {}) },
        select: { id: true, nombre: true, apellido: true, ...organizationMembershipRoleSelect(user.organizationId) },
        orderBy: [{ nombre: 'asc' }, { apellido: 'asc' }],
      }),
      global ? this.db.notaria.findMany({
        where: { activa: true, archived_at: null },
        select: { id: true, nombre: true, numero_notaria: true },
        orderBy: { nombre: 'asc' },
      }) : Promise.resolve([]),
    ]);
    return {
      usuarios: usersWithEffectiveMembershipRoles(users),
      notarias,
      scope: {
        global,
        financial: user.permissions.includes('reportes.financial.read'),
        targetsManage: user.permissions.includes('reportes.targets.manage'),
      },
    };
  }

  async createTarget(user: AuthUser, input: TargetInput) {
    if (!user.permissions.includes('reportes.targets.manage')) throw new Error('No tienes autorización para configurar metas.');
    const alcance = input.alcance === 'ABOGADO' ? 'ABOGADO' : 'DESPACHO';
    const usuarioId = alcance === 'ABOGADO' ? String(input.usuario_id || '') : null;
    const from = new Date(`${input.periodo_inicio || ''}T00:00:00`);
    const to = new Date(`${input.periodo_fin || ''}T23:59:59.999`);
    const amount = n(input.importe);
    const base = input.base === 'COBRADOS' ? 'COBRADOS' : 'GENERADOS';
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new Error('La vigencia de la meta no es válida.');
    if (amount <= 0) throw new Error('La meta debe ser mayor que cero.');
    if (alcance === 'ABOGADO' && !usuarioId) throw new Error('Selecciona el abogado de la meta.');
    return this.db.metaHonorario.create({
      data: {
        alcance,
        usuario_id: usuarioId,
        periodo_inicio: from,
        periodo_fin: to,
        importe: amount,
        moneda: String(input.moneda || 'MXN').slice(0, 3),
        base,
        creada_por_id: user.id,
      },
      include: { usuario: { select: { id: true, nombre: true, apellido: true } } },
    });
  }

  private ensureTargetManager(user: AuthUser) {
    if (!user.permissions.includes('reportes.targets.manage')) throw new Error('No tienes autorización para configurar metas.');
  }

  async updateTarget(user: AuthUser, id: string, input: TargetInput) {
    this.ensureTargetManager(user);
    const current = await this.db.metaHonorario.findUnique({ where: { id } });
    if (!current) throw new Error('La meta no existe.');
    if (!current.activa) throw new Error('Una meta histórica cerrada no puede modificarse.');
    const from = input.periodo_inicio ? new Date(`${input.periodo_inicio}T00:00:00`) : current.periodo_inicio;
    const to = input.periodo_fin ? new Date(`${input.periodo_fin}T23:59:59.999`) : current.periodo_fin;
    const amount = input.importe === undefined ? n(current.importe) : n(input.importe);
    const alcance = input.alcance === 'ABOGADO' ? 'ABOGADO' : input.alcance === 'DESPACHO' ? 'DESPACHO' : current.alcance;
    const usuarioId = alcance === 'ABOGADO' ? String(input.usuario_id || current.usuario_id || '') : null;
    const base = input.base === 'COBRADOS' ? 'COBRADOS' : input.base === 'GENERADOS' ? 'GENERADOS' : current.base;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new Error('La vigencia de la meta no es válida.');
    if (amount <= 0) throw new Error('La meta debe ser mayor que cero.');
    if (alcance === 'ABOGADO' && !usuarioId) throw new Error('Selecciona el abogado de la meta.');
    return this.db.metaHonorario.update({
      where: { id },
      data: { alcance, usuario_id: usuarioId, periodo_inicio: from, periodo_fin: to, importe: amount, moneda: String(input.moneda || current.moneda).slice(0, 3), base },
      include: { usuario: { select: { id: true, nombre: true, apellido: true } } },
    });
  }

  async closeTarget(user: AuthUser, id: string) {
    this.ensureTargetManager(user);
    const current = await this.db.metaHonorario.findUnique({ where: { id } });
    if (!current) throw new Error('La meta no existe.');
    if (!current.activa) return current;
    return this.db.metaHonorario.update({ where: { id }, data: { activa: false } });
  }

  async summary(user: AuthUser, query: ReportQuery) {
    const ctx = this.context(user, query);
    const expWhere = this.expedienteWhere(user, ctx);
    const { week } = reportingCalendarRanges(AGENDA_TIME_ZONE);
    const [snapshot, target, signatures, remaining, quotes, clients] = await Promise.all([
      ctx.scope.financial ? this.financialSnapshot(ctx) : null,
      this.activeTarget(ctx, ctx.scope.lawyerId),
      this.db.expediente.count({ where: { ...expWhere, fecha_real_firma: { gte: ctx.period.from, lte: ctx.period.to } } }),
      this.db.expediente.findMany({
        where: { ...expWhere, fecha_real_firma: null, fecha_estimada_firma: { gte: new Date(), lte: week.to } },
        select: { id: true, honorariosGenerados: { where: { estado: { not: 'CANCELADO' } }, select: { monto: true } } },
      }),
      this.db.cotizacion.findMany({
        where: {
          created_at: { gte: ctx.period.from, lte: ctx.period.to },
          ...(ctx.scope.lawyerId ? { user_id: ctx.scope.lawyerId } : {}),
          ...(ctx.scope.notariaId ? { notaria_id: ctx.scope.notariaId } : {}),
        },
        select: { id: true, total_cliente: true, fecha_aceptacion_cliente: true },
      }),
      this.db.prospecto.count({
        where: {
          archived_at: null,
          cotizacion: {
            is: {
              fecha_aceptacion_cliente: { gte: ctx.period.from, lte: ctx.period.to },
              ...(ctx.scope.lawyerId ? { user_id: ctx.scope.lawyerId } : {}),
              ...(ctx.scope.notariaId ? { notaria_id: ctx.scope.notariaId } : {}),
            },
          },
        },
      }),
    ]);
    const financial = snapshot?.totals || null;
    const goal = financial && target ? targetProgress({ amount: n(target.importe), base: target.base }, financial) : null;
    return {
      period: ctx.period,
      scope: ctx.scope,
      financial,
      goal,
      operations: {
        firmas_realizadas: signatures,
        firmas_restantes_semana: remaining.length,
        honorarios_programados_semana: ctx.scope.financial ? remaining.reduce((sum, expediente) => sum + expediente.honorariosGenerados.reduce((subtotal, fee) => subtotal + n(fee.monto), 0), 0) : null,
        presupuestos_solicitados: quotes.length,
        importe_cotizado: ctx.scope.financial ? quotes.reduce((sum, quote) => sum + n(quote.total_cliente), 0) : null,
        presupuestos_aceptados: quotes.filter((quote) => quote.fecha_aceptacion_cliente).length,
        clientes_generados: clients,
      },
      definitions: {
        programado: 'Honorarios de firmas pendientes desde hoy hasta el domingo.',
        clientes: 'Prospectos con cotización aceptada en el periodo.',
      },
    };
  }

  async finance(user: AuthUser, query: ReportQuery) {
    const ctx = this.context(user, query);
    if (!ctx.scope.financial) return { period: ctx.period, scope: ctx.scope, restricted: true };
    const [snapshot, target, months, lawyerTargets] = await Promise.all([
      this.financialSnapshot(ctx),
      this.activeTarget(ctx, ctx.scope.lawyerId),
      this.financialTendency(ctx),
      this.db.metaHonorario.findMany({
        where: {
          activa: true,
          alcance: 'ABOGADO',
          periodo_inicio: { lte: ctx.period.to },
          periodo_fin: { gte: ctx.period.from },
          ...(ctx.scope.lawyerId ? { usuario_id: ctx.scope.lawyerId } : {}),
        },
        orderBy: { periodo_inicio: 'desc' },
      }),
    ]);
    const byLawyer = this.groupFees(snapshot.rows, 'responsible');
    const targetByLawyer = new Map<string, any>();
    for (const item of lawyerTargets) if (item.usuario_id && !targetByLawyer.has(item.usuario_id)) targetByLawyer.set(item.usuario_id, item);
    return {
      period: ctx.period,
      scope: ctx.scope,
      financial: snapshot.totals,
      tendency: months,
      byLawyer: byLawyer.map((row) => {
        const item = targetByLawyer.get(row.id);
        return {
          ...row,
          goal: item ? targetProgress({ amount: n(item.importe), base: item.base }, { honorarios_generados: row.generated, honorarios_cobrados: row.collected }) : null,
        };
      }),
      byNotaria: this.groupFees(snapshot.rows, 'notaria'),
      goal: target ? targetProgress({ amount: n(target.importe), base: target.base }, snapshot.totals) : null,
    };
  }

  async collections(user: AuthUser, query: ReportQuery) {
    const ctx = this.context(user, query);
    if (!ctx.scope.financial) return { period: ctx.period, scope: ctx.scope, restricted: true };
    const snapshot = await this.financialSnapshot(ctx);
    const asOf = new Date(Math.min(Date.now(), ctx.period.to.getTime()));
    const allRows = snapshot.rows.map((row: any) => ({
      id: row.id,
      expediente_id: row.expediente?.id,
      expediente: row.expediente?.numero_pravia || row.cotizacion?.numero_cotizacion || 'Cotización',
      cliente: row.expediente?.cliente_alias || row.cotizacion?.prospecto?.nombre || 'Sin cliente',
      abogado_id: row.responsibleId,
      abogado: row.responsibleName,
      notaria_id: row.notariaId,
      notaria: row.notariaName,
      generated: row.generated,
      collected: row.collected,
      pending: row.pending,
      due: row.fecha_vencimiento,
      overdue: Boolean(row.fecha_vencimiento && row.fecha_vencimiento < asOf && row.pending > 0),
      link: row.expediente ? `/expedientes/${row.expediente.id}` : `/cotizaciones/${row.cotizacion.id}`,
    }));
    const group = (key: 'abogado' | 'notaria', idKey: 'abogado_id' | 'notaria_id') => {
      const map = new Map<string, any>();
      for (const row of allRows) {
        const id = row[idKey];
        const current = map.get(id) || { id, nombre: row[key], generated: 0, collected: 0, pending: 0, overdue: 0, expedientes: 0 };
        current.generated = money(current.generated + row.generated);
        current.collected = money(current.collected + row.collected);
        current.pending = money(current.pending + row.pending);
        current.overdue = money(current.overdue + (row.overdue ? row.pending : 0));
        current.expedientes += 1;
        map.set(id, current);
      }
      return [...map.values()].map((item) => ({
        ...item,
        porcentaje_cobrado: item.generated ? Math.round((item.collected / item.generated) * 1000) / 10 : null,
      })).sort((left, right) => right.pending - left.pending);
    };
    const tendency = await this.financialTendency(ctx);
    const withoutDue = allRows.filter((row) => !row.due).reduce((sum, row) => money(sum + row.pending), 0);
    return {
      period: ctx.period,
      scope: ctx.scope,
      totals: {
        generated: allRows.reduce((sum, row) => money(sum + row.generated), 0),
        collected: allRows.reduce((sum, row) => money(sum + row.collected), 0),
        pending: allRows.reduce((sum, row) => money(sum + row.pending), 0),
        overdue: allRows.filter((row) => row.overdue).reduce((sum, row) => money(sum + row.pending), 0),
      },
      byLawyer: group('abogado', 'abogado_id'),
      byNotaria: group('notaria', 'notaria_id'),
      tendency,
      dueBreakdown: {
        overdue: allRows.filter((row) => row.overdue).reduce((sum, row) => money(sum + row.pending), 0),
        notOverdue: allRows.filter((row) => row.due && !row.overdue).reduce((sum, row) => money(sum + row.pending), 0),
        withoutDue,
      },
      rows: allRows.filter((row) => row.pending > 0).sort((left, right) => Number(right.overdue) - Number(left.overdue) || right.pending - left.pending),
    };
  }

  async lawyers(user: AuthUser, query: ReportQuery) {
    const ctx = this.context(user, query);
    const now = new Date();
    const { week, previousWeek, month, nextMonth } = reportingCalendarRanges(AGENDA_TIME_ZONE, now);
    const [users, expedientes, snapshot, currentSnapshot, targets] = await Promise.all([
      this.db.user.findMany({
        where: { activo: true, organizationMemberships: { some: activeOrganizationMembershipWhere(user.organizationId, ['DIRECCION', 'ADMINISTRACION', 'ABOGADO']) }, ...(ctx.scope.lawyerId ? { id: ctx.scope.lawyerId } : {}) },
        select: { id: true, nombre: true, apellido: true },
        orderBy: [{ nombre: 'asc' }, { apellido: 'asc' }],
      }),
      this.db.expediente.findMany({
        where: this.expedienteWhere(user, ctx),
        select: { id: true, abogado_id: true, fecha_apertura: true, fecha_estimada_firma: true, fecha_real_firma: true },
      }),
      ctx.scope.financial ? this.financialSnapshot(ctx) : null,
      ctx.scope.financial ? this.financialSnapshot(ctx, { ...ctx.period, from: month.from, to: month.to }) : null,
      ctx.scope.financial ? this.db.metaHonorario.findMany({
        where: { activa: true, alcance: 'ABOGADO', periodo_inicio: { lte: ctx.period.to }, periodo_fin: { gte: ctx.period.from }, ...(ctx.scope.lawyerId ? { usuario_id: ctx.scope.lawyerId } : {}) },
        orderBy: { periodo_inicio: 'desc' },
      }) : [],
    ]);
    const targetByLawyer = new Map<string, any>();
    for (const target of targets) if (target.usuario_id && !targetByLawyer.has(target.usuario_id)) targetByLawyer.set(target.usuario_id, target);
    const feesByLawyer = new Map(this.groupFees(snapshot?.rows || [], 'responsible').map((row) => [row.id, row]));
    const rows = users.map((lawyer) => {
      const lawyerExps = expedientes.filter((expediente) => expediente.abogado_id === lawyer.id);
      const finances = feesByLawyer.get(lawyer.id) || { generated: 0, collected: 0, pending: 0 };
      const target = targetByLawyer.get(lawyer.id);
      const goal = target ? targetProgress({ amount: n(target.importe), base: target.base }, {
        honorarios_generados: ctx.scope.financial ? finances.generated : null,
        honorarios_cobrados: ctx.scope.financial ? finances.collected : null,
      }) : null;
      return {
        id: lawyer.id,
        nombre: person(lawyer),
        expedientes_periodo: lawyerExps.filter((item) => inRange(item.fecha_apertura, ctx.period.from, ctx.period.to)).length,
        honorarios_generados: ctx.scope.financial ? finances.generated : null,
        honorarios_cobrados: ctx.scope.financial ? finances.collected : null,
        firmas_semana: lawyerExps.filter((item) => !item.fecha_real_firma && inRange(item.fecha_estimada_firma, week.from, week.to)).length,
        firmas_mes: lawyerExps.filter((item) => !item.fecha_real_firma && inRange(item.fecha_estimada_firma, month.from, month.to)).length,
        firmas_proximo_mes: lawyerExps.filter((item) => !item.fecha_real_firma && inRange(item.fecha_estimada_firma, nextMonth.from, nextMonth.to)).length,
        firmas_realizadas_semana_anterior: lawyerExps.filter((item) => inRange(item.fecha_real_firma, previousWeek.from, previousWeek.to)).length,
        honorarios_semana: ctx.scope.financial ? currentSnapshot?.rows.filter((fee: any) => fee.responsibleId === lawyer.id && inRange(fee.fecha_reconocimiento, week.from, week.to)).reduce((sum: number, fee: any) => sum + fee.generated, 0) || 0 : null,
        honorarios_mes: ctx.scope.financial ? currentSnapshot?.rows.filter((fee: any) => fee.responsibleId === lawyer.id && inRange(fee.fecha_reconocimiento, month.from, month.to)).reduce((sum: number, fee: any) => sum + fee.generated, 0) || 0 : null,
        goal,
      };
    });
    return {
      period: ctx.period,
      scope: ctx.scope,
      rows: rows.sort((left, right) => (right.honorarios_generados ?? 0) - (left.honorarios_generados ?? 0)),
    };
  }

  async signatures(user: AuthUser, query: ReportQuery) {
    const ctx = this.context(user, query);
    const now = new Date();
    const { week, previousWeek: previous, month, nextMonth } = reportingCalendarRanges(AGENDA_TIME_ZONE, now);
    const rangeFrom = new Date(Math.min(previous.from.getTime(), ctx.period.from.getTime()));
    const rangeTo = new Date(Math.max(nextMonth.to.getTime(), ctx.period.to.getTime()));
    const rows = await this.db.expediente.findMany({
      where: {
        ...this.expedienteWhere(user, ctx),
        OR: [
          { fecha_estimada_firma: { gte: rangeFrom, lte: rangeTo } },
          { fecha_real_firma: { gte: rangeFrom, lte: rangeTo } },
        ],
      },
      select: {
        id: true,
        numero_pravia: true,
        cliente_alias: true,
        fecha_estimada_firma: true,
        fecha_real_firma: true,
        abogado: { select: { id: true, nombre: true, apellido: true } },
        honorariosGenerados: { where: { estado: { not: 'CANCELADO' } }, select: { monto: true } },
      },
      orderBy: [{ fecha_estimada_firma: 'asc' }, { fecha_real_firma: 'desc' }],
    });
    const fees = (row: any) => row.honorariosGenerados.reduce((sum: number, fee: any) => sum + n(fee.monto), 0);
    const scheduled = (row: any, range: { from: Date; to: Date }) => !row.fecha_real_firma && inRange(row.fecha_estimada_firma, range.from, range.to);
    return {
      period: ctx.period,
      scope: ctx.scope,
      metrics: {
        realizadas_periodo: rows.filter((row) => inRange(row.fecha_real_firma, ctx.period.from, ctx.period.to)).length,
        realizadas_semana_anterior: rows.filter((row) => inRange(row.fecha_real_firma, previous.from, previous.to)).length,
        programadas_semana: rows.filter((row) => scheduled(row, week)).length,
        programadas_mes: rows.filter((row) => scheduled(row, month)).length,
        programadas_proximo_mes: rows.filter((row) => scheduled(row, nextMonth)).length,
        atrasadas_sin_confirmar: rows.filter((row) => !row.fecha_real_firma && row.fecha_estimada_firma && row.fecha_estimada_firma < now).length,
        honorarios_realizados_periodo: ctx.scope.financial ? rows.filter((row) => inRange(row.fecha_real_firma, ctx.period.from, ctx.period.to)).reduce((sum, row) => sum + fees(row), 0) : null,
        honorarios_programados_semana: ctx.scope.financial ? rows.filter((row) => scheduled(row, week)).reduce((sum, row) => sum + fees(row), 0) : null,
        honorarios_programados_mes: ctx.scope.financial ? rows.filter((row) => scheduled(row, month)).reduce((sum, row) => sum + fees(row), 0) : null,
      },
      rows: rows.map((row) => ({
        id: row.id,
        numero_pravia: row.numero_pravia,
        cliente_alias: row.cliente_alias,
        fecha_estimada_firma: row.fecha_estimada_firma,
        fecha_real_firma: row.fecha_real_firma,
        honorarios: ctx.scope.financial ? fees(row) : null,
        abogado: person(row.abogado),
        estado: row.fecha_real_firma ? 'REALIZADA' : row.fecha_estimada_firma && row.fecha_estimada_firma < now ? 'ATRASADA_SIN_CONFIRMAR' : 'PROGRAMADA',
        link: `/expedientes/${row.id}`,
      })),
      definitions: {
        programada: 'Cuenta únicamente expedientes con fecha estimada futura y sin firma real confirmada.',
        realizada: 'Cuenta únicamente expedientes con fecha real de firma registrada.',
      },
    };
  }

  async eightyTwenty(user: AuthUser, query: ReportQuery) {
    const ctx = this.context(user, query);
    if (!ctx.scope.financial) return { period: ctx.period, scope: ctx.scope, restricted: true };
    const movements = await this.db.movimientoFinanciero.findMany({
      where: { ...this.movementWhere(ctx), naturaleza: 'INGRESO' },
      select: {
        id: true,
        expediente_id: true,
        expediente: {
          select: {
            id: true,
            numero_pravia: true,
            cliente_alias: true,
            estatus: true,
            fecha_estimada_firma: true,
            abogado: { select: { id: true, nombre: true, apellido: true } },
            notaria: { select: { id: true, nombre: true } },
          },
        },
        distribuciones: {
          where: { categoria: { naturaleza: 'DESPACHO' } },
          select: {
            monto: true,
            honorarioGenerado: { select: { expediente_id: true } },
          },
        },
      },
    });

    const candidates = new Map<string, { importe: number; expediente?: any }>();
    let unclassifiedAmount = 0;
    for (const movement of movements as any[]) {
      for (const distribution of movement.distribuciones || []) {
        const amount = money(n(distribution.monto));
        const expedienteId = distribution.honorarioGenerado?.expediente_id || movement.expediente_id;
        if (!expedienteId) {
          unclassifiedAmount = money(unclassifiedAmount + amount);
          continue;
        }
        const current = candidates.get(expedienteId) || { importe: 0, expediente: movement.expediente || undefined };
        current.importe = money(current.importe + amount);
        current.expediente ||= movement.expediente || undefined;
        candidates.set(expedienteId, current);
      }
    }

    const expedienteIds = [...candidates.keys()];
    const fees = expedienteIds.length ? await this.db.honorarioGenerado.findMany({
      where: {
        ...this.feeWhere(ctx, { to: ctx.period.to }),
        expediente_id: { in: expedienteIds },
      },
      select: {
        id: true,
        expediente_id: true,
        monto: true,
        responsable: { select: { id: true, nombre: true, apellido: true } },
        notaria: { select: { id: true, nombre: true } },
        expediente: {
          select: {
            id: true,
            numero_pravia: true,
            cliente_alias: true,
            estatus: true,
            fecha_estimada_firma: true,
            abogado: { select: { id: true, nombre: true, apellido: true } },
            notaria: { select: { id: true, nombre: true } },
          },
        },
        distribuciones: {
          where: {
            categoria: { naturaleza: 'DESPACHO' },
            movimiento: {
              estatus: { in: applied as any },
              naturaleza: 'INGRESO',
              fecha_movimiento: { lte: ctx.period.to },
            },
          },
          select: { monto: true },
        },
      },
    }) : [];

    const financialByExpediente = new Map<string, { generated: number; collected: number; expediente?: any; responsible?: any; notaria?: any }>();
    for (const fee of fees as any[]) {
      if (!fee.expediente_id) continue;
      const current = financialByExpediente.get(fee.expediente_id) || { generated: 0, collected: 0, expediente: fee.expediente, responsible: fee.responsable, notaria: fee.notaria };
      current.generated = money(current.generated + n(fee.monto));
      current.collected = money(current.collected + (fee.distribuciones || []).reduce((sum: number, item: any) => sum + n(item.monto), 0));
      current.expediente ||= fee.expediente;
      current.responsible ||= fee.responsable;
      current.notaria ||= fee.notaria;
      financialByExpediente.set(fee.expediente_id, current);
    }

    const rows = expedienteIds.map((expedienteId) => {
      const candidate = candidates.get(expedienteId)!;
      const finance = financialByExpediente.get(expedienteId);
      const expediente = finance?.expediente || candidate.expediente;
      const generated = finance ? money(finance.generated) : null;
      const collected = finance ? money(Math.min(finance.generated, finance.collected)) : null;
      return {
        id: expedienteId,
        expediente: expediente?.numero_pravia || 'Expediente sin folio',
        cliente: expediente?.cliente_alias || 'Sin cliente',
        honorarios: generated,
        importe_computable: candidate.importe,
        cobrado_honorarios_acumulado: collected,
        pending: generated === null || collected === null ? null : money(Math.max(0, generated - collected)),
        fecha_firma: expediente?.fecha_estimada_firma,
        notaria: finance?.notaria?.nombre || expediente?.notaria?.nombre || 'Sin notaría',
        abogado: person(finance?.responsible || expediente?.abogado),
        status: expediente?.estatus || 'SIN_ESTADO',
        link: `/expedientes/${expedienteId}`,
      };
    });
    return {
      period: ctx.period,
      scope: ctx.scope,
      definition: 'Las 20 operaciones con mayor importe del periodo aplicado explícitamente a categorías del despacho y vinculado a un expediente. No presume una distribución Pareto.',
      source: 'MovimientoFinanciero aplicado → MovimientoDistribucion de naturaleza DESPACHO → expediente u honorario reconocido vinculado.',
      unclassified_amount: unclassifiedAmount,
      rows: sortAndLimitEconomicRows(rows, 20),
      limit: 20,
    };
  }

  async potentialClients(user: AuthUser, query: ReportQuery) {
    const ctx = this.context(user, query);
    if (!ctx.scope.financial) {
      return {
        period: ctx.period,
        scope: ctx.scope,
        restricted: true,
        definition: 'La información económica de oportunidades requiere permiso financiero.',
        rows: [],
      };
    }
    const page = positiveInteger(query.page, 1, 100_000);
    const pageSize = Math.max(10, positiveInteger(query.page_size, 20, 50));
    const createdAt = { gte: ctx.period.from, lte: ctx.period.to };
    const where: Prisma.CotizacionWhereInput = {
      created_at: createdAt,
      fecha_aceptacion_cliente: null,
      expediente: null,
      estado: { notIn: ['ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CONVERTIDA_EXPEDIENTE'] },
      ...(ctx.scope.lawyerId ? { user_id: ctx.scope.lawyerId } : {}),
      ...(ctx.scope.notariaId ? { notaria_id: ctx.scope.notariaId } : {}),
    };
    const [quotes, total, aggregate] = await Promise.all([
      this.db.cotizacion.findMany({
      where,
      select: {
        id: true,
        numero_cotizacion: true,
        created_at: true,
        fecha_aceptacion_cliente: true,
        estado: true,
        honorarios_pravia: true,
        total_cliente: true,
        prospecto: { select: { id: true, nombre: true, tipo_acto: true } },
        creada_por: { select: { id: true, nombre: true, apellido: true } },
        notaria: { select: { id: true, nombre: true } },
        expediente: { select: { id: true } },
      },
      orderBy: [{ honorarios_pravia: 'desc' }, { created_at: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      }),
      this.db.cotizacion.count({ where }),
      this.db.cotizacion.aggregate({ where, _sum: { honorarios_pravia: true } }),
    ]);
    return {
      period: ctx.period,
      scope: ctx.scope,
      definition: 'Cotizaciones comerciales vigentes, aún no aceptadas ni convertidas. Su importe es potencial y nunca se suma a honorarios generados.',
      metrics: {
        total,
        honorarios: n(aggregate._sum?.honorarios_pravia),
      },
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      rows: quotes.filter((quote) => !quote.fecha_aceptacion_cliente && !quote.expediente && !['ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CONVERTIDA_EXPEDIENTE'].includes(quote.estado)).map((quote) => ({
        id: quote.id,
        cliente: quote.prospecto?.nombre || 'Sin cliente',
        honorarios: n(quote.honorarios_pravia),
        notaria: quote.notaria?.nombre || 'Sin notaría',
        responsable: person(quote.creada_por),
        acto: quote.prospecto?.tipo_acto || 'Sin acto',
        fecha_cotizacion: quote.created_at,
        link: `/cotizaciones/${quote.id}`,
      })).sort((left, right) => right.honorarios - left.honorarios),
    };
  }
}
