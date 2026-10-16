import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { MidBaseSourceError, MidBaseSourceService } from '../services/midBaseSource.service';
import { intelligentNotificationService } from '../services/intelligentNotification.service';
import { miDiaDashboardScope } from '../services/miDiaDashboardScope';
import { resolveAssistantTimeRange, resolveAssistantUpcomingDayWindow } from '../services/assistantTime';
import { FinanceAnalyticsService } from '../services/financeAnalytics.service';
import { prospectoObjectWhere } from '../services/objectAccess.service';
import { MiDiaConfigurationService } from '../services/miDiaConfiguration.service';
import { MiDiaProcessCardsService, type ProcessCardKey } from '../services/miDiaProcessCards.service';
import { MiDiaCaseCardsService, type CaseCardKey } from '../services/miDiaCaseCards.service';
import { MiDiaSignatureCardsService, type SignatureCardKey, type SignaturePeriod } from '../services/miDiaSignatureCards.service';
import { MiDiaCommercialCardsService, type CommercialCardKey } from '../services/miDiaCommercialCards.service';
import { MiDiaFinanceCardsService, type FinanceCardKey } from '../services/miDiaFinanceCards.service';
import { MiDiaDocumentCardsService, type DocumentCardKey } from '../services/miDiaDocumentCards.service';
import { MiDiaComplianceCardsService, type ComplianceCardKey } from '../services/miDiaComplianceCards.service';
import { ArchivoService } from '../services/archivo.service';
import { MiDiaArchiveCardsService, type ArchiveCardKey } from '../services/miDiaArchiveCards.service';
import { MiDiaUserLoadService } from '../services/miDiaUserLoad.service';
import { MiDiaProcessAverageService } from '../services/miDiaProcessAverage.service';
import { MiDiaSigningAverageService } from '../services/miDiaSigningAverage.service';
import { settleMiDiaSource } from '../services/miDiaSourceSettlement';
import { MiDiaCardDetailError, MiDiaCardDetailService } from '../services/miDiaCardDetail.service';
import type { MiDiaScope } from '../domain/miDiaCardCatalog';
import { AGENDA_TIME_ZONE } from '../domain/agenda';

const midBaseSourceService = new MidBaseSourceService(prisma);
const financeAnalyticsService = new FinanceAnalyticsService(prisma);
const miDiaConfigurationService = new MiDiaConfigurationService(prisma);
const miDiaProcessCardsService = new MiDiaProcessCardsService(prisma);
const processCardKeys: ProcessCardKey[] = ['MY_PENDING', 'OVERDUE_PROCESSES', 'DUE_TODAY', 'UPCOMING_DUE',
  'CATASTRO_PENDING', 'RPP_PENDING', 'TESTIMONIES_PENDING', 'CAN_ADVANCE_TODAY'];
const miDiaCaseCardsService = new MiDiaCaseCardsService(prisma);
const caseCardKeys: CaseCardKey[] = ['CASES_INACTIVE', 'CASES_DELAYED', 'CASES_BLOCKED', 'POSTSIGN_PENDING', 'DELIVERIES_PENDING', 'MY_ACTIVE_CASES'];
const miDiaSignatureCardsService = new MiDiaSignatureCardsService(prisma);
const signatureCardKeys: SignatureCardKey[] = ['READY_TO_SIGN', 'NOT_READY_TO_SIGN', 'SIGNED_TODAY', 'SIGNED_PERIOD', 'SIGNED_CASES'];
const miDiaCommercialCardsService = new MiDiaCommercialCardsService(prisma);
const commercialCardKeys: CommercialCardKey[] = ['PROSPECTS_ACTIVE', 'PROSPECTS_NEW', 'PROSPECTS_STALE', 'PROSPECTS_READY',
  'QUOTES_ACTIVE', 'QUOTES_TO_SEND', 'QUOTES_NO_RESPONSE', 'QUOTES_FOLLOWUP', 'QUOTES_ACCEPTED',
  'QUOTES_CONVERSION', 'CASES_CONVERSION', 'QUOTES_ACTIVE_VALUE', 'QUOTES_ACCEPTED_VALUE'];
const miDiaFinanceCardsService = new MiDiaFinanceCardsService(prisma);
const financeCardKeys: FinanceCardKey[] = ['INCOME_COLLECTED', 'COLLECTED_TODAY', 'COLLECTION_SCHEDULED', 'FEES_SCHEDULED_SIGN', 'FEES_SIGNED',
  'ADVANCES_PENDING', 'PRODUCTION_VALUE', 'PAYMENTS_DUE', 'PAYMENTS_UNPROVEN', 'CLIENT_RESOURCES', 'REP_PENDING', 'INVOICES_PENDING', 'CFDI_TO_STAMP'];
