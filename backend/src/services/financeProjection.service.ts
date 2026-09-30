import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import type { FinancePeriod } from './financeAnalytics.service';

type Actor = { id: string; organizationId: string };
const APPLIED = ['APLICADO', 'RECIBIDO', 'VALIDADO'] as const;

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const monthKey = (date: Date) => date.toISOString().slice(0, 7);
const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
const money = (value: unknown) => Number(value || 0);

function seriesKey(date: Date, period: FinancePeriod) {
  const days = Math.ceil((period.to.getTime() - period.from.getTime()) / 86_400_000);
  if (days <= 45) return dayKey(date);
  if (days <= 130) {
    const monday = new Date(date); const offset = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - offset);
    return dayKey(monday);
  }
  return monthKey(date);
}

export function businessDaysUntil(from: Date, to: Date) {
  const start = startOfDay(from); const end = startOfDay(to);
  if (end < start) return -1;
  let count = 0;
  for (const cursor = new Date(start); cursor < end; cursor.setDate(cursor.getDate() + 1)) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export type FinancialQueryPlan = {
  metric: 'GENERATED' | 'COLLECTED' | 'OUTSTANDING' | 'EXPENSES' | 'THIRD_PARTY';
  groupBy: 'PERIOD' | 'LAWYER' | 'ACT' | 'STATUS';
  period: '7_DIAS' | '30_DIAS' | '3_MESES' | '6_MESES' | '1_ANO';
  chart: 'BAR' | 'STACKED_BAR';
};

export function parseFinancialQuery(query: string): FinancialQueryPlan {
  const normalized = query.toLocaleLowerCase('es-MX');
  const metric = /por cobrar|pendiente/.test(normalized) ? 'OUTSTANDING'
    : /egreso|gasto/.test(normalized) ? 'EXPENSES'
      : /recurso.*no propio|tercero/.test(normalized) ? 'THIRD_PARTY'
        : /cobrado|cobranza|ingreso/.test(normalized) ? 'COLLECTED' : 'GENERATED';
  const groupBy = /abogad|responsable/.test(normalized) ? 'LAWYER'
    : /tipo de acto|acto/.test(normalized) ? 'ACT'
      : /estado|estatus/.test(normalized) ? 'STATUS' : 'PERIOD';
  const period = /año|12 mes/.test(normalized) ? '1_ANO'
    : /6 mes/.test(normalized) ? '6_MESES'
      : /3 mes|trimestre/.test(normalized) ? '3_MESES'
        : /7 d[ií]as|semana/.test(normalized) ? '7_DIAS' : '30_DIAS';
  return { metric, groupBy, period, chart: groupBy === 'STATUS' ? 'STACKED_BAR' : 'BAR' };
}

export class FinanceProjectionError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}

export class FinanceProjectionService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async additions(period: FinancePeriod, now = new Date(), organizationId?: string) {
    const tenant = organizationId ? { organization_id: organizationId } : {};
    const [fees, movements, budgets, recurringExpenses, projectedMovements] = await Promise.all([
      this.db.honorarioGenerado.findMany({
        where: { ...tenant, estado: { not: 'CANCELADO' }, fecha_reconocimiento: { lte: period.to } },
        include: {
          responsable: { select: { id: true, nombre: true, apellido: true } },
          expediente: { select: { id: true, numero_pravia: true, cliente_alias: true, fecha_estimada_firma: true, actos: { where: { estatus: 'ACTIVO', removed_at: null }, orderBy: { created_at: 'asc' }, take: 1, select: { tipo_acto: { select: { nombre: true } } } } } },
          distribuciones: { where: { movimiento: { estatus: { in: [...APPLIED] }, naturaleza: 'INGRESO', fecha_movimiento: { lte: period.to } } }, include: { movimiento: { select: { id: true, fecha_movimiento: true } } } },
        },
      }),
      this.db.movimientoFinanciero.findMany({
        where: { ...tenant, estatus: { in: [...APPLIED] }, fecha_movimiento: { gte: period.from, lte: period.to } },
        include: { expediente: { select: { id: true, numero_pravia: true } }, responsable: { select: { id: true, nombre: true, apellido: true } }, distribuciones: { include: { categoria: true } } },
        orderBy: { fecha_movimiento: 'desc' },
      }),
      this.db.expedientePresupuesto.findMany({
        where: { ...tenant, expediente: { archived_at: null, fecha_estimada_firma: { not: null } } },
        include: { distribucion: true, expediente: { select: { id: true, numero_pravia: true, cliente_alias: true, fecha_estimada_firma: true, movimientosFinancieros: { where: { estatus: { in: [...APPLIED] }, naturaleza: 'INGRESO' }, select: { monto: true } } } } },
      }),
      this.db.gastoRecurrenteFinanciero.findMany({ where: { ...tenant, activo: true, fecha_inicio: { lte: new Date(now.getFullYear() + 1, now.getMonth() + 1, 0) }, OR: [{ fecha_fin: null }, { fecha_fin: { gte: now } }] }, orderBy: { concepto: 'asc' } }),
      this.db.movimientoFinanciero.findMany({ where: { ...tenant, estatus: 'PENDIENTE', fecha_movimiento: { gt: now }, naturaleza: { in: ['INGRESO', 'EGRESO'] } }, select: { id: true, naturaleza: true, monto: true, fecha_movimiento: true, concepto: true } }),
    ]);

