import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { miDiaCardByKey, type MiDiaScope } from '../domain/miDiaCardCatalog';
import { AGENDA_TIME_ZONE } from '../domain/agenda';
import { resolveAssistantTimeRange, resolveAssistantUpcomingDayWindow } from './assistantTime';
import { ArchivoService } from './archivo.service';
import { FinanceAnalyticsService } from './financeAnalytics.service';
import { MiDiaArchiveCardsService, type ArchiveCardKey } from './miDiaArchiveCards.service';
import { MiDiaCaseCardsService, type CaseCardKey } from './miDiaCaseCards.service';
import { MiDiaCommercialCardsService, type CommercialCardKey } from './miDiaCommercialCards.service';
import { MiDiaComplianceCardsService, type ComplianceCardKey } from './miDiaComplianceCards.service';
import { MiDiaConfigurationService } from './miDiaConfiguration.service';
import { miDiaDashboardScope } from './miDiaDashboardScope';
import { MiDiaDocumentCardsService, type DocumentCardKey } from './miDiaDocumentCards.service';
import { MiDiaFinanceCardsService, type FinanceCardKey } from './miDiaFinanceCards.service';
import { MiDiaProcessCardsService, type ProcessCardKey } from './miDiaProcessCards.service';
import { MiDiaSignatureCardsService, type SignatureCardKey, type SignaturePeriod } from './miDiaSignatureCards.service';
import { prospectoObjectWhere } from './objectAccess.service';

type Actor = NonNullable<Request['user']>;
type DetailOptions = { page?: unknown; pageSize?: unknown; requestedUserId?: unknown; now?: Date };
type ReaderResult = { count: number; amount?: string | null; available?: boolean; message?: string; items: unknown[] };

const processKeys = new Set<ProcessCardKey>(['MY_PENDING', 'OVERDUE_PROCESSES', 'DUE_TODAY', 'UPCOMING_DUE',
  'CATASTRO_PENDING', 'RPP_PENDING', 'TESTIMONIES_PENDING', 'CAN_ADVANCE_TODAY']);
const caseKeys = new Set<CaseCardKey>(['CASES_INACTIVE', 'CASES_DELAYED', 'CASES_BLOCKED', 'POSTSIGN_PENDING', 'DELIVERIES_PENDING', 'MY_ACTIVE_CASES']);
const signatureKeys = new Set<SignatureCardKey>(['READY_TO_SIGN', 'NOT_READY_TO_SIGN', 'SIGNED_TODAY', 'SIGNED_PERIOD', 'SIGNED_CASES']);
const commercialKeys = new Set<CommercialCardKey>(['PROSPECTS_ACTIVE', 'PROSPECTS_NEW', 'PROSPECTS_STALE', 'PROSPECTS_READY',
  'QUOTES_ACTIVE', 'QUOTES_TO_SEND', 'QUOTES_NO_RESPONSE', 'QUOTES_FOLLOWUP', 'QUOTES_ACCEPTED',
  'QUOTES_CONVERSION', 'CASES_CONVERSION', 'QUOTES_ACTIVE_VALUE', 'QUOTES_ACCEPTED_VALUE']);
const financeKeys = new Set<FinanceCardKey>(['INCOME_COLLECTED', 'COLLECTED_TODAY', 'COLLECTION_SCHEDULED', 'FEES_SCHEDULED_SIGN', 'FEES_SIGNED',
  'ADVANCES_PENDING', 'PRODUCTION_VALUE', 'PAYMENTS_DUE', 'PAYMENTS_UNPROVEN', 'CLIENT_RESOURCES', 'REP_PENDING', 'INVOICES_PENDING', 'CFDI_TO_STAMP']);
const documentKeys = new Set<DocumentCardKey>(['MISSING_DOCUMENTS', 'DOCUMENTS_TO_REVIEW', 'EXPIRED_DOCUMENTS', 'FORMATS_TO_GENERATE', 'FORMATS_TO_SIGN', 'DOCUMENT_INCONSISTENCIES']);
const complianceKeys = new Set<ComplianceCardKey>(['PLD_INCOMPLETE', 'NOTICES_PENDING', 'NOTICES_UPCOMING', 'NOTICES_OVERDUE', 'CRITICAL_ALERTS']);
const legacyKeys = new Set(['CASES', 'URGENT_TASKS', 'TODAY_AGENDA', 'TODAY_SIGNINGS', 'UPCOMING_APPOINTMENTS',
  'UPCOMING_SIGNINGS', 'RECEIVABLE', 'FOLLOWUP_REMINDERS']);

export const MI_DIA_DETAIL_KEYS = new Set<string>([
  ...processKeys, ...caseKeys, ...signatureKeys, ...commercialKeys, ...financeKeys,
  ...documentKeys, ...complianceKeys, 'DEEDS_TODAY', ...legacyKeys,
]);

