import type { Request } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { comparecienteObjectWhere, predioObjectWhere } from './objectAccess.service';
import { agendaReadableWhere } from './agendaVisibility.service';

export type NotificationActor = NonNullable<Request['user']>;
export type NotificationStatus = 'ACTIVE' | 'RESOLVED' | 'DISMISSED' | 'NOT_APPLICABLE';

type NotificationSeed = {
  key: string;
  type: string;
  subtype?: string;
  priority: 'LOW' | 'NORMAL' | 'IMPORTANT' | 'URGENT';
  title: string;
  body: string;
  sourceModule: string;
  entityType: string;
  entityId: string;
  href: string;
  dueAt?: Date | null;
  metadata?: Record<string, unknown>;
};

const DAY_MS = 86_400_000;
const MANAGED_MODULES = ['AGENDA', 'EXPEDIENTES', 'DOCUMENTOS', 'SEGUIMIENTO', 'CUMPLIMIENTO', 'FINANZAS'];
const refreshInFlight = new Map<string, Promise<{ refreshed: number; activeKeys: string[] }>>();

export function coalesceNotificationRefresh(
  key: string,
  refresh: () => Promise<{ refreshed: number; activeKeys: string[] }>,
) {
  const current = refreshInFlight.get(key);
  if (current) return current;
  const pending = refresh().finally(() => {
    if (refreshInFlight.get(key) === pending) refreshInFlight.delete(key);
  });
  refreshInFlight.set(key, pending);
  return pending;
}

const dateParts = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: value('year'), month: value('month'), day: value('day') };
};