const miDiaDocumentCardsService = new MiDiaDocumentCardsService(prisma);
const documentCardKeys: DocumentCardKey[] = ['MISSING_DOCUMENTS', 'DOCUMENTS_TO_REVIEW', 'EXPIRED_DOCUMENTS', 'FORMATS_TO_GENERATE', 'FORMATS_TO_SIGN', 'DOCUMENT_INCONSISTENCIES'];
const miDiaComplianceCardsService = new MiDiaComplianceCardsService(prisma);
const complianceCardKeys: ComplianceCardKey[] = ['PLD_INCOMPLETE', 'NOTICES_PENDING', 'NOTICES_UPCOMING', 'NOTICES_OVERDUE', 'CRITICAL_ALERTS'];
const miDiaArchiveCardsService = new MiDiaArchiveCardsService(new ArchivoService(prisma));
const archiveCardKeys: ArchiveCardKey[] = ['NEXT_DEED', 'NEXT_FOLIO', 'DEEDS_TODAY', 'CURRENT_BOOK', 'FOLIOS_LEFT', 'APPENDIX_PENDING'];
const miDiaUserLoadService = new MiDiaUserLoadService(prisma);
const miDiaProcessAverageService = new MiDiaProcessAverageService(prisma);
const miDiaSigningAverageService = new MiDiaSigningAverageService(prisma);
const settled = settleMiDiaSource;
const miDiaCardDetailService = new MiDiaCardDetailService(prisma);