export class MiDiaCardDetailError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/**
 * Paginated detail over the same source readers used by Mi Día. Scope, period and
 * window come exclusively from the persisted layout; query parameters cannot widen them.
 */
export class MiDiaCardDetailService {
  private readonly configuration: MiDiaConfigurationService;
  private readonly processes: MiDiaProcessCardsService;
  private readonly cases: MiDiaCaseCardsService;
  private readonly signatures: MiDiaSignatureCardsService;
  private readonly commercial: MiDiaCommercialCardsService;
  private readonly finance: MiDiaFinanceCardsService;
  private readonly documents: MiDiaDocumentCardsService;
  private readonly compliance: MiDiaComplianceCardsService;
  private readonly archive: MiDiaArchiveCardsService;
  private readonly receivables: FinanceAnalyticsService;

  constructor(private readonly db: PrismaClient) {
    this.configuration = new MiDiaConfigurationService(db);
    this.processes = new MiDiaProcessCardsService(db);
    this.cases = new MiDiaCaseCardsService(db);
    this.signatures = new MiDiaSignatureCardsService(db);
    this.commercial = new MiDiaCommercialCardsService(db);
    this.finance = new MiDiaFinanceCardsService(db);
    this.documents = new MiDiaDocumentCardsService(db);
    this.compliance = new MiDiaComplianceCardsService(db);
    this.archive = new MiDiaArchiveCardsService(new ArchivoService(db));
    this.receivables = new FinanceAnalyticsService(db);
  }

  async read(actor: Actor, key: string, options: DetailOptions = {}) {
    const page = this.positiveInteger(options.page, 1, 1_000_000, 'MIDIA_DETAIL_PAGE_INVALID', 'La página no es válida.');
    const pageSize = this.positiveInteger(options.pageSize, 20, 50, 'MIDIA_DETAIL_PAGE_SIZE_INVALID', 'El tamaño de página debe estar entre 1 y 50.');
    const configuration = await this.configuration.get(actor);
    const card = configuration.layout.find((entry) => entry.key === key);
    if (!card || !MI_DIA_DETAIL_KEYS.has(key)) {
      throw new MiDiaCardDetailError(404, 'MIDIA_DETAIL_NOT_AVAILABLE', 'La tarjeta no tiene un detalle paginado disponible para este usuario.');
    }
    const definition = miDiaCardByKey.get(key);
    if (!definition || !actor.permissions.includes(definition.permission)) {
      throw new MiDiaCardDetailError(403, 'MIDIA_DETAIL_PERMISSION_DENIED', 'No tienes permiso para consultar este detalle.');
    }
    const preference = await this.db.userPreference.findUnique({ where: { user_id: actor.id }, select: { timezone: true } });
    const timezone = preference?.timezone || AGENDA_TIME_ZONE;
    const now = options.now ?? new Date();
    const offset = (page - 1) * pageSize;
    const shared = { scope: card.scope as MiDiaScope, requestedUserId: options.requestedUserId,
      limit: pageSize, offset, window: typeof card.parameters.window === 'number' ? card.parameters.window : 7,
      period: card.parameters.period as SignaturePeriod | undefined, timezone, now };
    let result: ReaderResult;
    if (processKeys.has(key as ProcessCardKey)) result = await this.processes.read(actor, key as ProcessCardKey, shared);
    else if (caseKeys.has(key as CaseCardKey)) result = await this.cases.read(actor, key as CaseCardKey, shared);
    else if (signatureKeys.has(key as SignatureCardKey)) result = await this.signatures.read(actor, key as SignatureCardKey, shared);
    else if (commercialKeys.has(key as CommercialCardKey)) result = await this.commercial.read(actor, key as CommercialCardKey, shared);
    else if (financeKeys.has(key as FinanceCardKey)) result = await this.finance.read(actor, key as FinanceCardKey, shared);
    else if (documentKeys.has(key as DocumentCardKey)) result = await this.documents.read(actor, key as DocumentCardKey, shared);
    else if (complianceKeys.has(key as ComplianceCardKey)) result = await this.compliance.read(actor, key as ComplianceCardKey, shared);
    else if (key === 'DEEDS_TODAY') {
      const value = (await this.archive.readVisible(actor, [key as ArchiveCardKey], { timezone, now, limit: pageSize, offset }))[key];
      result = { count: Number(value?.value ?? 0), available: value?.available, message: value?.message ?? undefined, items: value?.items ?? [] };
    } else result = await this.readLegacy(actor, key, card.scope as MiDiaScope, card.parameters, {
      page, pageSize, offset, requestedUserId: options.requestedUserId, timezone, now,
    });
    const totalPages = Math.max(1, Math.ceil(result.count / pageSize));
    return {
      key, title: definition.name, scope: card.scope, parameters: card.parameters,
      totalCount: result.count, ...(result.amount !== undefined ? { totalAmount: result.amount } : {}),
      available: result.available !== false, message: result.message ?? null,
      page, pageSize, totalPages, items: result.items,
    };
  }

