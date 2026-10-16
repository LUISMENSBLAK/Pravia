import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { prospectoObjectWhere, cotizacionObjectWhere } from './objectAccess.service';
import type { MiDiaScope } from '../domain/miDiaCardCatalog';
import { miDiaPeriodRange, type MiDiaPeriod } from '../domain/miDiaPeriod';

type Actor = NonNullable<Request['user']>;
export type CommercialCardKey = 'PROSPECTS_ACTIVE' | 'PROSPECTS_NEW' | 'PROSPECTS_STALE' | 'PROSPECTS_READY'
  | 'QUOTES_ACTIVE' | 'QUOTES_TO_SEND' | 'QUOTES_NO_RESPONSE' | 'QUOTES_FOLLOWUP' | 'QUOTES_ACCEPTED'
  | 'QUOTES_CONVERSION' | 'CASES_CONVERSION' | 'QUOTES_ACTIVE_VALUE' | 'QUOTES_ACCEPTED_VALUE';
export type CommercialCardResult = { count: number; denominator?: number; rate?: number | null;
  amount?: string | null; items: Array<{
  id: string; folio: string; cliente: string; estado: string; contexto: string | null; amount?: string; href: string;
}> };

const activeProspectStages = ['NUEVO', 'EN_INTEGRACION', 'LISTO_PARA_COTIZAR'] as const;
const activeQuoteStages = ['BORRADOR', 'EN_ELABORACION', 'ENVIADA_CLIENTE', 'EN_SEGUIMIENTO'] as const;

/** The source's object boundary is always applied before a dashboard scope or filter. */
export class MiDiaCommercialCardsService {
  constructor(private readonly db: PrismaClient) {}

