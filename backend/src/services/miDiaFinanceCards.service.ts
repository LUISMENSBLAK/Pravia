import { Prisma, type PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { APPLIED_MOVEMENT_STATUSES, calculateReceivable, legacyFinanceAllocations, moneyToCents } from '../domain/financeCore';
import { centsToMoney, moneyToCents as budgetMoneyToCents } from '../domain/expedienteBudget';
import { cfdiIncomeBalance } from '../domain/cfdiIncomeBalance';
import { hasCompleteCfdiDraftData } from '../domain/cfdiDraftReadiness';
import type { MiDiaScope } from '../domain/miDiaCardCatalog';
import { miDiaPeriodRange, type MiDiaPeriod } from '../domain/miDiaPeriod';
import { miDiaDashboardScope } from './miDiaDashboardScope';

type Actor = NonNullable<Request['user']>;
export type FinanceCardKey = 'INCOME_COLLECTED' | 'COLLECTED_TODAY' | 'FEES_SCHEDULED_SIGN' | 'FEES_SIGNED'
  | 'ADVANCES_PENDING' | 'PRODUCTION_VALUE'
  | 'PAYMENTS_DUE' | 'PAYMENTS_UNPROVEN' | 'COLLECTION_SCHEDULED' | 'CLIENT_RESOURCES' | 'REP_PENDING'
  | 'INVOICES_PENDING' | 'CFDI_TO_STAMP';
export type FinanceCardResult = { count: number; amount: string; items: Array<{
  id: string; folio: string; concepto: string; amount: string; received_at: string; href: string;
}>; available?: boolean; message?: string };

/** Reads the same applied movement ledger and status set as Finanzas; never infers cash from quotes or invoices. */
export class MiDiaFinanceCardsService {
  constructor(private readonly db: PrismaClient) {}

  async read(actor: Actor, key: FinanceCardKey, options: {
    scope: MiDiaScope; requestedUserId?: unknown; period?: MiDiaPeriod;
    timezone?: string; now?: Date; limit?: number; offset?: number;
  }): Promise<FinanceCardResult> {
    if (!actor.permissions.includes('finanzas.read')) throw new Error('MIDIA_FINANCE_READ_DENIED');
    const offset = Math.max(0, options.offset ?? 0);
    if (key === 'ADVANCES_PENDING') {
      // EXP-008 stores applied advances, but no explicit required advance per case.
      // A quote, budget total or percentage cannot substitute for that source.
      return { count: 0, amount: '0.00', items: [], available: false,
        message: 'Sin información: falta el anticipo requerido explícito por expediente en Finanzas/Presupuesto.' };
    }
    const own = options.scope === 'OWN' || actor.scope !== 'GLOBAL';
    const selectedUserId = !own && typeof options.requestedUserId === 'string' && options.requestedUserId !== 'TODOS'
      ? options.requestedUserId : null;
    const effectiveUserId = own ? actor.id : selectedUserId;
    const { financialCaseWhere } = miDiaDashboardScope(actor, options.requestedUserId, options.scope);
    const { from, to } = miDiaPeriodRange(key === 'COLLECTED_TODAY' ? 'TODAY'
      : key === 'PRODUCTION_VALUE' && options.period !== 'YEAR' ? 'MONTH' : options.period ?? 'MONTH',
      options.timezone, options.now);
    if (key === 'CFDI_TO_STAMP') {
      const drafts = await this.db.documentoCfdi.findMany({ where: {
        organization_id: actor.organizationId, direccion: 'EMITIDO', tipo: 'I', estado: 'PREFACTURA',
        ...(effectiveUserId ? { OR: [
          { expediente: { is: financialCaseWhere } },
          { expediente_id: null, created_by_id: effectiveUserId },
        ] } : {}),
      }, select: { id: true, direccion: true, tipo: true, estado: true, entidad_fiscal_id: true,
        entidadFiscal: { select: { activa: true } }, emisor_rfc: true, receptor_rfc: true,
        receptor_nombre: true, receptor_regimen: true, receptor_codigo_postal: true,
        uso_cfdi: true, metodo_pago: true, forma_pago: true, moneda: true,
        subtotal: true, impuestos_trasladados: true, impuestos_retenidos: true, total: true,
        draft_payload: true, serie: true, folio: true, created_at: true,
        expediente: { select: { numero_pravia: true } },
      }, orderBy: [{ created_at: 'desc' }, { id: 'desc' }] });
      const complete = drafts.filter(hasCompleteCfdiDraftData);
      const amount = complete.reduce((sum, row) => sum.plus(row.total), new Prisma.Decimal(0));
      return { count: complete.length, amount: amount.toFixed(2),
        items: complete.slice(offset, offset + (options.limit ?? 5)).map((row) => ({ id: row.id,
          folio: `${row.serie || ''}${row.folio || ''}` || row.expediente?.numero_pravia || 'Prefactura',
          concepto: `${row.receptor_nombre} · Datos mínimos completos; PAC no certificado`,
          amount: row.total.toFixed(2), received_at: row.created_at.toISOString(),
          href: `/finanzas?view=facturacion&cfdi_id=${row.id}`,
        })) };
    }
    if (key === 'INVOICES_PENDING') {
      const incomes = await this.db.expedienteIngresoReportado.findMany({ where: {
        organization_id: actor.organizationId, estado: { not: 'ANULADO' }, factura_estado: 'PENDIENTE',
        expediente: { is: financialCaseWhere },
      }, select: { id: true, concepto_contexto: true, monto_reportado: true, monto_validado: true,
        factura_estado: true, created_at: true, expediente: { select: { numero_pravia: true, cliente_alias: true } },
        documentosCfdi: { select: { estado: true, total: true } },
      }, orderBy: [{ created_at: 'desc' }, { id: 'desc' }] });
      const pending = incomes.flatMap((row) => {
        const amount = row.monto_validado ?? row.monto_reportado;
        if (!amount || amount.lessThanOrEqualTo(0)) return [];
        const balance = cfdiIncomeBalance({ amount, facturaEstado: row.factura_estado,
          linked: row.documentosCfdi });
        if (balance.remainingInvoiceableAmount.lessThanOrEqualTo(0)) return [];
        return [{ row, balance }];
      });
      const amount = pending.reduce((sum, item) => sum.plus(item.balance.remainingInvoiceableAmount),
        new Prisma.Decimal(0));
      return { count: pending.length, amount: amount.toFixed(2),
        items: pending.slice(offset, offset + (options.limit ?? 5)).map(({ row, balance }) => ({ id: row.id,
          folio: row.expediente.numero_pravia,
          concepto: `${row.concepto_contexto || row.expediente.cliente_alias || 'Ingreso del expediente'} · Facturable ${balance.facturableAmount.toFixed(2)} · Facturado ${balance.invoicedAmount.toFixed(2)}`,
          amount: balance.remainingInvoiceableAmount.toFixed(2), received_at: row.created_at.toISOString(),
          href: `/finanzas?view=facturacion&income_id=${row.id}`,
        })) };
    }
    if (key === 'REP_PENDING') {
      // prepareRep accepts a PPD invoice only after the source has a real UUID
      // and a stamped/vigente state; an application with rep_cfdi_id is already covered.
      const where: Prisma.AplicacionPagoCfdiWhereInput = {
        organization_id: actor.organizationId, rep_cfdi_id: null,
        movimiento: { is: { organization_id: actor.organizationId, naturaleza: 'INGRESO',
          estatus: { in: [...APPLIED_MOVEMENT_STATUSES] } } },
        cfdi: { is: { organization_id: actor.organizationId, direccion: 'EMITIDO', tipo: 'I',
          metodo_pago: 'PPD', uuid_fiscal: { not: null }, estado: { in: ['VIGENTE', 'TIMBRADO'] },
          ...(effectiveUserId ? { OR: [
            { expediente: { is: financialCaseWhere } },
            { expediente_id: null, created_by_id: effectiveUserId },
          ] } : {}),
        } },
      };
      const [count, sum, rows] = await Promise.all([
        this.db.aplicacionPagoCfdi.count({ where }),
        this.db.aplicacionPagoCfdi.aggregate({ where, _sum: { monto_aplicado: true } }),
        this.db.aplicacionPagoCfdi.findMany({ where,
          select: { id: true, monto_aplicado: true, created_at: true,
            cfdi: { select: { id: true, serie: true, folio: true, uuid_fiscal: true,
              receptor_nombre: true, expediente: { select: { numero_pravia: true } } } } },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }], skip: offset, take: options.limit ?? 5 }),
      ]);
      return { count, amount: sum._sum.monto_aplicado?.toFixed(2) ?? '0.00', items: rows.map((row) => ({
        id: row.id, folio: `${row.cfdi.serie || ''}${row.cfdi.folio || ''}` || row.cfdi.expediente?.numero_pravia
          || row.cfdi.uuid_fiscal || 'CFDI sin folio visible',
        concepto: row.cfdi.receptor_nombre, amount: row.monto_aplicado.toFixed(2),
        received_at: row.created_at.toISOString(), href: `/finanzas?view=facturacion&cfdi_id=${row.cfdi.id}`,
      })) };
    }
    if (key === 'CLIENT_RESOURCES') {
      // The EXP-008 account statement uses the same applied ledger allocations:
      // third-party income less third-party outgoings, floored at zero per case.
      const rows = await this.db.movimientoFinanciero.findMany({ where: {
        organization_id: actor.organizationId, expediente_id: { not: null },
        expediente: { is: financialCaseWhere }, estatus: { in: [...APPLIED_MOVEMENT_STATUSES] },
      }, select: { id: true, naturaleza: true, categoria: true, monto: true, fecha_movimiento: true, expediente_id: true,
        expediente: { select: { numero_pravia: true, cliente_alias: true } },
        distribuciones: { select: { monto: true, categoria: { select: { naturaleza: true } } } },
      }, orderBy: [{ fecha_movimiento: 'desc' }, { id: 'desc' }] });
      const byCase = new Map<string, { folio: string; cliente: string; collected: bigint; delivered: bigint; latest: Date }>();
      for (const row of rows) {
        if (!row.expediente_id || !row.expediente) continue;
        const current = byCase.get(row.expediente_id) ?? { folio: row.expediente.numero_pravia,
          cliente: row.expediente.cliente_alias || 'Cliente pendiente', collected: 0n, delivered: 0n,
          latest: row.fecha_movimiento };
        const thirdParty = row.distribuciones.length
          ? row.distribuciones.filter((distribution) => distribution.categoria.naturaleza === 'TERCERO')
            .reduce((sum, distribution) => sum + budgetMoneyToCents(String(distribution.monto)), 0n)
          : legacyFinanceAllocations(row.naturaleza, row.categoria, Number(row.monto))
            .filter((distribution) => distribution.nature === 'TERCERO')
            .reduce((sum, distribution) => sum + budgetMoneyToCents(String(distribution.amount)), 0n);
        if (row.naturaleza === 'INGRESO') current.collected += thirdParty;
        else current.delivered += thirdParty;
        if (row.fecha_movimiento > current.latest) current.latest = row.fecha_movimiento;
        byCase.set(row.expediente_id, current);
      }
      const available = [...byCase.entries()].map(([id, row]) => ({ id, ...row,
        remaining: row.collected > row.delivered ? row.collected - row.delivered : 0n }))
        .filter((row) => row.remaining > 0n)
        .sort((left, right) => left.folio.localeCompare(right.folio));
      const amount = available.reduce((sum, row) => sum + row.remaining, 0n);
      return { count: available.length, amount: centsToMoney(amount),
        items: available.slice(offset, offset + (options.limit ?? 5)).map((row) => ({ id: row.id, folio: row.folio,
          concepto: row.cliente, amount: centsToMoney(row.remaining), received_at: row.latest.toISOString(),
          href: `/expedientes/${row.id}#finanzas`,
        })) };
    }
    if (key === 'COLLECTION_SCHEDULED') {
      // Match Finanzas/Cartera: recognized fees minus allocations of applied incoming movements.
      // A missing contractual due date is not a scheduled collection.
      const records = await this.db.honorarioGenerado.findMany({
        where: { organization_id: actor.organizationId, estado: { not: 'CANCELADO' },
          fecha_vencimiento: { gte: from, lt: to },
          ...(effectiveUserId ? { OR: [
            { responsable_id: effectiveUserId },
            { responsable_id: null, expediente: { is: financialCaseWhere } },
          ] } : {}) },
        select: { id: true, monto: true, fecha_vencimiento: true,
          expediente: { select: { numero_pravia: true, cliente_alias: true } },
          cotizacion: { select: { id: true, numero_cotizacion: true,
            prospecto: { select: { nombre: true } } } },
          distribuciones: { where: { movimiento: { organization_id: actor.organizationId,
            naturaleza: 'INGRESO', estatus: { in: [...APPLIED_MOVEMENT_STATUSES] } } },
            select: { monto: true } },
        },
        orderBy: [{ fecha_vencimiento: 'asc' }, { id: 'asc' }],
      });
      const pending = records.map((row) => ({ row, amount: calculateReceivable({
        generated: Number(row.monto),
        collected: row.distribuciones.reduce((sum, distribution) => sum + Number(distribution.monto), 0),
        dueDate: row.fecha_vencimiento,
        now: options.now,
      }).pending })).filter(({ amount }) => amount > 0);
      const amountCents = pending.reduce((sum, item) => sum + moneyToCents(item.amount), 0);
      return { count: pending.length, amount: (amountCents / 100).toFixed(2),
        items: pending.slice(offset, offset + (options.limit ?? 5)).map(({ row, amount }) => ({
          id: row.id, folio: row.expediente?.numero_pravia || row.cotizacion.numero_cotizacion || 'Cotización',
          concepto: row.expediente?.cliente_alias || row.cotizacion.prospecto?.nombre || 'Cliente sin registrar',
          amount: amount.toFixed(2), received_at: row.fecha_vencimiento!.toISOString(),
          href: `/cotizaciones/${row.cotizacion.id}`,
        })) };
    }
    if (key === 'PAYMENTS_DUE' || key === 'PAYMENTS_UNPROVEN') {
      const unproven = key === 'PAYMENTS_UNPROVEN';
      const where: Prisma.ExpedienteSolicitudPagoWhereInput = {
        organization_id: actor.organizationId,
        expediente: { is: financialCaseWhere },
        ...(unproven ? { estado: 'PAGADA', movimiento_id: { not: null },
          documentos: { none: { organization_id: actor.organizationId, estatus: 'ACTIVO',
            tipo: 'COMPROBANTE_PAGO', documento: { estatus: 'VIGENTE' } } } }
          : { estado: 'PENDIENTE' }),
      };
      const [count, sum, rows] = await Promise.all([
        this.db.expedienteSolicitudPago.count({ where }),
        this.db.expedienteSolicitudPago.aggregate({ where, _sum: { importe: true } }),
        this.db.expedienteSolicitudPago.findMany({ where,
          select: { id: true, expediente_id: true, concepto: true, importe: true, created_at: true, pagado_at: true,
            expediente: { select: { numero_pravia: true } } },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }], skip: offset, take: options.limit ?? 5 }),
      ]);
      return { count, amount: sum._sum.importe?.toFixed(2) ?? '0.00',
        items: rows.map((row) => ({ id: row.id, folio: row.expediente.numero_pravia,
          concepto: row.concepto, amount: row.importe.toFixed(2),
          received_at: (unproven ? row.pagado_at : row.created_at)?.toISOString() ?? row.created_at.toISOString(),
          href: `/expedientes/${row.expediente_id}?payment_request_id=${row.id}#finanzas`,
        })) };
    }
    if (key === 'FEES_SCHEDULED_SIGN' || key === 'FEES_SIGNED' || key === 'PRODUCTION_VALUE') {
      const signed = key !== 'FEES_SCHEDULED_SIGN';
      const productionResponsible = key === 'PRODUCTION_VALUE' && effectiveUserId
        ? { abogado_id: effectiveUserId } : null;
      const where: Prisma.ExpedienteWhereInput = { AND: [financialCaseWhere,
        ...(productionResponsible ? [productionResponsible] : []), signed
        ? { fecha_real_firma: { gte: from, lt: to } }
        : { fecha_estimada_firma: { gte: from, lt: to }, fecha_real_firma: null }] };
      if (key === 'PRODUCTION_VALUE') {
        const withoutBudget = await this.db.expediente.count({ where: { AND: [where,
          { presupuesto: { is: null } }] } });
        if (withoutBudget > 0) return { count: 0, amount: '0.00', items: [], available: false,
          message: `Sin información: ${withoutBudget} expediente(s) firmado(s) carecen del presupuesto canónico de honorarios.` };
      }
      const [count, sum, rows] = await Promise.all([
        this.db.expediente.count({ where }),
        this.db.expedientePresupuesto.aggregate({ where: { organization_id: actor.organizationId,
          expediente: { is: where } }, _sum: { subtotal_honorarios: true } }),
        this.db.expediente.findMany({ where,
          select: { id: true, numero_pravia: true, cliente_alias: true, fecha_estimada_firma: true,
            fecha_real_firma: true, presupuesto: { select: { subtotal_honorarios: true } } },
          orderBy: signed ? [{ fecha_real_firma: 'desc' }, { id: 'desc' }] : [{ fecha_estimada_firma: 'asc' }, { id: 'asc' }],
          ...(key === 'PRODUCTION_VALUE' ? {} : { skip: offset, take: options.limit ?? 5 }) }),
      ]);
      if (key === 'PRODUCTION_VALUE') {
        const visibleTotal = rows.reduce((total, row) => total
          + budgetMoneyToCents(row.presupuesto!.subtotal_honorarios.toFixed(2)), 0n);
        const aggregateTotal = budgetMoneyToCents(sum._sum.subtotal_honorarios?.toFixed(2) ?? '0.00');
        if (rows.length !== count || visibleTotal !== aggregateTotal) return {
          count: 0, amount: '0.00', items: [], available: false,
          message: 'Sin información: el presupuesto o la firma cambió durante la consulta. Vuelve a cargar la tarjeta.',
        };
      }
      return { count, amount: sum._sum.subtotal_honorarios?.toFixed(2) ?? '0.00',
        items: (key === 'PRODUCTION_VALUE' ? rows.slice(offset, offset + (options.limit ?? 5)) : rows).map((row) => ({ id: row.id, folio: row.numero_pravia,
          concepto: row.cliente_alias || 'Cliente pendiente', amount: row.presupuesto?.subtotal_honorarios.toFixed(2) ?? '0.00',
          received_at: (signed ? row.fecha_real_firma : row.fecha_estimada_firma)!.toISOString(),
          href: `/expedientes/${row.id}#finanzas`,
        })) };
    }
    const where: Prisma.MovimientoFinancieroWhereInput = {
      organization_id: actor.organizationId,
      naturaleza: 'INGRESO',
      estatus: { in: [...APPLIED_MOVEMENT_STATUSES] },
      fecha_movimiento: { gte: from, lt: to },
      ...(effectiveUserId ? { OR: [
        { responsable_id: effectiveUserId },
        { responsable_id: null, expediente: { is: financialCaseWhere } },
      ] } : {}),
    };
    const [count, sum, rows] = await Promise.all([
      this.db.movimientoFinanciero.count({ where }),
      this.db.movimientoFinanciero.aggregate({ where, _sum: { monto: true } }),
      this.db.movimientoFinanciero.findMany({ where,
        select: { id: true, folio: true, concepto: true, monto: true, fecha_movimiento: true },
        orderBy: [{ fecha_movimiento: 'desc' }, { id: 'desc' }], skip: offset, take: options.limit ?? 5 }),
    ]);
    return { count, amount: sum._sum.monto?.toFixed(2) ?? '0.00',
      items: rows.map((row) => ({ id: row.id, folio: row.folio || 'Movimiento sin folio',
        concepto: row.concepto, amount: row.monto.toFixed(2), received_at: row.fecha_movimiento.toISOString(),
        href: `/finanzas?view=movimientos&movimiento_id=${row.id}`,
      })) };
  }
}