export const localDayKey = (date: Date, timeZone = 'America/Mexico_City') => {
  const { year, month, day } = dateParts(date, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export const calendarDaysUntil = (now: Date, dueAt: Date, timeZone = 'America/Mexico_City') => {
  const current = dateParts(now, timeZone);
  const due = dateParts(dueAt, timeZone);
  return Math.round((Date.UTC(due.year, due.month - 1, due.day) - Date.UTC(current.year, current.month - 1, current.day)) / DAY_MS);
};

export const shouldIssueDailyReminder = (input: { now: Date; dueAt?: Date | null; lastReminderAt?: Date | null; timeZone?: string }) => {
  if (!input.dueAt) return !input.lastReminderAt;
  const zone = input.timeZone || 'America/Mexico_City';
  if (calendarDaysUntil(input.now, input.dueAt, zone) > 7) return false;
  return !input.lastReminderAt || localDayKey(input.lastReminderAt, zone) !== localDayKey(input.now, zone);
};

const dueMetadata = (now: Date, dueAt: Date | null | undefined, timeZone: string) => dueAt ? {
  due_at: dueAt.toISOString(),
  days_until: calendarDaysUntil(now, dueAt, timeZone),
  reminder_policy: 'FIRST_AT_7_DAYS_THEN_DAILY_WHILE_ACTIVE',
} : { due_at: null, reminder_policy: 'ONCE_WHILE_ACTIVE_WITHOUT_CANONICAL_DATE' };

const isDueWindow = (now: Date, dueAt: Date | null | undefined, timeZone: string) => !dueAt || calendarDaysUntil(now, dueAt, timeZone) <= 7;
const hrefForCase = (id: string, hash = '') => `/expedientes/${id}${hash}`;

export class IntelligentNotificationService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async derive(actor: NotificationActor, now: Date, timeZone: string): Promise<NotificationSeed[]> {
    const sevenDays = new Date(now.getTime() + (8 * DAY_MS));
    const caseScope = actor.permissions.includes('expedientes.read')
      ? { organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor) }
      : null;
    const isGlobal = ['DIRECCION', 'ADMINISTRACION', 'CONSULTA'].includes(actor.rol);
    const taskWhere: Prisma.TareaWhereInput = {
      organization_id: actor.organizationId,
      estatus: { in: ['PENDIENTE', 'EN_PROCESO'] },
      ...(isGlobal ? {} : { asignado_a_id: actor.id }),
    };
    const eventWhere: Prisma.EventoAgendaWhereInput = {
      ...agendaReadableWhere(actor),
      estatus: 'ACTIVO' as const,
      fecha_inicio: { lte: sevenDays },
    };

    const [preference, tasks, events, cases, comparecientes, predios, complianceAlerts, paymentRequests, pendingIncome, movements] = await Promise.all([
      this.db.userPreference.findUnique({ where: { user_id: actor.id }, select: { timezone: true } }),
      this.db.tarea.findMany({
        where: taskWhere,
        select: { id: true, titulo: true, descripcion: true, prioridad: true, fecha_limite: true, expediente_id: true, expediente: { select: { numero_pravia: true } } },
        orderBy: [{ fecha_limite: 'asc' }, { prioridad: 'desc' }], take: 120,
      }),
      actor.permissions.includes('agenda.read') ? this.db.eventoAgenda.findMany({
        where: eventWhere,
        select: { id: true, titulo: true, descripcion: true, tipo: true, fecha_inicio: true, expediente_id: true, expediente: { select: { numero_pravia: true } } },
        orderBy: { fecha_inicio: 'asc' }, take: 120,
      }) : Promise.resolve([]),
      caseScope ? this.db.expediente.findMany({
        where: caseScope,
        select: {
          id: true, numero_pravia: true, cliente_alias: true, estatus: true, fecha_estimada_firma: true, fecha_real_firma: true,
          requisitos_docs: { where: { obligatorio: true, estatus: { in: ['PENDIENTE', 'RECHAZADO', 'VENCIDO'] } }, select: { id: true, nombre: true, estatus: true, fecha_vencimiento: true } },
          documentos: { where: { fecha_vigencia: { not: null }, estatus: { not: 'VENCIDO' } }, select: { id: true, nombre_original: true, fecha_vigencia: true, categoria: true } },
        },
        orderBy: { updated_at: 'desc' }, take: 300,
      }) : Promise.resolve([]),
      actor.permissions.includes('comparecientes.read') ? this.db.compareciente.findMany({
        where: { organization_id: actor.organizationId, archived_at: null, ...comparecienteObjectWhere(actor) },
        select: { id: true, nombre_busqueda: true, identificaciones: { where: { archived_at: null, fecha_vencimiento: { not: null }, estatus: { not: 'VENCIDO' } }, select: { id: true, tipo_identificacion: true, fecha_vencimiento: true } } },
        take: 250,
      }) : Promise.resolve([]),
      actor.permissions.includes('documentos.read') ? this.db.predio.findMany({
        where: { organization_id: actor.organizationId, archived_at: null, ...predioObjectWhere(actor) },
        select: { id: true, apodo: true, ubicacion_texto: true, documentos: { where: { estatus: 'ACTIVO', documento: { fecha_vigencia: { not: null }, estatus: { not: 'VENCIDO' } } }, select: { documento: { select: { id: true, nombre_original: true, fecha_vigencia: true, categoria: true } } } } },
        take: 250,
      }) : Promise.resolve([]),
      actor.permissions.includes('compliance.read') ? this.db.complianceAlert.findMany({
        where: { organization_id: actor.organizationId, status: 'ABIERTA', ...(caseScope ? { expediente: caseScope } : {}) },
        select: { id: true, level: true, message: true, deadline: true, expediente_id: true, expediente: { select: { numero_pravia: true } } },
        orderBy: { deadline: 'asc' }, take: 120,
      }) : Promise.resolve([]),
      actor.permissions.includes('finanzas.read') ? this.db.expedienteSolicitudPago.findMany({
        where: { organization_id: actor.organizationId, estado: 'PENDIENTE' },
        select: { id: true, concepto: true, importe: true, fecha_limite: true, expediente_id: true, expediente: { select: { numero_pravia: true } } },
        orderBy: { fecha_limite: 'asc' }, take: 120,
      }) : Promise.resolve([]),
      actor.permissions.includes('finanzas.read') ? this.db.expedienteIngresoReportado.findMany({
        where: { organization_id: actor.organizationId, estado: 'PENDIENTE_APLICACION' },
        select: { id: true, monto_reportado: true, created_at: true, expediente_id: true, expediente: { select: { numero_pravia: true } } },
        orderBy: { created_at: 'asc' }, take: 120,
      }) : Promise.resolve([]),
      actor.permissions.includes('finanzas.read') ? this.db.movimientoFinanciero.findMany({
        where: { organization_id: actor.organizationId, fecha_registro: { gte: new Date(now.getTime() - DAY_MS) }, estatus: { not: 'CANCELADO' } },
        select: { id: true, concepto: true, monto: true, fecha_registro: true, expediente_id: true },
        orderBy: { fecha_registro: 'desc' }, take: 30,
      }) : Promise.resolve([]),
    ]);
    const followUps = cases.length ? await this.db.expedienteSeguimientoActividad.findMany({
      where: {
        organization_id: actor.organizationId, expediente_id: { in: cases.map((item) => item.id) }, en_alcance: true,
        estado: { in: ['NO_INICIADO', 'EN_PROCESO', 'EN_ESPERA_EXTERNA', 'BLOQUEADO'] },
      },
      select: { id: true, expediente_id: true, actividad_nombre_snapshot: true, estado: true, fecha_objetivo_proyectada: true, responsable_id: true },
      take: 400,
    }) : [];
    const followUpsByCase = new Map<string, typeof followUps>();
    followUps.forEach((item) => followUpsByCase.set(item.expediente_id, [...(followUpsByCase.get(item.expediente_id) || []), item]));
    const zone = preference?.timezone || timeZone;
    const seeds: NotificationSeed[] = [];
    const add = (seed: NotificationSeed) => { if (isDueWindow(now, seed.dueAt, zone)) seeds.push(seed); };

    for (const task of tasks) add({
      key: `TASK:${task.id}`, type: 'TASK_DUE', subtype: task.fecha_limite && calendarDaysUntil(now, task.fecha_limite, zone) < 0 ? 'OVERDUE' : 'UPCOMING',
      priority: task.prioridad === 'URGENTE' || (task.fecha_limite && calendarDaysUntil(now, task.fecha_limite, zone) < 0) ? 'URGENT' : task.prioridad === 'ALTA' ? 'IMPORTANT' : 'NORMAL',
      title: task.titulo, body: [task.expediente?.numero_pravia, task.descripcion].filter(Boolean).join(' · ') || 'Tarea operativa pendiente.',
      sourceModule: 'AGENDA', entityType: 'Tarea', entityId: task.id, href: task.expediente_id ? hrefForCase(task.expediente_id, '#seguimiento') : '/agenda', dueAt: task.fecha_limite,
      metadata: { canonical_source: 'Tarea.fecha_limite', priority: task.prioridad },
    });

    for (const event of events) add({
      key: `EVENT:${event.id}`, type: 'EVENT_UPCOMING', subtype: event.tipo, priority: ['FIRMA', 'VENCIMIENTO', 'AUDIENCIA'].includes(event.tipo) ? 'IMPORTANT' : 'NORMAL',
      title: event.titulo, body: [event.expediente?.numero_pravia, event.descripcion].filter(Boolean).join(' · ') || 'Evento próximo en agenda.',
      sourceModule: 'AGENDA', entityType: 'EventoAgenda', entityId: event.id, href: event.expediente_id ? hrefForCase(event.expediente_id) : '/agenda', dueAt: event.fecha_inicio,
      metadata: { canonical_source: 'EventoAgenda.fecha_inicio', event_type: event.tipo },
    });

    for (const expediente of cases) {
      if (expediente.fecha_estimada_firma && !expediente.fecha_real_firma) add({
        key: `SIGNATURE:${expediente.id}`, type: 'SIGNATURE_UPCOMING', subtype: 'EXPEDIENTE_SIGNATURE', priority: 'URGENT',
        title: `Firma próxima: ${expediente.numero_pravia}`, body: expediente.cliente_alias || 'Expediente con firma programada.',
        sourceModule: 'EXPEDIENTES', entityType: 'Expediente', entityId: expediente.id, href: hrefForCase(expediente.id), dueAt: expediente.fecha_estimada_firma,
        metadata: { canonical_source: 'Expediente.fecha_estimada_firma' },
      });
      for (const requirement of expediente.requisitos_docs) add({
        key: `DOC_REQUIREMENT:${requirement.id}`, type: 'DOCUMENT_REQUIRED', subtype: requirement.estatus, priority: requirement.estatus === 'VENCIDO' ? 'URGENT' : 'IMPORTANT',
        title: `Documento pendiente: ${requirement.nombre}`, body: `${expediente.numero_pravia} · ${expediente.cliente_alias || 'Expediente'}`,
        sourceModule: 'DOCUMENTOS', entityType: 'ExpedienteRequisitoDoc', entityId: requirement.id, href: hrefForCase(expediente.id, '#documentos'), dueAt: requirement.fecha_vencimiento,
        metadata: { canonical_source: 'ExpedienteRequisitoDoc', status: requirement.estatus },
      });
      for (const document of expediente.documentos) add({
        key: `DOCUMENT_EXPIRY:${document.id}`, type: 'DOCUMENT_EXPIRING', subtype: document.categoria, priority: 'IMPORTANT',
        title: `Documento por vencer: ${document.nombre_original}`, body: `${expediente.numero_pravia} · Revisa su vigencia.`,
        sourceModule: 'DOCUMENTOS', entityType: 'Documento', entityId: document.id, href: hrefForCase(expediente.id, '#documentos'), dueAt: document.fecha_vigencia,
        metadata: { canonical_source: 'Documento.fecha_vigencia', category: document.categoria },
      });
      for (const activity of followUpsByCase.get(expediente.id) || []) {
        if (activity.responsable_id && activity.responsable_id !== actor.id && !isGlobal) continue;
        add({ key: `FOLLOW_UP:${activity.id}`, type: 'PROCESS_FOLLOW_UP', subtype: activity.estado, priority: activity.estado === 'BLOQUEADO' ? 'URGENT' : 'IMPORTANT',
          title: activity.actividad_nombre_snapshot, body: `${expediente.numero_pravia} · Seguimiento procesal pendiente.`,
          sourceModule: 'SEGUIMIENTO', entityType: 'ExpedienteSeguimientoActividad', entityId: activity.id, href: hrefForCase(expediente.id, '#seguimiento'), dueAt: activity.fecha_objetivo_proyectada,
          metadata: { canonical_source: 'ExpedienteSeguimientoActividad.fecha_objetivo_proyectada', status: activity.estado },
        });
      }
    }

    for (const party of comparecientes) for (const identification of party.identificaciones) add({
      key: `IDENTIFICATION_EXPIRY:${identification.id}`, type: 'IDENTIFICATION_EXPIRING', subtype: identification.tipo_identificacion, priority: 'IMPORTANT',
      title: `Identificación por vencer: ${party.nombre_busqueda}`, body: `${identification.tipo_identificacion} · Revisa o actualiza la vigencia.`,
      sourceModule: 'DOCUMENTOS', entityType: 'ComparecienteIdentificacion', entityId: identification.id, href: `/comparecientes/${party.id}`, dueAt: identification.fecha_vencimiento,
      metadata: { canonical_source: 'ComparecienteIdentificacion.fecha_vencimiento' },
    });

    for (const property of predios) for (const link of property.documentos) {
      const document = link.documento;
      add({ key: `DOCUMENT_EXPIRY:${document.id}`, type: 'DOCUMENT_EXPIRING', subtype: document.categoria, priority: 'IMPORTANT',
        title: `Documento de inmueble por vencer`, body: `${property.apodo || property.ubicacion_texto || 'Inmueble'} · ${document.nombre_original}`,
        sourceModule: 'DOCUMENTOS', entityType: 'Documento', entityId: document.id, href: `/predios/${property.id}`, dueAt: document.fecha_vigencia,
        metadata: { canonical_source: 'Documento.fecha_vigencia', property_id: property.id },
      });
    }

    for (const alert of complianceAlerts) add({
      key: `COMPLIANCE:${alert.id}`, type: 'COMPLIANCE_OBLIGATION', subtype: alert.level, priority: alert.level === 'CRITICA' ? 'URGENT' : alert.level === 'ADVERTENCIA' ? 'IMPORTANT' : 'NORMAL',
      title: `Cumplimiento: ${alert.expediente.numero_pravia}`, body: alert.message,
      sourceModule: 'CUMPLIMIENTO', entityType: 'ComplianceAlert', entityId: alert.id, href: hrefForCase(alert.expediente_id, '#cumplimiento'), dueAt: alert.deadline,
      metadata: { canonical_source: 'ComplianceAlert', level: alert.level },
    });

    for (const request of paymentRequests) add({
      key: `PAYMENT_REQUEST:${request.id}`, type: 'SOLICITUD_PAGO_PENDIENTE', subtype: 'PENDING', priority: request.fecha_limite ? 'IMPORTANT' : 'NORMAL',
      title: `Solicitud de pago: ${request.expediente.numero_pravia}`, body: `${request.concepto} · $${Number(request.importe).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
      sourceModule: 'FINANZAS', entityType: 'ExpedienteSolicitudPago', entityId: request.id, href: '/finanzas', dueAt: request.fecha_limite,
      metadata: { canonical_source: 'ExpedienteSolicitudPago.fecha_limite' },
    });
    for (const income of pendingIncome) add({
      key: `PENDING_INCOME:${income.id}`, type: 'INGRESO_PENDIENTE_APLICACION', subtype: 'PENDING', priority: 'IMPORTANT',
      title: `Ingreso por aplicar: ${income.expediente.numero_pravia}`, body: income.monto_reportado ? `$${Number(income.monto_reportado).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : 'Revisar comprobante e importe.',
      sourceModule: 'FINANZAS', entityType: 'ExpedienteIngresoReportado', entityId: income.id, href: '/finanzas', dueAt: null,
      metadata: { canonical_source: 'ExpedienteIngresoReportado.estado' },
    });
    for (const movement of movements) add({
      key: `FINANCIAL_MOVEMENT:${movement.id}`, type: 'FINANCIAL_MOVEMENT_RECORDED', subtype: 'RECENT', priority: 'NORMAL',
      title: 'Movimiento financiero registrado', body: `${movement.concepto} · $${Number(movement.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
      sourceModule: 'FINANZAS', entityType: 'MovimientoFinanciero', entityId: movement.id, href: '/finanzas', dueAt: null,
      metadata: { canonical_source: 'MovimientoFinanciero', recorded_at: movement.fecha_registro.toISOString(), expediente_id: movement.expediente_id },
    });

    return seeds.map((seed) => ({ ...seed, metadata: { ...(seed.metadata || {}), ...dueMetadata(now, seed.dueAt, zone) } }));
  }

  async refresh(actor: NotificationActor, options: { now?: Date; timeZone?: string } = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    if (!Number.isFinite(now.getTime())) throw new Error('NOTIFICATION_CLOCK_INVALID');
    const fallbackZone = options.timeZone || 'America/Mexico_City';
    const preference = await this.db.userPreference.findUnique({ where: { user_id: actor.id }, select: { timezone: true } });
    const timeZone = preference?.timezone || fallbackZone;
    const seeds = await this.derive(actor, now, timeZone);
    const activeKeys = seeds.map((seed) => seed.key);

    await this.db.$transaction(async (tx) => {
      // Mi Día, el botón global y el centro pueden refrescar al mismo tiempo.
      // Serializar por organización+usuario evita carreras y deadlocks entre
      // dos reconciliaciones del mismo conjunto sin bloquear otros usuarios.
      // pg_advisory_xact_lock devuelve `void`; convertir la expresión a boolean
      // evita que Prisma intente deserializar el pseudo-tipo de PostgreSQL.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.organizationId}:${actor.id}:notifications`}, 0)) IS NULL AS locked`;
      const existing = activeKeys.length ? await tx.notification.findMany({
        where: {
          organization_id: actor.organizationId,
          recipient_id: actor.id,
          deterministic_key: { in: activeKeys },
        },
      }) : [];
      const existingByKey = new Map(existing.map((item) => [item.deterministic_key, item]));
      for (const seed of seeds) {
        const current = existingByKey.get(seed.key);
        // Una decisión explícita del usuario detiene recordatorios futuros mientras
        // la fuente canónica conserve el mismo hecho. No se reabre silenciosamente.
        if (current && ['DISMISSED', 'NOT_APPLICABLE'].includes(current.status)) continue;
        const remind = shouldIssueDailyReminder({ now, dueAt: seed.dueAt, lastReminderAt: current?.last_reminder_at, timeZone });
        const metadata = seed.metadata as Prisma.InputJsonValue;
        const data = {
          type: seed.type, subtype: seed.subtype || null, priority: seed.priority, title: seed.title, body: seed.body,
          source_module: seed.sourceModule, entity_type: seed.entityType, entity_id: seed.entityId, href: seed.href,
          metadata, ...(remind ? { last_reminder_at: now, read_at: null, snoozed_until: null } : {}),
        };
        const notification = current
          ? await tx.notification.update({ where: { id: current.id }, data: {
            ...data,
            ...(current.status === 'RESOLVED' ? { status: 'ACTIVE', resolved_at: null } : {}),
          } })
          : await tx.notification.create({ data: {
            organization_id: actor.organizationId, recipient_id: actor.id, deterministic_key: seed.key,
            target_scope: 'USER', target_role: actor.rol, status: 'ACTIVE', ...data,
          } });
        if (remind || !current) await tx.notificationReminder.createMany({ data: [{
          organization_id: actor.organizationId, notification_id: notification.id, reminder_key: localDayKey(now, timeZone), channel: 'INTERNAL',
          metadata: { due_at: seed.dueAt?.toISOString() || null, policy: '7_DAY_DAILY' },
        }], skipDuplicates: true });
      }
      await tx.notification.updateMany({
        where: {
          organization_id: actor.organizationId, recipient_id: actor.id, status: 'ACTIVE', source_module: { in: MANAGED_MODULES },
          ...(activeKeys.length ? { deterministic_key: { notIn: activeKeys } } : {}),
        },
        data: { status: 'RESOLVED', resolved_at: now },
      });
    }, { maxWait: 30_000, timeout: 120_000 });
    return { refreshed: seeds.length, activeKeys };
  }

  async refreshAndList(actor: NotificationActor, options: { now?: Date; includeHistory?: boolean; limit?: number } = {}) {
    await coalesceNotificationRefresh(
      `${actor.organizationId}:${actor.id}`,
      () => this.refresh(actor, { now: options.now }),
    );
    const now = options.now ? new Date(options.now) : new Date();
    return this.db.notification.findMany({
      where: {
        organization_id: actor.organizationId, recipient_id: actor.id,
        ...(options.includeHistory ? {} : { status: 'ACTIVE', OR: [{ snoozed_until: null }, { snoozed_until: { lte: now } }] }),
      },
      include: { reminders: { orderBy: { created_at: 'desc' }, take: 14 } },
      orderBy: [{ priority: 'desc' }, { last_reminder_at: 'desc' }, { created_at: 'desc' }],
      take: Math.max(1, Math.min(200, options.limit || 100)),
    });
  }

  async transition(actor: NotificationActor, id: string, status: 'DISMISSED' | 'NOT_APPLICABLE') {
    const now = new Date();
    const existing = await this.db.notification.findFirst({ where: { id, organization_id: actor.organizationId, recipient_id: actor.id } });
    if (!existing) return null;
    return this.db.notification.update({ where: { id }, data: status === 'DISMISSED'
      ? { status, dismissed_at: now, read_at: existing.read_at || now }
      : { status, not_applicable_at: now, read_at: existing.read_at || now } });
  }
}

export const intelligentNotificationService = new IntelligentNotificationService();