export class MiDiaController {
  static async cardDetail(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      const data = await miDiaCardDetailService.read(req.user, req.params.key, {
        page: req.query.page,
        pageSize: req.query.page_size,
        requestedUserId: req.query.user_id,
      });
      return res.json({ success: true, data });
    } catch (error) {
      if (error instanceof MiDiaCardDetailError) {
        return res.status(error.status).json({ code: error.code, error: error.message });
      }
      console.error('Mi Día paginated detail read error', error);
      return res.status(500).json({ code: 'MIDIA_DETAIL_INTERNAL_ERROR', error: 'No fue posible consultar el detalle de la tarjeta.' });
    }
  }

  static async sources(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 250)) {
        return res.status(400).json({ code: 'MID_BASE_LIMIT_INVALID', error: 'El límite debe ser un entero entre 1 y 250.' });
      }
      return res.json({ success: true, data: await midBaseSourceService.read(req.user, { limit }) });
    } catch (error) {
      if (error instanceof MidBaseSourceError) return res.status(error.status).json({ code: error.code, error: error.message });
      console.error('MID-BASE source read error', error);
      return res.status(500).json({ code: 'MID_BASE_INTERNAL_ERROR', error: 'No fue posible consultar las fuentes de Mi Día.' });
    }
  }

  static async dashboard(req: Request, res: Response) {
    try {
      const now = new Date();
      if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      if (!req.user.permissions.includes('mi_dia.read')) return res.status(403).json({ code: 'MIDIA_READ_DENIED', error: 'No tienes permiso para consultar Mi Día.' });
      const configuration = await miDiaConfigurationService.get(req.user);
      const preference = await prisma.userPreference.findUnique({ where: { user_id: req.user.id }, select: { timezone: true } });
      const dashboardTimezone = preference?.timezone || AGENDA_TIME_ZONE;
      const agendaToday = resolveAssistantTimeRange('TODAY', dashboardTimezone, now);
      const agendaWeek = resolveAssistantTimeRange('NEXT_7_DAYS', dashboardTimezone, now);
      const todayStart = agendaToday.from;
      const todayEnd = new Date(agendaToday.to.getTime() - 1);
      const nextWeek = new Date(resolveAssistantUpcomingDayWindow(7, dashboardTimezone, now).to.getTime() - 1);
      const cardFor = (key: string) => configuration.layout.find((item) => item.key === key);
      const scopeFor = (key: string): MiDiaScope => cardFor(key)?.scope ?? 'OWN';
      const limitFor = (key: string, fallback: number) => {
        const value = cardFor(key)?.parameters.limit;
        return typeof value === 'number' && [5, 10, 15].includes(value) ? value : fallback;
      };
      const signatureWindow = cardFor('UPCOMING_SIGNINGS')?.parameters.window;
      const signatureEnd = resolveAssistantUpcomingDayWindow(
        (typeof signatureWindow === 'number' && [3, 7, 15].includes(signatureWindow) ? signatureWindow : 7) as 3 | 7 | 15,
        dashboardTimezone, now).to;
      const appointmentWindow = cardFor('UPCOMING_APPOINTMENTS')?.parameters.window;
      const appointmentEnd = resolveAssistantUpcomingDayWindow(
        (typeof appointmentWindow === 'number' && [3, 7, 15].includes(appointmentWindow) ? appointmentWindow : 7) as 3 | 7 | 15,
        dashboardTimezone, now).to;
      const { caseWhere } = miDiaDashboardScope(req.user, req.query.user_id, scopeFor('CASES'));
      const { taskWhere } = miDiaDashboardScope(req.user, req.query.user_id, scopeFor('URGENT_TASKS'));
      const { eventWhere } = miDiaDashboardScope(req.user, req.query.user_id, scopeFor('TODAY_AGENDA'));
      const { eventWhere: todaySigningWhere } = miDiaDashboardScope(req.user, req.query.user_id, scopeFor('TODAY_SIGNINGS'));
      const { eventWhere: appointmentWhere } = miDiaDashboardScope(req.user, req.query.user_id, scopeFor('UPCOMING_APPOINTMENTS'));
      const { caseWhere: signatureWhere } = miDiaDashboardScope(req.user, req.query.user_id, scopeFor('UPCOMING_SIGNINGS'));
      const { financialCaseWhere, selectedUserId: financeSelectedUserId } = miDiaDashboardScope(req.user, req.query.user_id, scopeFor('RECEIVABLE'));
      const { quoteWhere, selectedUserId: reminderSelectedUserId } = miDiaDashboardScope(req.user, req.query.user_id, scopeFor('FOLLOWUP_REMINDERS'));
      const canReadCases = req.user.permissions.includes('expedientes.read');
      const canReadAgenda = req.user.permissions.includes('agenda.read');
      const canReadQuotes = req.user.permissions.includes('cotizaciones.read');
      const canReadDocuments = req.user.permissions.includes('documentos.read');
      const canReadFinance = req.user.permissions.includes('finanzas.read');
      const processCards = await Promise.all(processCardKeys.map(async (key) => ({ key, result: await settled(
        canReadCases && cardFor(key) ? miDiaProcessCardsService.read(req.user!, key, {
          scope: scopeFor(key), requestedUserId: req.query.user_id,
          limit: limitFor(key, key === 'MY_PENDING' ? 10 : 5),
          window: typeof cardFor(key)?.parameters.window === 'number' ? Number(cardFor(key)?.parameters.window) : 7,
          now,
        }) : Promise.resolve(null),
      ) })));
      const caseCards = await Promise.all(caseCardKeys.map(async (key) => ({ key, result: await settled(
        canReadCases && cardFor(key) ? miDiaCaseCardsService.read(req.user!, key, {
          scope: scopeFor(key), requestedUserId: req.query.user_id,
          limit: limitFor(key, 5),
          window: typeof cardFor(key)?.parameters.window === 'number' ? Number(cardFor(key)?.parameters.window) : 7,
          now,
        }) : Promise.resolve(null),
      ) })));
      const signatureCards = await Promise.all(signatureCardKeys.map(async (key) => ({ key, result: await settled(
        canReadCases && cardFor(key) ? miDiaSignatureCardsService.read(req.user!, key, {
          scope: scopeFor(key), requestedUserId: req.query.user_id,
          limit: limitFor(key, 5),
          window: typeof cardFor(key)?.parameters.window === 'number' ? Number(cardFor(key)?.parameters.window) : 7,
          period: cardFor(key)?.parameters.period as SignaturePeriod | undefined,
          timezone: dashboardTimezone,
          now,
        }) : Promise.resolve(null),
      ) })));
      const commercialCards = await Promise.all(commercialCardKeys.map(async (key) => ({ key, result: await settled(
        cardFor(key) ? miDiaCommercialCardsService.read(req.user!, key, {
          scope: scopeFor(key), requestedUserId: req.query.user_id,
          limit: limitFor(key, 5),
          window: typeof cardFor(key)?.parameters.window === 'number' ? Number(cardFor(key)?.parameters.window) : 7,
          period: cardFor(key)?.parameters.period as SignaturePeriod | undefined,
          timezone: dashboardTimezone, now,
        }) : Promise.resolve(null),
      ) })));
      const financeCards = await Promise.all(financeCardKeys.map(async (key) => ({ key, result: await settled(
        canReadFinance && cardFor(key) ? miDiaFinanceCardsService.read(req.user!, key, {
          scope: scopeFor(key), requestedUserId: req.query.user_id, limit: limitFor(key, 5),
          period: cardFor(key)?.parameters.period as SignaturePeriod | undefined,
          timezone: dashboardTimezone, now,
        }) : Promise.resolve(null),
      ) })));
      const documentCards = await Promise.all(documentCardKeys.map(async (key) => ({ key, result: await settled(
        cardFor(key) ? miDiaDocumentCardsService.read(req.user!, key, {
          scope: scopeFor(key), requestedUserId: req.query.user_id, limit: limitFor(key, 5), now,
        }) : Promise.resolve(null),
      ) })));
      const complianceCards = await Promise.all(complianceCardKeys.map(async (key) => ({ key, result: await settled(
        cardFor(key) ? miDiaComplianceCardsService.read(req.user!, key, {
          scope: scopeFor(key), requestedUserId: req.query.user_id, limit: limitFor(key, 5),
          window: typeof cardFor(key)?.parameters.window === 'number' ? Number(cardFor(key)?.parameters.window) : 7,
          timezone: dashboardTimezone, now,
        }) : Promise.resolve(null),
      ) })));
      const visibleArchiveKeys = archiveCardKeys.filter((key) => Boolean(cardFor(key)));
      const archiveCards = await settled(miDiaArchiveCardsService.readVisible(req.user, visibleArchiveKeys, {
        timezone: dashboardTimezone, now, limit: limitFor('DEEDS_TODAY', 5),
      }));
      const userLoad = await settled(cardFor('USER_LOAD')
        ? miDiaUserLoadService.read(req.user, { limit: limitFor('USER_LOAD', 10), requestedUserId: req.query.user_id })
        : Promise.resolve(null));
      const processAverage = await settled(cardFor('AVERAGE_PROCESS')
        ? miDiaProcessAverageService.read(req.user, {
          scope: scopeFor('AVERAGE_PROCESS'), requestedUserId: req.query.user_id,
          period: cardFor('AVERAGE_PROCESS')?.parameters.period as SignaturePeriod | undefined,
          timezone: dashboardTimezone, now, limit: limitFor('AVERAGE_PROCESS', 10),
        }) : Promise.resolve(null));
      const signingAverage = await settled(cardFor('AVERAGE_TO_SIGN')
        ? miDiaSigningAverageService.read(req.user, {
          scope: scopeFor('AVERAGE_TO_SIGN'), requestedUserId: req.query.user_id,
          period: cardFor('AVERAGE_TO_SIGN')?.parameters.period as SignaturePeriod | undefined,
          timezone: dashboardTimezone, now, limit: limitFor('AVERAGE_TO_SIGN', 5),
        }) : Promise.resolve(null));

      // List payloads are deliberately bounded; never derive tenant-wide KPIs
      // from those slices. Count against the same canonical object boundary.
      const [caseCount, todayTaskCount, overdueTaskCount, todayEventCount, todaySigningCount, upcomingAppointmentCount, upcomingDeadlineCount,
        upcomingSignatureCount, blockedCaseCount, pendingClientCount, pendingNotaryCount,
        missingDocumentCount, pendingIncomeCount, pendingRequestCount] = await Promise.all([
        settled(canReadCases ? prisma.expediente.count({ where: caseWhere }) : Promise.resolve(null)),
        settled(canReadCases ? prisma.tarea.count({ where: { ...taskWhere,
          estatus: { in: ['PENDIENTE', 'EN_PROCESO'] }, fecha_limite: { gte: todayStart, lte: todayEnd },
        } }) : Promise.resolve(null)),
        settled(canReadCases ? prisma.tarea.count({ where: { ...taskWhere,
          estatus: { in: ['PENDIENTE', 'EN_PROCESO'] }, fecha_limite: { lt: todayStart },
        } }) : Promise.resolve(null)),
        settled(canReadAgenda ? prisma.eventoAgenda.count({ where: { ...eventWhere,
          estatus: 'ACTIVO', fecha_inicio: { gte: agendaToday.from, lt: agendaToday.to },
        } }) : Promise.resolve(null)),
        settled(canReadAgenda ? prisma.eventoAgenda.count({ where: { ...todaySigningWhere,
          estatus: 'ACTIVO', tipo: 'FIRMA', fecha_inicio: { gte: agendaToday.from, lt: agendaToday.to },
        } }) : Promise.resolve(null)),
        settled(canReadAgenda ? prisma.eventoAgenda.count({ where: { ...appointmentWhere,
          estatus: 'ACTIVO', tipo: 'CITA', fecha_inicio: { gte: now, lt: appointmentEnd },
        } }) : Promise.resolve(null)),
        settled(canReadAgenda ? prisma.eventoAgenda.count({ where: { ...eventWhere,
          estatus: 'ACTIVO', tipo: 'VENCIMIENTO', fecha_inicio: { gte: agendaToday.from, lt: agendaWeek.to },
        } }) : Promise.resolve(null)),
        settled(canReadCases ? prisma.expediente.count({ where: { ...signatureWhere,
          fecha_estimada_firma: { gte: agendaToday.from, lt: signatureEnd }, fecha_real_firma: null,
        } }) : Promise.resolve(null)),
        settled(canReadCases ? prisma.expediente.count({ where: { AND: [caseWhere, {
          OR: [{ estatus: 'SUSPENDIDO' }, { tareas_externas: { some: { estatus: 'BLOQUEADA' } } }],
        }] } }) : Promise.resolve(null)),
        settled(canReadCases ? prisma.expediente.count({ where: { ...caseWhere,
          estatus: 'PENDIENTE_CLIENTE',
        } }) : Promise.resolve(null)),
        settled(canReadCases ? prisma.expediente.count({ where: { ...caseWhere,
          estatus: 'PENDIENTE_NOTARIA',
        } }) : Promise.resolve(null)),
        settled(canReadCases && canReadDocuments ? prisma.expedienteRequisitoDoc.count({ where: {
          organization_id: req.user.organizationId, expediente: { is: caseWhere }, obligatorio: true,
          estatus: { in: ['PENDIENTE', 'RECHAZADO', 'VENCIDO'] },
        } }) : Promise.resolve(null)),
        settled(canReadFinance ? prisma.expedienteIngresoReportado.count({ where: {
          organization_id: req.user.organizationId, estado: 'PENDIENTE_APLICACION', expediente: financialCaseWhere,
        } }) : Promise.resolve(null)),
        settled(canReadFinance ? prisma.expedienteSolicitudPago.count({ where: {
          organization_id: req.user.organizationId, estado: 'PENDIENTE', expediente: financialCaseWhere,
        } }) : Promise.resolve(null)),
      ]);

      const [tasksResult, eventsResult, todaySigningsResult, appointmentsResult, casesResult, signaturesResult, receivablesResult, quotesResult, prospectsResult, incomeResult, requestsResult] = await Promise.all([
        settled(canReadCases ? prisma.tarea.findMany({
          where: { ...taskWhere, estatus: { in: ['PENDIENTE', 'EN_PROCESO'] } },
          include: { expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } } },
          orderBy: [{ fecha_limite: 'asc' }, { prioridad: 'desc' }, { created_at: 'asc' }],
          take: 100,
        }) : Promise.resolve([])),
        settled(canReadAgenda ? prisma.eventoAgenda.findMany({
          where: { ...eventWhere, estatus: 'ACTIVO', fecha_inicio: { gte: agendaToday.from, lt: agendaWeek.to } },
          include: { expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } } },
          orderBy: { fecha_inicio: 'asc' },
          take: 100,
        }) : Promise.resolve([])),
        settled(canReadAgenda ? prisma.eventoAgenda.findMany({
          where: { ...todaySigningWhere, estatus: 'ACTIVO', tipo: 'FIRMA', fecha_inicio: { gte: agendaToday.from, lt: agendaToday.to } },
          include: { expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } } },
          orderBy: { fecha_inicio: 'asc' }, take: 10,
        }) : Promise.resolve([])),
        settled(canReadAgenda ? prisma.eventoAgenda.findMany({
          where: { ...appointmentWhere, estatus: 'ACTIVO', tipo: 'CITA', fecha_inicio: { gte: now, lt: appointmentEnd } },
          include: { expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } } },
          orderBy: { fecha_inicio: 'asc' }, take: 15,
        }) : Promise.resolve([])),
        settled(canReadCases ? prisma.expediente.findMany({
          where: caseWhere,
          select: {
            id: true, numero_pravia: true, cliente_alias: true, estatus: true, updated_at: true,
            tipo_acto: { select: { nombre: true } },
            tareas_externas: { where: { estatus: 'BLOQUEADA' }, select: { id: true, descripcion: true, institucion: true } },
          },
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
          take: 300,
        }) : Promise.resolve([])),
        settled(canReadCases ? prisma.expediente.findMany({
          where: { ...signatureWhere, fecha_estimada_firma: { gte: agendaToday.from, lt: signatureEnd }, fecha_real_firma: null },
          select: { id: true, numero_pravia: true, cliente_alias: true, fecha_estimada_firma: true,
            tipo_acto: { select: { nombre: true } }, notaria: { select: { nombre: true } } },
          orderBy: { fecha_estimada_firma: 'asc' }, take: 100,
        }) : Promise.resolve([])),
        settled(canReadFinance ? financeAnalyticsService.receivables({
          organization_id: req.user.organizationId,
          fecha_hasta: todayEnd,
          ...(scopeFor('RECEIVABLE') === 'OWN' || req.user.scope !== 'GLOBAL'
            ? { responsable_id: req.user.id } : financeSelectedUserId ? { responsable_id: financeSelectedUserId } : {}),
          pageSize: 100,
        }) : Promise.resolve(null)),
        settled(canReadQuotes ? prisma.cotizacion.findMany({
          where: quoteWhere,
          select: { id: true, numero_cotizacion: true, numero_solicitud: true,
            prospecto: { select: { nombre: true } },
            seguimientos: { orderBy: { created_at: 'desc' }, take: 1,
              select: { id: true, fecha_proximo_seguimiento: true } },
          },
          orderBy: { updated_at: 'asc' },
        }) : Promise.resolve([])),
        settled(req.user.permissions.includes('prospectos.read') ? prisma.prospecto.findMany({
          where: { archived_at: null, ...prospectoObjectWhere(req.user),
            etapa_contractual: { in: ['NUEVO', 'EN_INTEGRACION', 'LISTO_PARA_COTIZAR'] },
            ...(scopeFor('FOLLOWUP_REMINDERS') === 'OWN' || req.user.scope !== 'GLOBAL'
              ? { user_id: req.user.id } : reminderSelectedUserId ? { user_id: reminderSelectedUserId } : {}),
          },
          select: { id: true, nombre: true,
            seguimientos: { orderBy: { created_at: 'desc' }, take: 1,
              select: { id: true, fecha_proximo_seguimiento: true } },
          },
          orderBy: { updated_at: 'asc' },
        }) : Promise.resolve([])),
        settled(canReadFinance ? prisma.expedienteIngresoReportado.findMany({
          where: { organization_id: req.user.organizationId, estado: 'PENDIENTE_APLICACION', expediente: financialCaseWhere },
          select: { id: true, created_at: true, expediente: { select: { id: true, numero_pravia: true } } }, orderBy: { created_at: 'asc' }, take: 50,
        }) : Promise.resolve([])),
        settled(canReadFinance ? prisma.expedienteSolicitudPago.findMany({
          where: { organization_id: req.user.organizationId, estado: 'PENDIENTE', expediente: financialCaseWhere },
          select: { id: true, created_at: true, fecha_limite: true, expediente: { select: { id: true, numero_pravia: true } } }, orderBy: { created_at: 'asc' }, take: 50,
        }) : Promise.resolve([])),
      ]);
      const tasks = tasksResult.ok ? tasksResult.value : [];
      const events = eventsResult.ok ? eventsResult.value : [];
      const todaySignings = todaySigningsResult.ok ? todaySigningsResult.value : [];
      const upcomingAppointments = appointmentsResult.ok ? appointmentsResult.value : [];
      const expedientes = casesResult.ok ? casesResult.value : [];
      const upcomingSignatures = signaturesResult.ok ? signaturesResult.value : [];
      const receivables = receivablesResult.ok ? receivablesResult.value : null;
      const quotes = quotesResult.ok ? quotesResult.value : [];
      const prospects = prospectsResult.ok ? prospectsResult.value : [];
      const pendingExp008Income = incomeResult.ok ? incomeResult.value : [];
      const pendingExp008Requests = requestsResult.ok ? requestsResult.value : [];
      const errors: Record<string, string> = {};
      for (const { key, result } of processCards) {
        if (!result.ok) errors[key] = 'No fue posible consultar los procesos de Seguimiento.';
      }
      for (const { key, result } of caseCards) {
        if (!result.ok) errors[key] = 'No fue posible consultar los expedientes.';
      }
      for (const { key, result } of signatureCards) {
        if (!result.ok) errors[key] = 'No fue posible consultar la preparación de firma.';
      }
      for (const { key, result } of commercialCards) {
        if (!result.ok) errors[key] = 'No fue posible consultar el flujo comercial.';
      }
      for (const { key, result } of financeCards) {
        if (!result.ok) errors[key] = 'No fue posible consultar los movimientos de Finanzas.';
      }
      for (const { key, result } of documentCards) {
        if (!result.ok) errors[key] = 'No fue posible consultar los documentos.';
      }
      for (const { key, result } of complianceCards) {
        if (!result.ok) errors[key] = 'No fue posible consultar Cumplimiento.';
      }
      if (!archiveCards.ok) for (const key of visibleArchiveKeys) errors[key] = 'No fue posible consultar Archivo.';
      if (!userLoad.ok) errors.USER_LOAD = 'No fue posible consultar la carga por usuario.';
      if (!processAverage.ok) errors.AVERAGE_PROCESS = 'No fue posible consultar los tiempos de procesos.';
      if (!signingAverage.ok) errors.AVERAGE_TO_SIGN = 'No fue posible consultar el tiempo a firma.';
      if (!tasksResult.ok) errors.tasks = 'No fue posible consultar las tareas.';
      if (!eventsResult.ok || !todayEventCount.ok) errors.agenda = 'No fue posible consultar la Agenda.';
      if (!todaySigningsResult.ok || !todaySigningCount.ok) errors.todaySignings = 'No fue posible consultar las firmas de hoy.';
      if (!appointmentsResult.ok || !upcomingAppointmentCount.ok) errors.upcomingAppointments = 'No fue posible consultar las citas próximas.';
      if (!casesResult.ok) errors.recentFiles = 'No fue posible consultar los expedientes.';
      if (!signaturesResult.ok) errors.signatures = 'No fue posible consultar las firmas.';
      if (!quotesResult.ok || !prospectsResult.ok) errors.reminders = 'No fue posible consultar los seguimientos.';
      if (!receivablesResult.ok) errors.finance = 'No fue posible consultar el saldo por cobrar.';
      if (!incomeResult.ok || !requestsResult.ok) errors.kpis = 'No fue posible consultar los pendientes financieros.';
      if (!todayTaskCount.ok || !overdueTaskCount.ok) errors.kpis = 'No fue posible contar las tareas.';
      if (!caseCount.ok) errors.kpis = 'No fue posible contar los expedientes.';
      if (!todayEventCount.ok || !upcomingDeadlineCount.ok) errors.kpis = 'No fue posible contar los eventos.';
      if (!upcomingSignatureCount.ok) errors.kpis = 'No fue posible contar las firmas.';
      if (!blockedCaseCount.ok) errors.kpis = 'No fue posible contar los expedientes bloqueados.';
      if (!pendingClientCount.ok || !pendingNotaryCount.ok) errors.kpis = 'No fue posible contar los expedientes pendientes.';
      if (!missingDocumentCount.ok) errors.kpis = 'No fue posible contar los documentos pendientes.';
      if (!pendingIncomeCount.ok || !pendingRequestCount.ok) errors.kpis = 'No fue posible contar los pendientes financieros.';

      const todayTasks = tasks.filter((task) => task.fecha_limite && task.fecha_limite >= todayStart && task.fecha_limite <= todayEnd);
      const overdueTasks = tasks.filter((task) => task.fecha_limite && task.fecha_limite < todayStart);
      const urgentLimit = limitFor('URGENT_TASKS', 10);
      const todayEvents = events.filter((event) => event.fecha_inicio < agendaToday.to);
      const blocked = expedientes.filter((exp) => exp.estatus === 'SUSPENDIDO' || exp.tareas_externas.length > 0);
      const pendingClient = expedientes.filter((exp) => exp.estatus === 'PENDIENTE_CLIENTE');
      const pendingNotary = expedientes.filter((exp) => exp.estatus === 'PENDIENTE_NOTARIA');
      const collection = receivables?.items.map((item) => ({
        expediente_id: item.expediente?.id ?? null,
        cotizacion_id: item.cotizacion?.id ?? null,
        folio: item.expediente?.numero_pravia ?? item.cotizacion?.numero_cotizacion ?? 'Sin folio',
        cliente: item.cliente,
        saldo: item.pending,
      })) ?? [];

      const quoteFollowups = quotes.map((quote) => {
        const latest = quote.seguimientos[0];
        return {
          id: quote.id, tipo: 'COTIZACION' as const,
          numero: quote.numero_cotizacion || quote.numero_solicitud || 'Cotización sin folio',
          cliente: quote.prospecto?.nombre || 'Prospecto sin nombre',
          fecha_seguimiento: latest?.fecha_proximo_seguimiento ?? null,
        };
      }).filter((quote) => quote.fecha_seguimiento && quote.fecha_seguimiento <= nextWeek);
      const prospectFollowups = prospects.map((prospect) => ({
        id: prospect.id, tipo: 'PROSPECTO' as const,
        numero: prospect.nombre, cliente: prospect.nombre,
        fecha_seguimiento: prospect.seguimientos[0]?.fecha_proximo_seguimiento ?? null,
      })).filter((prospect) => prospect.fecha_seguimiento && prospect.fecha_seguimiento <= nextWeek);
      const followups = [...quoteFollowups, ...prospectFollowups].sort((a, b) =>
        (a.fecha_seguimiento?.getTime() ?? 0) - (b.fecha_seguimiento?.getTime() ?? 0));

      const notificationsResult = await settled(intelligentNotificationService.refreshAndList(req.user, { limit: 40 }));
      const notifications = notificationsResult.ok ? notificationsResult.value : [];
      if (!notificationsResult.ok) errors.recommendation = 'No fue posible consultar las alertas.';
      const alerts = notifications.map((item) => ({
        id: item.id,
        severidad: item.priority === 'URGENT' ? 'ALTA' : item.priority === 'IMPORTANT' ? 'MEDIA' : 'BAJA',
        tipo: item.type,
        titulo: item.title,
        detalle: item.body,
        fecha: item.last_reminder_at || item.created_at,
        ruta: item.href,
        prioridad: item.priority,
        entidad: item.entity_type,
        entidad_id: item.entity_id,
      }));

      return res.json({
        success: true,
        generado_en: now,
        usuario_id: req.user.id,
        permissions: { canViewCases: canReadCases, canViewFinance: canReadFinance },
        metricas: {
          expedientes_total: caseCount.ok ? caseCount.value : null,
          tareas_hoy: todayTaskCount.ok ? todayTaskCount.value : null,
          tareas_vencidas: overdueTaskCount.ok ? overdueTaskCount.value : null,
          citas_hoy: todayEventCount.ok ? todayEventCount.value : null,
          firmas_hoy_agenda: todaySigningCount.ok ? todaySigningCount.value : null,
          citas_proximas: upcomingAppointmentCount.ok ? upcomingAppointmentCount.value : null,
          vencimientos_proximos: upcomingDeadlineCount.ok ? upcomingDeadlineCount.value : null,
          firmas_proximas: upcomingSignatureCount.ok ? upcomingSignatureCount.value : null,
          expedientes_bloqueados: blockedCaseCount.ok ? blockedCaseCount.value : null,
          pendientes_cliente: pendingClientCount.ok ? pendingClientCount.value : null,
          pendientes_notaria: pendingNotaryCount.ok ? pendingNotaryCount.value : null,
          cotizaciones_seguimiento: quotesResult.ok ? quoteFollowups.length : null,
          documentos_faltantes: missingDocumentCount.ok ? missingDocumentCount.value : null,
          cobros_pendientes: receivablesResult.ok ? receivables?.meta.total ?? null : null,
          saldo_pendiente_total: receivablesResult.ok ? receivables?.meta.totals.pending ?? null : null,
          ingresos_pendientes_aplicacion: pendingIncomeCount.ok ? pendingIncomeCount.value : null,
          solicitudes_pago_pendientes: pendingRequestCount.ok ? pendingRequestCount.value : null,
        },
        tareas: { hoy: todayTasks.slice(0, Math.max(0, urgentLimit - overdueTasks.length)), vencidas: overdueTasks.slice(0, urgentLimit), siguientes: tasks.filter((task) => !todayTasks.includes(task) && !overdueTasks.includes(task)).slice(0, 20) },
        eventos: {
          hoy: todayEvents.slice(0, limitFor('TODAY_AGENDA', 10)),
          proximos: events.filter((event) => !todayEvents.includes(event)).slice(0, 30),
          firmas_hoy: todaySignings,
          citas_proximas: upcomingAppointments,
        },
        operacion: {
          procesos: Object.fromEntries(processCards.map(({ key, result }) => [key, result.ok ? result.value : null])),
          expediente_cards: Object.fromEntries(caseCards.map(({ key, result }) => [key, result.ok ? result.value : null])),
          firma_cards: Object.fromEntries(signatureCards.map(({ key, result }) => [key, result.ok ? result.value : null])),
          comercial_cards: Object.fromEntries(commercialCards.map(({ key, result }) => [key, result.ok ? result.value : null])),
          finanzas_cards: Object.fromEntries(financeCards.map(({ key, result }) => [key, result.ok ? result.value : null])),
          documento_cards: Object.fromEntries(documentCards.map(({ key, result }) => [key, result.ok ? result.value : null])),
          cumplimiento_cards: Object.fromEntries(complianceCards.map(({ key, result }) => [key, result.ok ? result.value : null])),
          archivo_cards: archiveCards.ok ? archiveCards.value : {},
          user_load: userLoad.ok ? userLoad.value : null,
          process_average: processAverage.ok ? processAverage.value : null,
          signing_average: signingAverage.ok ? signingAverage.value : null,
          firmas_proximas: upcomingSignatures,
          bloqueados: blocked,
          pendientes_cliente: pendingClient,
          pendientes_notaria: pendingNotary,
          documentos_faltantes: [],
          cotizaciones_seguimiento_count: followups.length,
          cotizaciones_seguimiento: followups.slice(0, limitFor('FOLLOWUP_REMINDERS', 10)),
          cobranza: collection,
          recientes: cardFor('CASES') ? expedientes.slice(0, limitFor('CASES', 8)) : [],
        },
        alertas: alerts,
        errors,
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'No fue posible preparar Mi Día.', detail: error.message });
    }
  }
}