  private positiveInteger(raw: unknown, fallback: number, maximum: number, code: string, message: string) {
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new MiDiaCardDetailError(400, code, message);
    return value;
  }

  private async readLegacy(actor: Actor, key: string, scope: MiDiaScope, parameters: Record<string, string | number>, options: {
    page: number; pageSize: number; offset: number; requestedUserId?: unknown; timezone: string; now: Date;
  }): Promise<ReaderResult> {
    const dashboard = miDiaDashboardScope(actor, options.requestedUserId, scope);
    const today = resolveAssistantTimeRange('TODAY', options.timezone, options.now);
    if (key === 'CASES') {
      const [count, rows] = await Promise.all([
        this.db.expediente.count({ where: dashboard.caseWhere }),
        this.db.expediente.findMany({ where: dashboard.caseWhere,
          select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true, updated_at: true },
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }], skip: options.offset, take: options.pageSize }),
      ]);
      return { count, items: rows.map((row) => ({ id: row.id, folio: row.numero_pravia,
        nombre: row.cliente_alias || 'Cliente pendiente', estado: row.estatus,
        fecha: row.updated_at.toISOString(), href: `/expedientes/${row.id}` })) };
    }
    if (key === 'URGENT_TASKS') {
      const where: Prisma.TareaWhereInput = { ...dashboard.taskWhere,
        estatus: { in: ['PENDIENTE', 'EN_PROCESO'] } };
      const [count, rows] = await Promise.all([
        this.db.tarea.count({ where }),
        this.db.tarea.findMany({ where, select: { id: true, titulo: true, prioridad: true,
          fecha_limite: true, expediente_id: true, expediente: { select: { numero_pravia: true, cliente_alias: true } } },
          orderBy: [{ fecha_limite: 'asc' }, { prioridad: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
          skip: options.offset, take: options.pageSize }),
      ]);
      return { count, items: rows.map((row) => ({ id: row.id, folio: row.expediente?.numero_pravia ?? 'Sin expediente',
        nombre: row.titulo, estado: row.prioridad, contexto: row.expediente?.cliente_alias ?? null,
        fecha: row.fecha_limite?.toISOString() ?? null,
        href: row.expediente_id ? `/expedientes/${row.expediente_id}` : '/agenda' })) };
    }
    if (key === 'TODAY_AGENDA' || key === 'TODAY_SIGNINGS' || key === 'UPCOMING_APPOINTMENTS') {
      const window = typeof parameters.window === 'number' && [3, 7, 15].includes(parameters.window) ? parameters.window : 7;
      const to = key === 'UPCOMING_APPOINTMENTS'
        ? resolveAssistantUpcomingDayWindow(window as 3 | 7 | 15, options.timezone, options.now).to : today.to;
      const from = key === 'UPCOMING_APPOINTMENTS' ? options.now : today.from;
      const where: Prisma.EventoAgendaWhereInput = { ...dashboard.eventWhere, estatus: 'ACTIVO',
        ...(key === 'TODAY_SIGNINGS' ? { tipo: 'FIRMA' } : key === 'UPCOMING_APPOINTMENTS' ? { tipo: 'CITA' } : {}),
        fecha_inicio: { gte: from, lt: to } };
      const [count, rows] = await Promise.all([
        this.db.eventoAgenda.count({ where }),
        this.db.eventoAgenda.findMany({ where, select: { id: true, titulo: true, tipo: true,
          fecha_inicio: true, expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } } },
          orderBy: [{ fecha_inicio: 'asc' }, { id: 'asc' }], skip: options.offset, take: options.pageSize }),
      ]);
      return { count, items: rows.map((row) => ({ id: row.id, folio: row.expediente?.numero_pravia ?? 'Agenda',
        nombre: row.titulo, estado: row.tipo, contexto: row.expediente?.cliente_alias ?? null,
        fecha: row.fecha_inicio.toISOString(), href: `/agenda#evento=${encodeURIComponent(row.id)}` })) };
    }
    if (key === 'UPCOMING_SIGNINGS') {
      const window = typeof parameters.window === 'number' && [3, 7, 15].includes(parameters.window) ? parameters.window : 7;
      const to = resolveAssistantUpcomingDayWindow(window as 3 | 7 | 15, options.timezone, options.now).to;
      const where: Prisma.ExpedienteWhereInput = { ...dashboard.caseWhere,
        fecha_estimada_firma: { gte: today.from, lt: to }, fecha_real_firma: null };
      const [count, rows] = await Promise.all([
        this.db.expediente.count({ where }),
        this.db.expediente.findMany({ where, select: { id: true, numero_pravia: true, cliente_alias: true,
          estatus: true, fecha_estimada_firma: true }, orderBy: [{ fecha_estimada_firma: 'asc' }, { id: 'asc' }],
          skip: options.offset, take: options.pageSize }),
      ]);
      return { count, items: rows.map((row) => ({ id: row.id, folio: row.numero_pravia,
        nombre: row.cliente_alias || 'Cliente pendiente', estado: row.estatus,
        fecha: row.fecha_estimada_firma?.toISOString() ?? null, href: `/expedientes/${row.id}#seguimiento` })) };
    }
    if (key === 'RECEIVABLE') {
      const result = await this.receivables.receivables({ organization_id: actor.organizationId,
        fecha_hasta: new Date(today.to.getTime() - 1), page: options.page, pageSize: options.pageSize,
        ...(scope === 'OWN' || actor.scope !== 'GLOBAL' ? { responsable_id: actor.id }
          : dashboard.selectedUserId ? { responsable_id: dashboard.selectedUserId } : {}) });
      return { count: result.meta.total, amount: result.meta.totals.pending.toFixed(2),
        items: result.items.map((row) => ({ id: row.id,
          folio: row.expediente?.numero_pravia ?? row.cotizacion?.numero_cotizacion ?? 'Sin folio',
          nombre: row.cliente, estado: row.bucket ?? 'POR_COBRAR', amount: row.pending.toFixed(2),
          fecha: row.fecha_reconocimiento.toISOString(),
          href: row.expediente?.id ? `/expedientes/${row.expediente.id}#finanzas` : `/cotizaciones/${row.cotizacion.id}` })) };
    }
    if (key === 'FOLLOWUP_REMINDERS') return this.readFollowups(actor, scope, options);
    throw new MiDiaCardDetailError(404, 'MIDIA_DETAIL_NOT_AVAILABLE', 'La tarjeta no tiene un detalle paginado disponible.');
  }

  private async readFollowups(actor: Actor, scope: MiDiaScope, options: {
    pageSize: number; offset: number; requestedUserId?: unknown; now: Date;
  }): Promise<ReaderResult> {
    const { quoteWhere, selectedUserId } = miDiaDashboardScope(actor, options.requestedUserId, scope);
    const effectiveUser = scope === 'OWN' || actor.scope !== 'GLOBAL' ? actor.id : selectedUserId;
    const nextWeek = new Date(options.now); nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
    const [quotes, prospects] = await Promise.all([
      actor.permissions.includes('cotizaciones.read') ? this.db.cotizacion.findMany({ where: quoteWhere,
        select: { id: true, numero_cotizacion: true, numero_solicitud: true,
          prospecto: { select: { nombre: true } }, seguimientos: { orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: 1,
            select: { fecha_proximo_seguimiento: true } } } }) : Promise.resolve([]),
      actor.permissions.includes('prospectos.read') ? this.db.prospecto.findMany({ where: {
        archived_at: null, ...prospectoObjectWhere(actor), etapa_contractual: { in: ['NUEVO', 'EN_INTEGRACION', 'LISTO_PARA_COTIZAR'] },
        ...(effectiveUser ? { user_id: effectiveUser } : {}) }, select: { id: true, nombre: true,
          seguimientos: { orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: 1,
            select: { fecha_proximo_seguimiento: true } } } }) : Promise.resolve([]),
    ]);
    const items = [
      ...quotes.map((row) => ({ id: row.id, folio: row.numero_cotizacion || row.numero_solicitud || 'Cotización sin folio',
        nombre: row.prospecto?.nombre || 'Prospecto sin nombre', estado: 'COTIZACION',
        fecha: row.seguimientos[0]?.fecha_proximo_seguimiento ?? null, href: `/cotizaciones/${row.id}` })),
      ...prospects.map((row) => ({ id: row.id, folio: row.nombre, nombre: row.nombre, estado: 'PROSPECTO',
        fecha: row.seguimientos[0]?.fecha_proximo_seguimiento ?? null, href: `/prospectos/${row.id}` })),
    ].filter((row) => row.fecha && row.fecha <= nextWeek)
      .sort((left, right) => left.fecha!.getTime() - right.fecha!.getTime() || left.id.localeCompare(right.id));
    return { count: items.length, items: items.slice(options.offset, options.offset + options.pageSize)
      .map((row) => ({ ...row, fecha: row.fecha!.toISOString() })) };
  }
}
