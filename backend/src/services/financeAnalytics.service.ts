import type { PrismaClient } from '@prisma/client';
import { calculateFinanceAggregates, calculateReceivable, legacyFinanceAllocations, type EconomicNature } from '../domain/financeCore';

export type FinancePeriod = { from: Date; to: Date; key: string; label: string };

export function resolveFinancePeriod(input: { periodo?: string; fecha_desde?: string; fecha_hasta?: string }, now = new Date()): FinancePeriod {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const key = input.periodo || 'ESTE_MES';
  if (key === 'MES_ANTERIOR') {
    start.setDate(1); start.setMonth(start.getMonth() - 1);
    end.setDate(0); end.setHours(23, 59, 59, 999);
  } else if (key === 'TRIMESTRE') {
    start.setMonth(start.getMonth() - 2, 1);
  } else if (key === 'ANO') {
    start.setMonth(0, 1);
  } else if (key === 'PERSONALIZADO' && input.fecha_desde && input.fecha_hasta) {
    start.setTime(new Date(`${input.fecha_desde}T00:00:00`).getTime());
    end.setTime(new Date(`${input.fecha_hasta}T23:59:59.999`).getTime());
  } else {
    start.setDate(1);
  }
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error('Selecciona un periodo válido.');
  }
  const fmt = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  return { from: start, to: end, key, label: `${fmt.format(start)} – ${fmt.format(end)}` };
}

export class FinanceAnalyticsService {
  constructor(private readonly db: PrismaClient) {}

  async summary(period: FinancePeriod) {
    const [movements, movementsAsOf, fees] = await Promise.all([
      this.db.movimientoFinanciero.findMany({
        where: { fecha_movimiento: { gte: period.from, lte: period.to }, estatus: { in: ['APLICADO', 'RECIBIDO', 'VALIDADO'] } },
        include: { distribuciones: { include: { categoria: true } } },
        orderBy: { fecha_movimiento: 'asc' },
      }),
      this.db.movimientoFinanciero.findMany({
        where: { fecha_movimiento: { lte: period.to }, estatus: { in: ['APLICADO', 'RECIBIDO', 'VALIDADO'] } },
        include: { distribuciones: { include: { categoria: true } } },
        orderBy: { fecha_movimiento: 'asc' },
      }),
      this.db.honorarioGenerado.findMany({ where: { fecha_reconocimiento: { lte: period.to }, estado: { not: 'CANCELADO' } }, select: { monto: true } }),
    ]);
    const canonicalMovement = (movement: typeof movements[number]) => ({
      nature: movement.naturaleza,
      amount: Number(movement.monto),
      status: movement.estatus,
      allocations: movement.distribuciones.length
        ? movement.distribuciones.map((item) => ({ nature: item.categoria.naturaleza as EconomicNature, amount: Number(item.monto) }))
        : legacyFinanceAllocations(movement.naturaleza, movement.categoria, Number(movement.monto)),
    });
    const periodKpis = calculateFinanceAggregates({ generatedFees: [], movements: movements.map(canonicalMovement) });
    const asOfKpis = calculateFinanceAggregates({ generatedFees: fees.map((item) => Number(item.monto)), movements: movementsAsOf.map(canonicalMovement) });
    const kpis = {
      ...periodKpis,
      honorarios_generados: asOfKpis.honorarios_generados,
      honorarios_por_cobrar: asOfKpis.honorarios_por_cobrar,
    };
    const monthly = new Map<string, { periodo: string; ingresos: number; honorarios: number; egresos: number }>();
    movements.forEach((movement) => {
      const date = new Date(movement.fecha_movimiento);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const row = monthly.get(key) || { periodo: key, ingresos: 0, honorarios: 0, egresos: 0 };
      if (movement.naturaleza === 'INGRESO') row.ingresos += Number(movement.monto);
      else row.egresos += Number(movement.monto);
      row.honorarios += movement.distribuciones.filter((item) => item.categoria.naturaleza === 'DESPACHO').reduce((sum, item) => sum + Number(item.monto), 0);
      monthly.set(key, row);
    });
    const allocation = {
      despacho: kpis.honorarios_cobrados,
      terceros: kpis.fondos_terceros,
      otros: kpis.otros_destinos,
    };
    return { period, kpis, cashFlow: [...monthly.values()], allocation };
  }

  async receivables(input: { page?: number; pageSize?: number; search?: string; responsable_id?: string; notaria_id?: string; fecha_desde?: Date; fecha_hasta?: Date }) {
    const page = Math.max(1, Number(input.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(input.pageSize || 20)));
    const records = await this.db.honorarioGenerado.findMany({
      where: {
        estado: { not: 'CANCELADO' },
        ...(input.fecha_hasta ? { fecha_reconocimiento: { lte: input.fecha_hasta } } : {}),
        ...(input.responsable_id ? { responsable_id: input.responsable_id } : {}),
        ...(input.notaria_id ? { notaria_id: input.notaria_id } : {}),
        ...(input.search ? { OR: [{ expediente: { numero_pravia: { contains: input.search, mode: 'insensitive' } } }, { expediente: { cliente_alias: { contains: input.search, mode: 'insensitive' } } }] } : {}),
      },
      include: {
        expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } },
        cotizacion: { select: { id: true, numero_cotizacion: true, prospecto: { select: { nombre: true } } } },
        responsable: { select: { id: true, nombre: true, apellido: true } },
        notaria: { select: { id: true, nombre: true, numero_notaria: true } },
        distribuciones: { where: { movimiento: { estatus: { in: ['APLICADO', 'RECIBIDO', 'VALIDADO'] }, naturaleza: 'INGRESO', ...(input.fecha_hasta ? { fecha_movimiento: { lte: input.fecha_hasta } } : {}) } }, select: { monto: true } },
      },
      orderBy: { fecha_reconocimiento: 'desc' },
    });
    const items = records.map((item) => ({
      id: item.id,
      expediente: item.expediente,
      cotizacion: item.cotizacion,
      cliente: item.expediente?.cliente_alias || item.cotizacion.prospecto?.nombre || 'Cliente sin registrar',
      responsable: item.responsable ? `${item.responsable.nombre} ${item.responsable.apellido}`.trim() : 'Sin responsable',
      notaria: item.notaria?.nombre || 'Sin notaría',
      fecha_reconocimiento: item.fecha_reconocimiento,
      fecha_vencimiento: item.fecha_vencimiento,
      ultimo_pago: null,
      ...calculateReceivable({ generated: Number(item.monto), collected: item.distribuciones.reduce((sum, row) => sum + Number(row.monto), 0), dueDate: item.fecha_vencimiento }),
    })).filter((item) => item.pending > 0);
    const totals = items.reduce((summary, item) => ({
      generated: summary.generated + item.generated,
      collected: summary.collected + item.collected,
      pending: summary.pending + item.pending,
    }), { generated: 0, collected: 0, pending: 0 });
    const start = (page - 1) * pageSize;
    return { items: items.slice(start, start + pageSize), meta: { page, pageSize, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)), agingAvailable: items.some((item) => item.bucket !== null), totals } };
  }
}
