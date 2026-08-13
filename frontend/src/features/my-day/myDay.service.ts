import { apiRequest } from '../../services/api/client';
import { apiConfig } from '../../services/api/config';
import type { MyDayData, WidgetSection } from './myDay.types';

const arrayOrEmpty = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' ? value as Record<string, any> : {};

const normalizeOperationalDashboard = (source: Record<string, any>): MyDayData | null => {
  if (!source.metricas || !source.operacion || !source.eventos || !source.tareas) return null;
  const metrics = record(source.metricas);
  const operation = record(source.operacion);
  const events = record(source.eventos);
  const tasks = record(source.tareas);
  const canViewFinance = record(source.permissions).canViewFinance === true;
  const todayEvents = arrayOrEmpty<any>(events.hoy);
  const signatures = arrayOrEmpty<any>(operation.firmas_proximas);
  const recent = arrayOrEmpty<any>(operation.recientes);
  const alerts = arrayOrEmpty<any>(source.alertas);
  const followups = arrayOrEmpty<any>(operation.cotizaciones_seguimiento);
  const urgent = [...arrayOrEmpty<any>(tasks.vencidas), ...arrayOrEmpty<any>(tasks.hoy)];
  const primaryAlert = alerts[0];

  return {
    date: typeof source.generado_en === 'string' ? source.generado_en : undefined,
    permissions: { canViewFinance },
    kpis: {
      activeFiles: { value: recent.length, label: 'Expedientes recientes', context: 'Dentro de tu alcance' },
      signaturesToday: { value: Number(metrics.firmas_proximas || 0), label: 'Firmas próximas', context: 'Siguientes 7 días' },
      urgentPending: { value: Number(metrics.tareas_vencidas || 0) + Number(metrics.expedientes_bloqueados || 0), label: 'Pendientes urgentes', context: 'Vencidos o bloqueados' },
      ...(canViewFinance
        ? { financial: { value: Number(metrics.saldo_pendiente_total || 0), label: 'Por cobrar (MXN)', context: 'Saldo calculado en PRAVIA' } }
        : { operationalFallback: { value: Number(metrics.documentos_faltantes || 0), label: 'Documentos pendientes', context: 'Requisitos obligatorios' } }),
    },
    agenda: todayEvents.map((item) => ({
      id: item.id,
      startsAt: item.fecha_inicio,
      title: item.titulo,
      type: item.tipo,
      fileNumber: item.expediente?.numero_pravia,
      context: item.descripcion || item.ubicacion,
      status: item.estatus,
      tone: item.tipo === 'VENCIMIENTO' ? 'green' : item.tipo === 'FIRMA' ? 'blue' : 'gold',
    })),
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
      title: `Seguimiento a ${item.numero}`,
      context: item.cliente,
      dueAt: item.fecha_seguimiento,
      href: `/cotizaciones/${item.id}`,
      kind: 'call',
    })),
    urgentTasks: urgent.map((item) => ({
      id: item.id,
      title: item.titulo,
      context: item.expediente?.cliente_alias,
      reference: item.expediente?.numero_pravia,
      priority: item.prioridad === 'URGENTE' || (item.fecha_limite && new Date(item.fecha_limite) < new Date()) ? 'urgent' : 'pending',
      href: item.expediente_id ? `/expedientes/${item.expediente_id}` : '/agenda',
    })),
    finance: canViewFinance ? {
      metrics: [{ key: 'receivable', label: 'Por cobrar (MXN)', value: Number(metrics.saldo_pendiente_total || 0), currency: 'MXN' }],
    } : null,
    errors: {},
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
    permissions: { canViewFinance: permissions.canViewFinance === true },
    kpis,
    agenda: arrayOrEmpty(source.agenda),
    urgentSignatures: arrayOrEmpty(source.urgentSignatures),
    recentFiles: arrayOrEmpty(source.recentFiles),
    recommendation: source.recommendation && typeof source.recommendation === 'object'
      ? source.recommendation as MyDayData['recommendation']
      : null,
    reminders: arrayOrEmpty(source.reminders),
    urgentTasks: arrayOrEmpty(source.urgentTasks),
    finance,
    errors: normalizeErrors(source.errors),
  };
};

export const myDayService = {
  async get(signal?: AbortSignal): Promise<MyDayData> {
    const payload = await apiRequest<unknown>(apiConfig.myDayPath, { signal });
    return normalizeMyDay(payload);
  },
};
