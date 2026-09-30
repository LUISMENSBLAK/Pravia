import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { intelligentNotificationService, type NotificationActor } from './intelligentNotification.service';

type Actor = { id: string; organizationId: string };
type AlertSeed = {
  key: string; sourceType: string; sourceId?: string; entityType?: string; entityId?: string;
  severity: 'INFORMATIONAL' | 'IMPORTANT' | 'URGENT'; title: string; body?: string; href?: string; dueAt?: Date;
  actions?: Array<{ label: string; type: 'NAVIGATE' | 'PREPARE'; value: string }>;
  metadata?: Record<string, unknown>;
};

export class AssistantAlertError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}

export class AssistantAlertService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async upsert(actor: Actor, seed: AlertSeed, userId?: string) {
    return this.db.assistantAlert.upsert({
      where: { organization_id_deterministic_key: { organization_id: actor.organizationId, deterministic_key: seed.key } },
      create: {
        organization_id: actor.organizationId, user_id: userId || null, deterministic_key: seed.key,
        source_type: seed.sourceType, source_id: seed.sourceId || null, entity_type: seed.entityType || null, entity_id: seed.entityId || null,
        severity: seed.severity, title: seed.title, body: seed.body || null, href: seed.href || null,
        actions: (seed.actions || []) as Prisma.InputJsonValue, due_at: seed.dueAt || null, metadata: (seed.metadata || {}) as Prisma.InputJsonValue,
      },
      update: {
        severity: seed.severity, title: seed.title, body: seed.body || null, href: seed.href || null,
        actions: (seed.actions || []) as Prisma.InputJsonValue, due_at: seed.dueAt || null, metadata: (seed.metadata || {}) as Prisma.InputJsonValue,
        ...(userId ? { user_id: userId } : {}),
      },
    });
  }

  async list(actor: Actor) {
    if (Array.isArray((actor as NotificationActor).permissions)) {
      const notifications = await intelligentNotificationService.refreshAndList(actor as NotificationActor, { limit: 100 });
      return notifications.map((item) => {
        const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata as Record<string, unknown> : {};
        return {
          id: item.id,
          organization_id: item.organization_id,
          user_id: item.recipient_id,
          deterministic_key: item.deterministic_key,
          source_type: item.type,
          source_id: item.entity_id,
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          severity: item.priority === 'URGENT' ? 'URGENT' : item.priority === 'IMPORTANT' ? 'IMPORTANT' : 'INFORMATIONAL',
          title: item.title,
          body: item.body,
          href: item.href,
          actions: item.href ? [{ label: 'Revisar', type: 'NAVIGATE', value: item.href }] : [],
          state: item.read_at ? 'ACKNOWLEDGED' : 'OPEN',
          due_at: typeof metadata.due_at === 'string' ? new Date(metadata.due_at) : null,
          snoozed_until: item.snoozed_until,
          acknowledged_at: item.read_at,
          resolved_at: item.resolved_at,
          metadata: item.metadata,
          created_at: item.created_at,
          updated_at: item.updated_at,
        };
      });
    }
    const now = new Date();
    return this.db.assistantAlert.findMany({
      where: {
        organization_id: actor.organizationId,
        state: { in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] },
        OR: [{ user_id: null }, { user_id: actor.id }],
        AND: [{ OR: [{ snoozed_until: null }, { snoozed_until: { lte: now } }] }],
        NOT: { source_type: 'FINANCE_COLLECTION_5_3_0' },
      },
      orderBy: [{ severity: 'desc' }, { due_at: 'asc' }, { created_at: 'desc' }],
      take: 100,
    });
  }

  async transition(actor: Actor, alertId: string, action: 'ACKNOWLEDGE' | 'SNOOZE' | 'RESOLVE', snoozedUntil?: Date) {
    if (Array.isArray((actor as NotificationActor).permissions)) {
      const notification = await this.db.notification.findFirst({ where: { id: alertId, organization_id: actor.organizationId, recipient_id: actor.id } });
      if (notification) {
        if (action === 'SNOOZE' && (!snoozedUntil || snoozedUntil <= new Date())) throw new AssistantAlertError('Selecciona una fecha futura para posponer.', 'AI_ALERT_SNOOZE_INVALID');
        const at = new Date();
        const updated = await this.db.notification.update({ where: { id: alertId }, data: action === 'ACKNOWLEDGE'
          ? { read_at: at }
          : action === 'SNOOZE' ? { snoozed_until: snoozedUntil, read_at: at }
            : { status: 'DISMISSED', dismissed_at: at, read_at: notification.read_at || at } });
        await this.db.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: `AI_NOTIFICATION_${action}`, entidad: 'Notification', entidad_id: alertId, detalles: { origin: 'PRAVIA_IA', prior_status: notification.status } } });
        return updated;
      }
    }
    const current = await this.db.assistantAlert.findFirst({ where: { id: alertId, organization_id: actor.organizationId, OR: [{ user_id: null }, { user_id: actor.id }] } });
    if (!current) throw new AssistantAlertError('La alerta no existe dentro de tu alcance.', 'AI_ALERT_NOT_FOUND', 404);
    if (action === 'SNOOZE' && (!snoozedUntil || snoozedUntil <= new Date())) throw new AssistantAlertError('Selecciona una fecha futura para posponer.', 'AI_ALERT_SNOOZE_INVALID');
    const at = new Date();
    const updated = await this.db.assistantAlert.update({ where: { id: alertId }, data: action === 'ACKNOWLEDGE'
      ? { state: 'ACKNOWLEDGED', acknowledged_at: at }
      : action === 'SNOOZE' ? { state: 'SNOOZED', snoozed_until: snoozedUntil }
        : { state: 'RESOLVED', resolved_at: at } });
    await this.db.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: `AI_ALERT_${action}`, entidad: 'AssistantAlert', entidad_id: alertId, detalles: { origin: 'PRAVIA_IA', prior_state: current.state } } });
    return updated;
  }
}

export const assistantAlertService = new AssistantAlertService();
