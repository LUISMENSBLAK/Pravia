import { apiRequest } from '../../services/api/client';
import { apiConfig } from '../../services/api/config';
import type { ArchiveCardData, ArchiveCardKey, CaseCardData, CaseCardKey, CommercialCardData, CommercialCardKey, ComplianceCardKey, DocumentCardData, DocumentCardKey, FinanceCardData, FinanceCardKey, MiDiaCardDetail, MyDayData, ProcessCardData, ProcessCardKey, WidgetSection } from './myDay.types';

const arrayOrEmpty = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' ? value as Record<string, any> : {};

const normalizeOperationalDashboard = (source: Record<string, any>): MyDayData | null => {
  if (!source.metricas || !source.operacion || !source.eventos || !source.tareas) return null;
  const metrics = record(source.metricas);
  const operation = record(source.operacion);
  const events = record(source.eventos);
  const tasks = record(source.tareas);
  const canViewCases = record(source.permissions).canViewCases === true;
  const canViewFinance = record(source.permissions).canViewFinance === true;
  const todayEvents = arrayOrEmpty<any>(events.hoy);
  const todaySignings = arrayOrEmpty<any>(events.firmas_hoy);
  const upcomingAppointments = arrayOrEmpty<any>(events.citas_proximas);
  const signatures = arrayOrEmpty<any>(operation.firmas_proximas);
  const recent = arrayOrEmpty<any>(operation.recientes);
  const alerts = arrayOrEmpty<any>(source.alertas);
  const followups = arrayOrEmpty<any>(operation.cotizaciones_seguimiento);
  const urgent = [...arrayOrEmpty<any>(tasks.vencidas), ...arrayOrEmpty<any>(tasks.hoy)];
  const primaryAlert = alerts[0];
  const errors = normalizeErrors(source.errors);
  const numericMetric = (key: string): number | undefined =>
    typeof metrics[key] === 'number' && Number.isFinite(metrics[key]) ? metrics[key] : undefined;
  const overdue = numericMetric('tareas_vencidas');
  const blocked = numericMetric('expedientes_bloqueados');
  const toAgendaItem = (item: any) => ({
    id: item.id,
    href: `/agenda#evento=${encodeURIComponent(item.id)}`,
    startsAt: item.fecha_inicio,
    title: item.titulo,
    type: item.tipo,
    fileNumber: item.expediente?.numero_pravia,
    context: item.descripcion || item.ubicacion,
    status: item.estatus,
    tone: item.tipo === 'VENCIMIENTO' ? 'green' as const : item.tipo === 'FIRMA' ? 'blue' as const : 'gold' as const,
  });

  return {
    date: typeof source.generado_en === 'string' ? source.generado_en : undefined,
    permissions: { canViewCases, canViewFinance },
    kpis: {
      ...(canViewCases && !errors.recentFiles && numericMetric('expedientes_total') !== undefined
        ? { activeFiles: { value: numericMetric('expedientes_total')!, label: 'Expedientes', context: 'Dentro de tu alcance' } } : {}),
      ...(numericMetric('firmas_proximas') !== undefined ? { signaturesToday: { value: numericMetric('firmas_proximas')!, label: 'Firmas próximas', context: 'Siguientes 7 días' } } : {}),
      ...(numericMetric('firmas_hoy_agenda') !== undefined ? { todaySignings: { value: numericMetric('firmas_hoy_agenda')!, label: 'Firmas de hoy' } } : {}),
      ...(numericMetric('citas_proximas') !== undefined ? { upcomingAppointments: { value: numericMetric('citas_proximas')!, label: 'Citas próximas' } } : {}),
      ...(overdue !== undefined && blocked !== undefined ? { urgentPending: { value: overdue + blocked, label: 'Pendientes urgentes', context: 'Vencidos o bloqueados' } } : {}),
      ...(canViewFinance
        ? numericMetric('saldo_pendiente_total') !== undefined ? { financial: { value: numericMetric('saldo_pendiente_total')!, label: 'Por cobrar (MXN)', context: 'Saldo de honorarios en Finanzas' } } : {}
        : numericMetric('documentos_faltantes') !== undefined ? { operationalFallback: { value: numericMetric('documentos_faltantes')!, label: 'Documentos pendientes', context: 'Requisitos obligatorios' } } : {}),
    },
    agenda: todayEvents.map(toAgendaItem),
    agendaCount: numericMetric('citas_hoy'),
    todaySignings: todaySignings.map(toAgendaItem),
    upcomingAppointments: upcomingAppointments.map(toAgendaItem),
    urgentSignatures: signatures.map((item) => ({
      id: item.id,
      fileNumber: item.numero_pravia,
      act: item.tipo_acto?.nombre,
      context: item.cliente_alias,
      signatureType: item.notaria?.nombre,
      dueAt: item.fecha_estimada_firma,
    })),
    recentFiles: recent.map((item) => ({
      id: item.id,
      fileNumber: item.numero_pravia,
      act: item.tipo_acto?.nombre,
      summary: item.cliente_alias,
      status: item.estatus,
      updatedAt: item.updated_at,
      href: `/expedientes/${item.id}`,
    })),
    recommendation: primaryAlert ? {
      title: primaryAlert.titulo,
      description: primaryAlert.detalle,
      href: primaryAlert.ruta,
    } : null,
    reminders: followups.map((item) => ({
      id: item.id,
      title: item.tipo === 'PROSPECTO' ? `Seguimiento a prospecto: ${item.numero}` : `Seguimiento a ${item.numero}`,
      context: item.cliente,
      dueAt: item.fecha_seguimiento,
      href: item.tipo === 'PROSPECTO' ? `/prospectos/${item.id}` : `/cotizaciones/${item.id}`,
      kind: 'call',
    })),
    reminderCount: typeof operation.cotizaciones_seguimiento_count === 'number'
      && Number.isFinite(operation.cotizaciones_seguimiento_count)
      ? operation.cotizaciones_seguimiento_count : followups.length,
    urgentTasks: urgent.map((item) => ({
      id: item.id,
      title: item.titulo,
      context: item.expediente?.cliente_alias,
      reference: item.expediente?.numero_pravia,
      priority: item.prioridad === 'URGENTE' || (item.fecha_limite && new Date(item.fecha_limite) < new Date()) ? 'urgent' : 'pending',
      href: item.expediente_id ? `/expedientes/${item.expediente_id}` : '/agenda',
    })),
    processCards: record(operation.procesos) as Partial<Record<ProcessCardKey, ProcessCardData | null>>,
    caseCards: { ...record(operation.expediente_cards), ...record(operation.firma_cards) } as Partial<Record<CaseCardKey, CaseCardData | null>>,
    commercialCards: record(operation.comercial_cards) as Partial<Record<CommercialCardKey, CommercialCardData | null>>,
    financeCards: record(operation.finanzas_cards) as Partial<Record<FinanceCardKey, FinanceCardData | null>>,
    documentCards: record(operation.documento_cards) as Partial<Record<DocumentCardKey, DocumentCardData | null>>,
    complianceCards: record(operation.cumplimiento_cards) as Partial<Record<ComplianceCardKey, DocumentCardData | null>>,
    archiveCards: record(operation.archivo_cards) as Partial<Record<ArchiveCardKey, ArchiveCardData | null>>,
    userLoad: operation.user_load && typeof operation.user_load === 'object' ? operation.user_load as MyDayData['userLoad'] : null,
    processAverage: operation.process_average && typeof operation.process_average === 'object'
      ? operation.process_average as MyDayData['processAverage'] : null,
    signingAverage: operation.signing_average && typeof operation.signing_average === 'object'
      ? operation.signing_average as MyDayData['signingAverage'] : null,
    finance: canViewFinance && numericMetric('saldo_pendiente_total') !== undefined ? {
      metrics: [{ key: 'receivable', label: 'Por cobrar (MXN)', value: numericMetric('saldo_pendiente_total')!, currency: 'MXN' }],
    } : null,
    errors,
  };
};