    const generatedBySeries = new Map<string, number>();
    const collectedBySeries = new Map<string, number>();
    const byLawyer = new Map<string, { id: string | null; label: string; generated: number; collected: number }>();
    const byAct = new Map<string, { label: string; generated: number; collected: number }>();
    let generated = 0; let collected = 0; let overdue = 0;

    for (const fee of fees) {
      const amount = money(fee.monto);
      const feeCollected = fee.distribuciones.reduce((sum, row) => sum + money(row.monto), 0);
      const pending = Math.max(0, amount - feeCollected);
      generated += amount; collected += feeCollected;
      if (fee.fecha_vencimiento && fee.fecha_vencimiento < now) overdue += pending;
      if (fee.fecha_reconocimiento >= period.from) {
        const key = seriesKey(fee.fecha_reconocimiento, period);
        generatedBySeries.set(key, (generatedBySeries.get(key) || 0) + amount);
      }
      for (const row of fee.distribuciones) {
        if (row.movimiento.fecha_movimiento < period.from) continue;
        const key = seriesKey(row.movimiento.fecha_movimiento, period);
        collectedBySeries.set(key, (collectedBySeries.get(key) || 0) + money(row.monto));
      }
      const lawyerLabel = fee.responsable ? `${fee.responsable.nombre} ${fee.responsable.apellido}`.trim() : 'Sin responsable';
      const lawyerKey = fee.responsable?.id || 'NONE';
      const lawyer = byLawyer.get(lawyerKey) || { id: fee.responsable?.id || null, label: lawyerLabel, generated: 0, collected: 0 };
      lawyer.generated += amount; lawyer.collected += feeCollected; byLawyer.set(lawyerKey, lawyer);
      const actLabel = fee.expediente?.actos[0]?.tipo_acto.nombre || 'Sin acto';
      const act = byAct.get(actLabel) || { label: actLabel, generated: 0, collected: 0 };
      act.generated += amount; act.collected += feeCollected; byAct.set(actLabel, act);
    }

    const keys = [...new Set([...generatedBySeries.keys(), ...collectedBySeries.keys()])].sort();
    const projection = new Map<string, { period: string; fees: number; otherIncome: number; expenses: number }>();
    const noDate = { fees: 0, otherIncome: 0, expenses: 0 };
    for (const fee of fees) {
      const pending = Math.max(0, money(fee.monto) - fee.distribuciones.reduce((sum, row) => sum + money(row.monto), 0));
      if (!pending) continue;
      const signature = fee.expediente?.fecha_estimada_firma;
      if (!signature) { noDate.fees += pending; continue; }
      const key = monthKey(signature); const row = projection.get(key) || { period: key, fees: 0, otherIncome: 0, expenses: 0 };
      row.fees += pending; projection.set(key, row);
    }
    for (const movement of projectedMovements) {
      const key = monthKey(movement.fecha_movimiento); const row = projection.get(key) || { period: key, fees: 0, otherIncome: 0, expenses: 0 };
      if (movement.naturaleza === 'INGRESO') row.otherIncome += money(movement.monto); else row.expenses += money(movement.monto);
      projection.set(key, row);
    }
    for (const expense of recurringExpenses) {
      const cursor = new Date(Math.max(startOfDay(expense.fecha_inicio).getTime(), new Date(now.getFullYear(), now.getMonth(), 1).getTime()));
      cursor.setDate(1);
      const last = expense.fecha_fin || new Date(now.getFullYear() + 1, now.getMonth(), 0);
      while (cursor <= last && cursor <= new Date(now.getFullYear() + 1, now.getMonth(), 0)) {
        const key = monthKey(cursor); const row = projection.get(key) || { period: key, fees: 0, otherIncome: 0, expenses: 0 };
        row.expenses += money(expense.monto); projection.set(key, row); cursor.setMonth(cursor.getMonth() + 1);
      }
    }

    const collectionAlerts = budgets.flatMap((budget) => {
      const signature = budget.expediente.fecha_estimada_firma;
      if (!signature) return [];
      const pending = Math.max(0, money(budget.total) - budget.expediente.movimientosFinancieros.reduce((sum, item) => sum + money(item.monto), 0));
      const days = businessDaysUntil(now, signature);
      if (!pending || ![5, 3, 0].includes(days)) return [];
      return [{ id: budget.id, expediente_id: budget.expediente.id, folio: budget.expediente.numero_pravia, client: budget.expediente.cliente_alias, signature_date: signature, business_days: days, outstanding: pending, source: 'CURRENT_EXPEDIENTE_BUDGET' }];
    });

