import type { PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { AiWalletService } from './aiWallet.service';
import { serializeBigInts } from './platform.errors';
import { StorageAccountingService } from './storageAccounting.service';

export class TenantConsumptionService {
  private readonly storage: StorageAccountingService;
  private readonly wallet: AiWalletService;

  constructor(private readonly db: PrismaClient = prisma) {
    this.storage = new StorageAccountingService(db);
    this.wallet = new AiWalletService(db);
  }

  async subscription(organizationId: string) {
    const subscription = await this.db.tenantSubscription.findFirst({
      where: { organization_id: organizationId, status: { not: 'CANCELLED' } },
      orderBy: { created_at: 'desc' },
    });
    const plan = subscription
      ? await this.db.planVersion.findUnique({ where: { id: subscription.plan_version_id } })
      : null;
    return serializeBigInts({ subscription, plan });
  }

  storageState(organizationId: string) {
    return this.storage.getState(organizationId);
  }

  async aiState(organizationId: string) {
    const [wallet, history, grouped] = await Promise.all([
      this.wallet.getWallet(organizationId),
      this.db.aiWalletTransaction.findMany({
        where: { organization_id: organizationId },
        orderBy: { created_at: 'desc' },
        take: 50,
        select: { id: true, type: true, amount_minor: true, payment_ref: true, expires_at: true, created_at: true },
      }),
      this.db.aiWalletTransaction.groupBy({
        by: ['type'], where: { organization_id: organizationId }, _sum: { amount_minor: true }, _count: true,
      }),
    ]);
    return serializeBigInts({ wallet, history, totals: grouped });
  }

  async billing(organizationId: string) {
    const cycles = await this.db.billingCycle.findMany({
      where: { organization_id: organizationId },
      orderBy: { period_start: 'desc' },
      take: 24,
    });
    return serializeBigInts({ cycles });
  }

  async migrations(organizationId: string) {
    const jobs = await this.db.migrationJob.findMany({
      where: { organization_id: organizationId },
      orderBy: { created_at: 'desc' },
      take: 50,
      select: {
        id: true, source_system: true, status: true, declared_bytes: true, temporary_bytes: true,
        estimated_production_bytes: true, detected_files: true, detected_records: true,
        duplicate_files: true, corrupt_files: true, dangerous_files: true, progress: true,
        started_at: true, completed_at: true, created_at: true, updated_at: true,
      },
    });
    return serializeBigInts({ jobs });
  }

  async overview(organizationId: string) {
    const [subscription, storage, ai, billing, migrations] = await Promise.all([
      this.subscription(organizationId), this.storageState(organizationId), this.aiState(organizationId),
      this.billing(organizationId), this.migrations(organizationId),
    ]);
    return { subscription, storage, ai, billing, migrations };
  }
}

export const tenantConsumptionService = new TenantConsumptionService();