const normalizeErrors = (value: unknown): Partial<Record<WidgetSection, string>> => {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, message]) => typeof message === 'string'),
  ) as Partial<Record<WidgetSection, string>>;
};

export const normalizeMyDay = (payload: unknown): MyDayData => {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const source = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root;
  const operational = normalizeOperationalDashboard(source);
  if (operational) return operational;
  const permissions = source.permissions && typeof source.permissions === 'object'
    ? source.permissions as Record<string, unknown>
    : {};
  const kpis = source.kpis && typeof source.kpis === 'object' ? source.kpis as MyDayData['kpis'] : {};
  const finance = source.finance && typeof source.finance === 'object'
    ? source.finance as NonNullable<MyDayData['finance']>
    : null;

  return {
    date: typeof source.date === 'string' ? source.date : undefined,
    permissions: { canViewCases: permissions.canViewCases === true, canViewFinance: permissions.canViewFinance === true },
    kpis,
    agenda: arrayOrEmpty(source.agenda),
    todaySignings: arrayOrEmpty(source.todaySignings),
    upcomingAppointments: arrayOrEmpty(source.upcomingAppointments),
    urgentSignatures: arrayOrEmpty(source.urgentSignatures),
    recentFiles: arrayOrEmpty(source.recentFiles),
    recommendation: source.recommendation && typeof source.recommendation === 'object'
      ? source.recommendation as MyDayData['recommendation']
      : null,
    reminders: arrayOrEmpty(source.reminders),
    urgentTasks: arrayOrEmpty(source.urgentTasks),
    processCards: record(source.processCards) as Partial<Record<ProcessCardKey, ProcessCardData | null>>,
    caseCards: record(source.caseCards) as Partial<Record<CaseCardKey, CaseCardData | null>>,
    commercialCards: record(source.commercialCards) as Partial<Record<CommercialCardKey, CommercialCardData | null>>,
    financeCards: record(source.financeCards) as Partial<Record<FinanceCardKey, FinanceCardData | null>>,
    documentCards: record(source.documentCards) as Partial<Record<DocumentCardKey, DocumentCardData | null>>,
    complianceCards: record(source.complianceCards) as Partial<Record<ComplianceCardKey, DocumentCardData | null>>,
    archiveCards: record(source.archiveCards) as Partial<Record<ArchiveCardKey, ArchiveCardData | null>>,
    userLoad: source.userLoad && typeof source.userLoad === 'object' ? source.userLoad as MyDayData['userLoad'] : null,
    finance,
    errors: normalizeErrors(source.errors),
  };
};

export const myDayService = {
  async get(signal?: AbortSignal): Promise<MyDayData> {
    const payload = await apiRequest<unknown>(apiConfig.myDayPath, { signal });
    return normalizeMyDay(payload);
  },
  async detail(key: string, page = 1, pageSize = 20, signal?: AbortSignal): Promise<MiDiaCardDetail> {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    const payload = await apiRequest<{ success: true; data: MiDiaCardDetail }>(
      `${apiConfig.myDayPath}/cards/${encodeURIComponent(key)}/detail?${params.toString()}`,
      { signal },
    );
    return payload.data;
  },
};