    return {
      series: keys.map((key) => ({ period: key, generated: generatedBySeries.get(key) || 0, collected: collectedBySeries.get(key) || 0, difference: (generatedBySeries.get(key) || 0) - (collectedBySeries.get(key) || 0) })),
      byLawyer: [...byLawyer.values()].sort((a, b) => b.generated - a.generated),
      byAct: [...byAct.values()].sort((a, b) => b.generated - a.generated),
      collectionStatus: { collected, outstanding: Math.max(0, generated - collected), overdue },
      projection: { months: [...projection.values()].sort((a, b) => a.period.localeCompare(b.period)), noDate },
      collectionAlerts,
      recentMovements: movements.slice(0, 8).map((movement) => ({
        id: movement.id, date: movement.fecha_movimiento, concept: movement.concepto, amount: money(movement.monto), nature: movement.naturaleza,
        origin: movement.expediente_id ? 'EXPEDIENTE' : 'EXTERNO', expediente: movement.expediente,
        href: movement.expediente_id ? `/expedientes/${movement.expediente_id}?tab=finanzas` : `/finanzas?view=movimientos&search=${encodeURIComponent(movement.folio || movement.id)}`,
      })),
    };
  }

  async listRecurringExpenses(organizationId: string) {
    return this.db.gastoRecurrenteFinanciero.findMany({ where: { organization_id: organizationId }, orderBy: [{ activo: 'desc' }, { concepto: 'asc' }] });
  }

  async createRecurringExpense(actor: Actor, input: Record<string, unknown>) {
    const concepto = String(input.concepto || '').trim().slice(0, 240);
    const monto = Number(input.monto);
    const periodicidad = String(input.periodicidad || 'MENSUAL').toUpperCase();
    const fechaInicio = new Date(String(input.fecha_inicio || ''));
    const fechaFin = input.fecha_fin ? new Date(String(input.fecha_fin)) : null;
    if (!concepto || !Number.isFinite(monto) || monto <= 0 || periodicidad !== 'MENSUAL' || Number.isNaN(fechaInicio.getTime()) || (fechaFin && fechaFin < fechaInicio)) throw new FinanceProjectionError('Concepto, importe, periodicidad mensual y fechas válidas son obligatorios.', 'FINANCE_RECURRING_INVALID');
    return this.db.$transaction(async (tx) => {
      const created = await tx.gastoRecurrenteFinanciero.create({ data: { organization_id: actor.organizationId, concepto, monto, periodicidad, fecha_inicio: fechaInicio, fecha_fin: fechaFin, created_by_id: actor.id, updated_by_id: actor.id } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'CREATE_RECURRING_FINANCIAL_EXPENSE', entidad: 'GastoRecurrenteFinanciero', entidad_id: created.id, detalles: { concepto, monto, periodicidad } } });
      return created;
    });
  }

  async updateRecurringExpense(actor: Actor, id: string, input: Record<string, unknown>) {
    const current = await this.db.gastoRecurrenteFinanciero.findFirst({ where: { id, organization_id: actor.organizationId } });
    if (!current) throw new FinanceProjectionError('El gasto recurrente no existe dentro de la organización.', 'FINANCE_RECURRING_NOT_FOUND', 404);
    const monto = input.monto === undefined ? money(current.monto) : Number(input.monto);
    if (!Number.isFinite(monto) || monto <= 0) throw new FinanceProjectionError('El importe debe ser mayor a cero.', 'FINANCE_RECURRING_INVALID');
    const updated = await this.db.gastoRecurrenteFinanciero.update({ where: { id }, data: { concepto: input.concepto === undefined ? current.concepto : String(input.concepto).trim().slice(0, 240), monto, activo: input.activo === undefined ? current.activo : input.activo === true, updated_by_id: actor.id } });
    await this.db.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'UPDATE_RECURRING_FINANCIAL_EXPENSE', entidad: 'GastoRecurrenteFinanciero', entidad_id: id, valores_anteriores: { monto: current.monto.toString(), activo: current.activo }, valores_nuevos: { monto: updated.monto.toString(), activo: updated.activo } } });
    return updated;
  }

  async runTypedQuery(actor: Actor, query: string, save = false) {
    const normalized = String(query || '').trim().slice(0, 500);
    if (normalized.length < 3) throw new FinanceProjectionError('Escribe una consulta financiera concreta.', 'FINANCE_QUERY_REQUIRED');
    const plan = parseFinancialQuery(normalized);
    const record = await this.db.consultaFinancieraGuardada.create({ data: { organization_id: actor.organizationId, user_id: actor.id, title: normalized.slice(0, 100), query_text: normalized, typed_plan: plan as unknown as Prisma.InputJsonValue, saved: save } });
    return { id: record.id, plan, read_only: true, sql_freeform: false };
  }
}

export const financeProjectionService = new FinanceProjectionService();