  async read(actor: Actor, key: CommercialCardKey, options: {
    scope: MiDiaScope; requestedUserId?: unknown; limit?: number; window?: number;
    period?: MiDiaPeriod; timezone?: string; now?: Date; offset?: number;
  }): Promise<CommercialCardResult> {
    const isProspect = key.startsWith('PROSPECTS_');
    const permission = isProspect ? 'prospectos.read' : 'cotizaciones.read';
    if (!actor.permissions.includes(permission)) throw new Error('MIDIA_COMMERCIAL_READ_DENIED');
    const now = options.now ?? new Date();
    const own = options.scope === 'OWN' || actor.scope !== 'GLOBAL';
    const selectedUserId = !own && typeof options.requestedUserId === 'string' && options.requestedUserId !== 'TODOS'
      ? options.requestedUserId : null;
    const effectiveUserId = own ? actor.id : selectedUserId;
    const limit = options.limit ?? 5;
    const offset = Math.max(0, options.offset ?? 0);
    if (isProspect) {
      const scope: Prisma.ProspectoWhereInput = { ...prospectoObjectWhere(actor), archived_at: null,
        ...(effectiveUserId ? { user_id: effectiveUserId } : {}) };
      let condition: Prisma.ProspectoWhereInput;
      if (key === 'PROSPECTS_ACTIVE') condition = { etapa_contractual: { in: [...activeProspectStages] } };
      else if (key === 'PROSPECTS_READY') condition = { etapa_contractual: 'LISTO_PARA_COTIZAR' };
      else if (key === 'PROSPECTS_NEW') {
        const { from, to } = miDiaPeriodRange(options.period ?? 'MONTH', options.timezone, now);
        condition = { created_at: { gte: from, lt: to } };
      } else {
        const cutoff = new Date(now);
        cutoff.setUTCDate(cutoff.getUTCDate() - (options.window ?? 7));
        condition = { etapa_contractual: { in: [...activeProspectStages] }, created_at: { lt: cutoff },
          transiciones: { none: { organization_id: actor.organizationId, effective_at: { gte: cutoff } } },
          seguimientos: { none: { created_at: { gte: cutoff } } } };
      }
      const where: Prisma.ProspectoWhereInput = { AND: [scope, condition] };
      const [count, rows] = await Promise.all([
        this.db.prospecto.count({ where }),
        this.db.prospecto.findMany({ where, select: { id: true, folio: true, nombre: true,
          etapa_contractual: true, created_at: true },
          orderBy: [{ created_at: 'desc' }, { id: 'asc' }], skip: offset, take: limit }),
      ]);
      return { count, items: rows.map((row) => ({ id: row.id, folio: row.folio || 'Prospecto sin folio',
        cliente: row.nombre, estado: row.etapa_contractual || 'HISTORICO',
        contexto: null, href: `/prospectos/${row.id}` })) };
    }
    const scope: Prisma.CotizacionWhereInput = { ...cotizacionObjectWhere(actor),
      ...(effectiveUserId ? { user_id: effectiveUserId } : {}) };
    if (key === 'QUOTES_ACTIVE_VALUE' || key === 'QUOTES_ACCEPTED_VALUE') {
      const condition: Prisma.CotizacionWhereInput = key === 'QUOTES_ACTIVE_VALUE'
        ? { etapa_contractual: { in: [...activeQuoteStages] } }
        : (() => {
          const { from, to } = miDiaPeriodRange(options.period ?? 'MONTH', options.timezone, now);
          return { etapa_contractual: 'ACEPTADA', fecha_aceptacion_cliente: { gte: from, lt: to } };
        })();
      const where: Prisma.CotizacionWhereInput = { AND: [scope, condition] };
      // Cotizaciones already uses total_cliente for its own list aggregate; this
      // card consumes that same current amount, never a generated/collected fee.
      const [count, aggregate, rows] = await Promise.all([
        this.db.cotizacion.count({ where }),
        this.db.cotizacion.aggregate({ where, _sum: { total_cliente: true } }),
        this.db.cotizacion.findMany({ where, select: { id: true, numero_cotizacion: true,
          etapa_contractual: true, total_cliente: true, prospecto: { select: { nombre: true } } },
          orderBy: [{ created_at: 'desc' }, { id: 'asc' }], skip: offset, take: limit }),
      ]);
      return { count, amount: aggregate._sum.total_cliente?.toFixed(2) ?? null,
        items: rows.map((row) => ({ id: row.id, folio: row.numero_cotizacion || 'Cotización sin folio',
          cliente: row.prospecto?.nombre || 'Sin prospecto visible', estado: row.etapa_contractual || 'HISTORICO',
          contexto: null, amount: row.total_cliente?.toFixed(2) ?? '0.00', href: `/cotizaciones/${row.id}` })) };
    }
    if (key === 'QUOTES_TO_SEND') {
      // The editable structured budget is the current pre-send source. The
      // immutable approved snapshot is created atomically by ENVIAR_CLIENTE,
      // so requiring it here would hide every normally prepared quote.
      const where: Prisma.CotizacionWhereInput = { AND: [scope, {
        etapa_contractual: 'EN_ELABORACION', total_cliente: { gt: 0 },
        conceptos: { some: { organization_id: actor.organizationId } },
      }] };
      const [count, rows] = await Promise.all([
        this.db.cotizacion.count({ where }),
        this.db.cotizacion.findMany({ where,
        select: { id: true, numero_cotizacion: true, etapa_contractual: true,
          prospecto: { select: { nombre: true } } }, orderBy: [{ created_at: 'desc' }, { id: 'asc' }], skip: offset, take: limit }),
      ]);
      return { count, items: rows.map((row) => ({ id: row.id,
        folio: row.numero_cotizacion || 'Cotización sin folio', cliente: row.prospecto?.nombre || 'Sin prospecto visible',
        estado: row.etapa_contractual || 'HISTORICO', contexto: null, href: `/cotizaciones/${row.id}` })) };
    }
    if (key === 'QUOTES_CONVERSION' || key === 'CASES_CONVERSION') {
      const { from, to } = miDiaPeriodRange(options.period ?? 'MONTH', options.timezone, now);
      // Cohortes idénticas al embudo comercial: enviados→aceptados y aceptados→expedientes.
      // Cada Cotización tiene a lo sumo un Expediente; no contamos intentos/reintentos.
      const cohort: Prisma.CotizacionWhereInput = { AND: [scope, key === 'QUOTES_CONVERSION'
        ? { fecha_enviada_cliente: { gte: from, lt: to } }
        : { fecha_aceptacion_cliente: { gte: from, lt: to } }] };
      const converted: Prisma.CotizacionWhereInput = { AND: [cohort, key === 'QUOTES_CONVERSION'
        ? { fecha_aceptacion_cliente: { not: null } }
        : { fecha_conversion_expediente: { not: null }, expediente: { is: { organization_id: actor.organizationId } } }] };
      const [denominator, count, rows] = await Promise.all([
        this.db.cotizacion.count({ where: cohort }), this.db.cotizacion.count({ where: converted }),
        this.db.cotizacion.findMany({ where: converted, select: { id: true, numero_cotizacion: true,
          etapa_contractual: true, prospecto: { select: { nombre: true } },
          expediente: { select: { id: true, numero_pravia: true } } },
          orderBy: [{ created_at: 'desc' }, { id: 'asc' }], skip: offset, take: limit }),
      ]);
      return { count, denominator, rate: denominator ? Number(((count / denominator) * 100).toFixed(1)) : null,
        items: rows.map((row) => ({ id: key === 'CASES_CONVERSION' ? row.expediente!.id : row.id,
          folio: key === 'CASES_CONVERSION' ? row.expediente!.numero_pravia : row.numero_cotizacion || 'Cotización sin folio',
          cliente: row.prospecto?.nombre || 'Sin prospecto visible', estado: row.etapa_contractual || 'HISTORICO',
          contexto: null, href: key === 'CASES_CONVERSION' ? `/expedientes/${row.expediente!.id}` : `/cotizaciones/${row.id}` })) };
    }
    let condition: Prisma.CotizacionWhereInput;
    if (key === 'QUOTES_ACTIVE') condition = { etapa_contractual: { in: [...activeQuoteStages] } };
    else if (key === 'QUOTES_NO_RESPONSE') {
      const cutoff = new Date(now);
      cutoff.setUTCDate(cutoff.getUTCDate() - (options.window ?? 7));
      condition = { etapa_contractual: 'ENVIADA_CLIENTE', fecha_enviada_cliente: { lte: cutoff } };
    } else if (key === 'QUOTES_FOLLOWUP') condition = { etapa_contractual: 'EN_SEGUIMIENTO' };
    else {
      const { from, to } = miDiaPeriodRange(options.period ?? 'MONTH', options.timezone, now);
      condition = { etapa_contractual: 'ACEPTADA', fecha_aceptacion_cliente: { gte: from, lt: to } };
    }
    const where: Prisma.CotizacionWhereInput = { AND: [scope, condition] };
    const [count, rows] = await Promise.all([
      this.db.cotizacion.count({ where }),
      this.db.cotizacion.findMany({ where, select: { id: true, numero_cotizacion: true,
        etapa_contractual: true, prospecto: { select: { nombre: true } } },
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }], skip: offset, take: limit }),
    ]);
    return { count, items: rows.map((row) => ({ id: row.id,
      folio: row.numero_cotizacion || 'Cotización sin folio', cliente: row.prospecto?.nombre || 'Sin prospecto visible',
      estado: row.etapa_contractual || 'HISTORICO', contexto: null, href: `/cotizaciones/${row.id}` })) };
  }
}
