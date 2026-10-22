import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { PlatformDomainError, serializeBigInts } from './platform.errors';

export type PlatformPermission =
  | 'platform.dashboard.read'
  | 'platform.tenants.read'
  | 'platform.pricing.read'
  | 'platform.costs.read'
  | 'platform.jobs.read'
  | 'platform.audit.read'
  | 'platform.tenant_access.grant';

const permissionList = (value: Prisma.JsonValue): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

export class PlatformAdminService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async authorize(userId: string, permission: PlatformPermission) {
    const administrator = await this.db.platformAdministrator.findFirst({ where: {
      user_id: userId, status: 'ACTIVE', revoked_at: null,
    } });
    if (!administrator || !permissionList(administrator.permissions).includes(permission)) {
      throw new PlatformDomainError('PLATFORM_ADMIN_DENIED', 'Esta sesión no tiene autorización de plataforma.', 403);
    }
    return administrator;
  }

  async dashboard(userId: string) {
    const administrator = await this.authorize(userId, 'platform.dashboard.read');
    const now = new Date();
    const staleBefore = new Date(now.getTime() - 30 * 60 * 1_000);
    const [
      organizations, placements, storage, wallets, jobs, migrations, exports, snapshots,
      failedJobs, stuckJobs, migrationIssues, exportIssues, temporaryStorage,
      aiSpendAnomalies, backupIssues, billingWebhookIssues,
    ] = await Promise.all([
      this.db.organization.groupBy({ by: ['status'], _count: true }),
      this.db.tenantPlacement.groupBy({ by: ['deployment_type', 'status'], _count: true }),
      this.db.tenantStorageUsage.aggregate({ _sum: { production_bytes: true, temporary_bytes: true, reserved_bytes: true } }),
      this.db.aiWallet.aggregate({ _sum: { balance_minor: true }, _count: true }),
      this.db.backgroundJob.groupBy({ by: ['status'], _count: true }),
      this.db.migrationJob.groupBy({ by: ['status'], _count: true }),
      this.db.exportJob.groupBy({ by: ['status'], _count: true }),
      this.db.tenantCostSnapshot.aggregate({ _sum: {
        storage_cost: true, ai_cost: true, egress_cost: true, other_cost: true,
        subscription_revenue: true, storage_revenue: true, ai_sales: true, gross_margin_estimate: true,
      } }),
      this.db.backgroundJob.findMany({
        where: { status: 'FAILED' }, orderBy: { finished_at: 'desc' }, take: 50,
        select: { id: true, organization_id: true, job_type: true, status: true, attempts: true, max_attempts: true, finished_at: true },
      }),
      this.db.backgroundJob.findMany({
        where: { status: 'RUNNING', lease_expires_at: { lte: now } }, orderBy: { lease_expires_at: 'asc' }, take: 50,
        select: { id: true, organization_id: true, job_type: true, status: true, progress: true, attempts: true, max_attempts: true, lease_expires_at: true, heartbeat_at: true },
      }),
      this.db.migrationJob.findMany({
        where: { OR: [
          { status: 'FAILED' },
          { status: { in: ['UPLOADING', 'ANALYZING', 'MIGRATING', 'VERIFYING'] }, updated_at: { lte: staleBefore } },
        ] },
        orderBy: { updated_at: 'asc' }, take: 50,
        select: { id: true, organization_id: true, source_system: true, status: true, progress: true, temporary_bytes: true, created_at: true, updated_at: true },
      }),
      this.db.exportJob.findMany({
        where: { OR: [
          { status: 'FAILED' },
          { status: { in: ['PENDING', 'RUNNING'] }, created_at: { lte: staleBefore }, completed_at: null },
        ] },
        orderBy: { created_at: 'asc' }, take: 50,
        select: { id: true, organization_id: true, status: true, format: true, progress: true, created_at: true, completed_at: true, expires_at: true },
      }),
      this.db.tenantStorageUsage.findMany({
        where: { temporary_bytes: { gt: 0 } }, orderBy: { temporary_bytes: 'desc' }, take: 50,
        select: { organization_id: true, temporary_bytes: true, production_bytes: true, reserved_bytes: true, updated_at: true },
      }),
      this.db.tenantCostSnapshot.findMany({
        where: { OR: [
          { gross_margin_estimate: { lt: 0 } },
          { ai_cost: { gt: this.db.tenantCostSnapshot.fields.ai_sales } },
        ] },
        orderBy: { period: 'desc' }, take: 50,
        select: { organization_id: true, period: true, ai_cost: true, ai_sales: true, commercial_ai_consumption: true, gross_margin_estimate: true, currency: true },
      }),
      this.db.backupRun.findMany({
        where: { OR: [
          { status: 'FAILED' },
          { status: 'RUNNING', started_at: { lte: staleBefore }, completed_at: null },
        ] },
        orderBy: { started_at: 'asc' }, take: 50,
        select: { id: true, organization_id: true, scope: true, provider: true, status: true, started_at: true, completed_at: true },
      }),
      this.db.billingEvent.findMany({
        where: { status: { in: ['FAILED', 'ERROR', 'REJECTED'] } }, orderBy: { created_at: 'desc' }, take: 50,
        select: { id: true, organization_id: true, provider_code: true, provider_event_id: true, event_type: true, status: true, processed_at: true, created_at: true },
      }),
    ]);
    await this.audit({ actorId: administrator.id, action: 'PLATFORM_DASHBOARD_READ' });
    return serializeBigInts({
      generatedAt: now,
      staleThresholdMinutes: 30,
      organizations, placements, storage, wallets, jobs, migrations, exports, costSnapshots: snapshots,
      operations: {
        failedJobs, stuckJobs, migrationIssues, exportIssues, temporaryStorage,
        aiSpendAnomalies, backupIssues, billingWebhookIssues,
      },
    });
  }

  async tenants(userId: string) {
    const administrator = await this.authorize(userId, 'platform.tenants.read');
    const organizations = await this.db.organization.findMany({
      orderBy: { created_at: 'asc' },
      select: { id: true, name: true, status: true, created_at: true },
    });
    const ids = organizations.map((organization) => organization.id);
    const [placements, subscriptions, usage, entitlements, wallets] = await Promise.all([
      this.db.tenantPlacement.findMany({ where: { organization_id: { in: ids } } }),
      this.db.tenantSubscription.findMany({ where: { organization_id: { in: ids }, status: { not: 'CANCELLED' } }, orderBy: { created_at: 'desc' } }),
      this.db.tenantStorageUsage.findMany({ where: { organization_id: { in: ids } } }),
      this.db.tenantEntitlement.findMany({ where: { organization_id: { in: ids } } }),
      this.db.aiWallet.findMany({ where: { organization_id: { in: ids } } }),
    ]);
    const latestSubscription = new Map<string, typeof subscriptions[number]>();
    subscriptions.forEach((subscription) => { if (!latestSubscription.has(subscription.organization_id)) latestSubscription.set(subscription.organization_id, subscription); });
    const byOrganization = <T extends { organization_id: string }>(rows: T[]) => new Map(rows.map((row) => [row.organization_id, row]));
    const placementByOrg = byOrganization(placements);
    const usageByOrg = byOrganization(usage);
    const entitlementByOrg = byOrganization(entitlements);
    const walletByOrg = byOrganization(wallets);
    await this.audit({ actorId: administrator.id, action: 'PLATFORM_TENANTS_READ' });
    return serializeBigInts(organizations.map((organization) => ({
      ...organization,
      placement: placementByOrg.get(organization.id) || null,
      subscription: latestSubscription.get(organization.id) || null,
      storage: usageByOrg.get(organization.id) || null,
      entitlement: entitlementByOrg.get(organization.id) || null,
      aiWallet: walletByOrg.get(organization.id) || null,
    })));
  }

  async grantTenantAccess(input: {
    userId: string; organizationId: string; scope: string[]; reason: string; expiresAt: Date;
    approvalMetadata?: Prisma.InputJsonValue; traceId: string;
  }) {
    const administrator = await this.authorize(input.userId, 'platform.tenant_access.grant');
    const scope = [...new Set(input.scope.map((item) => item.trim()).filter(Boolean))];
    if (!scope.length || input.reason.trim().length < 10 || !(input.expiresAt instanceof Date)
      || Number.isNaN(input.expiresAt.getTime()) || input.expiresAt <= new Date() || !input.traceId.trim()) {
      throw new PlatformDomainError('PLATFORM_ACCESS_GRANT_INVALID', 'El acceso exige alcance, motivo, expiración futura y trazabilidad.', 400);
    }
    await this.db.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
    return this.db.$transaction(async (tx) => {
      const grant = await tx.platformAccessGrant.create({ data: {
        platform_administrator_id: administrator.id, organization_id: input.organizationId,
        scope, reason: input.reason.trim(), approval_metadata: input.approvalMetadata || {}, expires_at: input.expiresAt,
      } });
      await tx.platformAuditEvent.create({ data: {
        platform_actor_id: administrator.id, organization_id: input.organizationId,
        action: 'PLATFORM_TENANT_ACCESS_GRANTED', target_type: 'PLATFORM_ACCESS_GRANT', target_id: grant.id,
        reason: input.reason.trim(), after_metadata: { scope, expiresAt: input.expiresAt.toISOString() }, trace_id: input.traceId,
      } });
      return serializeBigInts(grant);
    });
  }

  async revokeTenantAccess(input: { userId: string; grantId: string; reason: string; traceId: string }) {
    const administrator = await this.authorize(input.userId, 'platform.tenant_access.grant');
    if (input.reason.trim().length < 10 || !input.traceId.trim()) {
      throw new PlatformDomainError('PLATFORM_ACCESS_REVOCATION_INVALID', 'La revocación exige motivo y trazabilidad.', 400);
    }
    return this.db.$transaction(async (tx) => {
      const grant = await tx.platformAccessGrant.findUniqueOrThrow({ where: { id: input.grantId } });
      const revoked = await tx.platformAccessGrant.update({ where: { id: grant.id }, data: { status: 'REVOKED', revoked_at: new Date() } });
      await tx.platformAuditEvent.create({ data: {
        platform_actor_id: administrator.id, organization_id: grant.organization_id,
        action: 'PLATFORM_TENANT_ACCESS_REVOKED', target_type: 'PLATFORM_ACCESS_GRANT', target_id: grant.id,
        reason: input.reason.trim(), before_metadata: { status: grant.status, expiresAt: grant.expires_at.toISOString() },
        after_metadata: { status: 'REVOKED' }, trace_id: input.traceId,
      } });
      return serializeBigInts(revoked);
    });
  }

  async validTenantGrant(input: { userId: string; organizationId: string; requiredScope: string }) {
    const administrator = await this.db.platformAdministrator.findFirst({ where: { user_id: input.userId, status: 'ACTIVE', revoked_at: null } });
    if (!administrator) return null;
    const grants = await this.db.platformAccessGrant.findMany({ where: {
      platform_administrator_id: administrator.id, organization_id: input.organizationId,
      status: 'ACTIVE', revoked_at: null, expires_at: { gt: new Date() },
    } });
    return grants.find((grant) => permissionList(grant.scope).includes(input.requiredScope)) || null;
  }

  private audit(input: { actorId: string; action: string; organizationId?: string; targetType?: string; targetId?: string; traceId?: string }) {
    return this.db.platformAuditEvent.create({ data: {
      platform_actor_id: input.actorId, organization_id: input.organizationId,
      action: input.action, target_type: input.targetType, target_id: input.targetId,
      trace_id: input.traceId || crypto.randomUUID(),
    } });
  }
}

export const platformAdminService = new PlatformAdminService();
