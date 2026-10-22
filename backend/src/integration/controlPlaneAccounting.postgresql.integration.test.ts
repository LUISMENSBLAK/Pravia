import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import JSZip from 'jszip';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageAccountingService } from '../platform/storageAccounting.service';
import { AiWalletService } from '../platform/aiWallet.service';
import { PlatformDomainError } from '../platform/platform.errors';
import { TenantDataRouter } from '../platform/tenantDataRouter.service';
import { AiGateway, type AiProviderAdapter } from '../platform/aiGateway.service';
import { OpenAiResponsesGatewayAdapter } from '../platform/openaiResponsesGateway.adapter';
import { BackgroundJobsService } from '../platform/backgroundJobs.service';
import { TrackedStorageService } from '../platform/trackedStorage.service';
import { StorageEntitlementsService } from '../platform/storageEntitlements.service';
import { BillingService, type BillingProvider, type BillingWebhookEvent } from '../platform/billing.service';
import { LocalBillingSandboxProvider } from '../platform/localBillingSandbox.provider';
import { MigrationEngineService } from '../platform/migrationEngine.service';
import { TenantExportService } from '../platform/export.service';
import { PlatformAdminService } from '../platform/platformAdmin.service';
import { BackupOrchestrator, type IndependentBackupProvider } from '../platform/backup.service';
import { FilesystemIndependentBackupProvider } from '../platform/filesystemBackup.provider';
import { LocalStorageProvider } from '../storage/localStorage.provider';
import type { StorageListPage, StorageObjectMetadata, StorageProvider } from '../storage/storage.types';

const target = process.env.DATABASE_URL || '';
const parsed = new URL(target || 'postgresql://invalid.invalid/blocked');
if (process.env.CONTROL_PLANE_QA === '1' && (
  process.env.NODE_ENV !== 'test'
  || target !== process.env.DIRECT_URL
  || parsed.hostname !== '127.0.0.1'
  || parsed.port !== '55510'
  || parsed.pathname !== '/pravia_control_plane_20261016'
  || parsed.searchParams.get('schema') !== 'pravia_os'
)) throw new Error('Control Plane QA requires the isolated local PostgreSQL copy.');

const db = new PrismaClient({ datasources: { db: { url: target } } });
const organizationId = randomUUID();
const userId = randomUUID();
const secondOrganizationId = randomUUID();
const secondUserId = randomUUID();
const largeExportOrganizationId = randomUUID();
const storage = new StorageAccountingService(db);
const wallet = new AiWalletService(db);
const router = new TenantDataRouter(db);
const jobs = new BackgroundJobsService(db);
const rlsRole = 'pravia_control_plane_rls_qa';
const qaOperation = `QA_SUMMARY_${organizationId}`;
const qaSku = `AI_USAGE:${qaOperation}`;
const qaAddonSku = `QA_STORAGE_${organizationId}`;

class FakeBillingProvider implements BillingProvider {
  readonly code = 'QA_BILLING';
  async createSubscription() { return { reference: 'qa-subscription' }; }
  async updateSubscription() {}
  async cancelSubscription() {}
  async createOneTimePayment() { return { reference: 'qa-payment' }; }
  async getPaymentStatus() { return 'PAID' as const; }
  async refund() { return { reference: 'qa-refund' }; }
  async verifyWebhook(payload: Buffer, signature: string): Promise<BillingWebhookEvent> {
    if (signature !== 'qa-valid-signature') throw new Error('INVALID_SIGNATURE');
    const parsed = JSON.parse(payload.toString('utf8')) as Omit<BillingWebhookEvent, 'amountMinor' | 'occurredAt'> & {
      amountMinor: string;
      occurredAt: string;
    };
    return { ...parsed, amountMinor: BigInt(parsed.amountMinor), occurredAt: new Date(parsed.occurredAt) };
  }
}

class FakeIndependentBackupProvider implements IndependentBackupProvider {
  readonly code = 'QA_INDEPENDENT_BACKUP';
  readonly independentFromPrimary = true;
  constructor(private readonly sourceSha256 = 'a'.repeat(64), private readonly sourceBytes = 4096n) {}
  async create(input: { backupRunId: string }) {
    return {
      bytes: this.sourceBytes, manifestRef: `qa://manifest/${input.backupRunId}`,
      restorePointRef: `qa://restore/${input.backupRunId}`, checksumSha256: this.sourceSha256,
    };
  }
  async restoreAndVerify(input: { backupRunId: string }) {
    return { result: 'PASS' as const, sampleCount: 7, reportRef: `qa://report/${input.backupRunId}`, details: { isolated: true } };
  }
}

const billing = new BillingService(db);
const billingProvider = new FakeBillingProvider();

class MemoryStorageProvider implements StorageProvider {
  readonly id = 'memory-qa';
  readonly capabilities = { head: true, copy: true, list: true, resumable: false, multipart: false } as const;
  readonly objects = new Map<string, Buffer>();
  async upload(buffer: Buffer, key: string) {
    if (this.objects.has(key)) throw new Error('OBJECT_EXISTS');
    this.objects.set(key, Buffer.from(buffer));
    return key;
  }
  async uploadFile(filename: string, key: string) { return this.upload(await import('node:fs/promises').then((fs) => fs.readFile(filename)), key, 'application/octet-stream'); }
  async download(key: string) {
    const value = this.objects.get(key);
    if (!value) throw new Error('OBJECT_NOT_FOUND');
    return Buffer.from(value);
  }
  async downloadFile(key: string, filename: string) { await writeFile(filename, await this.download(key), { flag: 'wx', mode: 0o600 }); }
  async delete(key: string) { this.objects.delete(key); }
  async signedUrl(key: string) { return `memory://qa/${key}`; }
  async exists(key: string) { return this.objects.has(key); }
  async head(key: string): Promise<StorageObjectMetadata | null> {
    const value = this.objects.get(key);
    return value ? { key, size: value.byteLength } : null;
  }
  async copy(sourceKey: string, destinationKey: string) {
    const source = await this.download(sourceKey);
    return this.upload(source, destinationKey, 'application/octet-stream');
  }
  async list(prefix: string): Promise<StorageListPage> {
    return { items: [...this.objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, size: value.byteLength })) };
  }
  async health() { return 'ok' as const; }
}

const cleanup = async () => {
  const qaOrganizations = await db.organization.findMany({
    where: { name: { startsWith: 'Control Plane QA' } },
    select: { id: true, memberships: { select: { user_id: true } } },
  });
  const organizationIds = [...new Set([
    organizationId,
    secondOrganizationId,
    largeExportOrganizationId,
    ...qaOrganizations.map((organization) => organization.id),
  ])];
  const userIds = [...new Set([
    userId,
    ...qaOrganizations.flatMap((organization) => organization.memberships.map((membership) => membership.user_id)),
  ])];
  const platformAdministrators = await db.platformAdministrator.findMany({ where: { user_id: { in: userIds } }, select: { id: true } });
  const platformAdministratorIds = platformAdministrators.map((administrator) => administrator.id);
  await db.comparecienteDocumento.deleteMany({ where: { organization_id: { in: organizationIds } } });
  await db.assistantAttachment.deleteMany({ where: { organization_id: { in: organizationIds } } });
  await db.assistantConversation.deleteMany({ where: { organization_id: { in: organizationIds } } });
  await db.entidadFiscalCfdi.deleteMany({ where: { organization_id: { in: organizationIds } } });
  await db.plantillaDocumentalVersion.deleteMany({ where: { tipo_acto: { organization_id: { in: organizationIds } } } });
  await db.tipoActo.deleteMany({ where: { organization_id: { in: organizationIds } } });
  await db.documento.deleteMany({ where: {
    organization_id: { in: organizationIds }, storage_key: { startsWith: 'organizations/' },
  } });
  await db.comparecienteContacto.deleteMany({ where: { organization_id: { in: organizationIds } } });
  await db.personaFisica.deleteMany({ where: { organization_id: { in: organizationIds } } });
  await db.compareciente.deleteMany({ where: { organization_id: { in: organizationIds } } });
  await db.documento.deleteMany({ where: {
    organization_id: { in: organizationIds }, storage_key: { startsWith: 'legacy/control-plane-qa/' },
  } });
  // Usage events can now point to a same-tenant migration job. Remove them
  // before deleting jobs, including when recovering from a previous test run.
  await db.aiWalletTransaction.deleteMany({ where: { organization_id: { in: organizationIds } } });
  await db.aiBalanceReservation.deleteMany({ where: { organization_id: { in: organizationIds } } });
  await db.aiUsageEvent.deleteMany({ where: { organization_id: { in: organizationIds } } });
  const qaAiSkus = await db.commercialSkuVersion.findMany({ where: {
    sku: { startsWith: 'AI_USAGE:QA_SUMMARY_' },
  }, select: { id: true } });
  await db.pricingOverride.deleteMany({ where: { sku_version_id: { in: qaAiSkus.map((sku) => sku.id) } } });
  await db.resourceCostVersion.deleteMany({ where: {
    resource_code: { in: organizationIds.map((id) => `AI_MODEL:qa-${id}`) }, provider_code: 'OPENAI',
  } });
  await db.$transaction([
    db.restoreDrill.deleteMany({ where: { backup_run_id: { in: (await db.backupRun.findMany({
      where: { organization_id: { in: organizationIds } }, select: { id: true },
    })).map((backup) => backup.id) } } }),
    db.backupRun.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.platformAccessGrant.deleteMany({ where: { platform_administrator_id: { in: platformAdministratorIds } } }),
    db.platformAuditEvent.deleteMany({ where: { platform_actor_id: { in: platformAdministratorIds } } }),
    db.platformAdministrator.deleteMany({ where: { id: { in: platformAdministratorIds } } }),
    db.usageEvent.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.exportArtifact.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.exportJob.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.migrationMapping.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.migrationConflict.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.migrationProvenance.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.migrationAsset.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.resumableUploadPart.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.resumableUploadSession.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.migrationJob.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.billingEvent.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.billingCycle.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.backgroundJob.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.tenantStorageAddon.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.storageLedgerEvent.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.storageReservation.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.storageBlobReference.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.storageBlobLocation.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.storageBlob.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.aiWallet.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.usageAlertState.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.tenantStorageUsage.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.tenantEntitlement.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.tenantPlacement.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.organizationMembership.deleteMany({ where: { organization_id: { in: organizationIds } } }),
    db.organization.deleteMany({ where: { id: { in: organizationIds } } }),
    db.user.deleteMany({ where: { id: { in: userIds } } }),
    db.aiRoutingPolicyVersion.deleteMany({ where: { operation_code: { startsWith: 'QA_SUMMARY_' } } }),
    db.aiOperationCatalog.deleteMany({ where: { operation_code: { startsWith: 'QA_SUMMARY_' } } }),
    db.aiModelRegistry.deleteMany({ where: { provider_code: 'QA_PROVIDER', model_code: { startsWith: 'qa-' } } }),
    db.commercialSkuVersion.deleteMany({ where: { sku: { startsWith: 'AI_USAGE:QA_SUMMARY_' } } }),
    db.storageAddonVersion.deleteMany({ where: { sku: { startsWith: 'QA_STORAGE_' } } }),
  ]);
};

beforeAll(async () => {
  await cleanup();
  const shard = await db.platformShard.findUniqueOrThrow({ where: { code: 'primary-shared' } });
  await db.organization.create({ data: { id: organizationId, name: 'Control Plane QA synthetic tenant' } });
  await db.organization.create({ data: { id: secondOrganizationId, name: 'Control Plane QA second tenant' } });
  // The restricted role is provisioned by the isolated PostgreSQL harness.
  // The application role deliberately has no CREATEROLE capability.
  await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA pravia_os TO ${rlsRole}`);
  await db.$executeRawUnsafe(`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA pravia_os TO ${rlsRole}`);
  await db.user.create({ data: {
    id: userId, email: `control-plane-${userId}@example.test`, password_hash: 'synthetic-only',
    nombre: 'Control', apellido: 'Plane QA', rol: 'DIRECCION', requires_password_change: false,
  } });
  await db.organizationMembership.create({ data: { organization_id: organizationId, user_id: userId, rol: 'DIRECCION' } });
  await db.user.create({ data: {
    id: secondUserId, email: `control-plane-second-${secondUserId}@pravia.test`, password_hash: 'not-a-login-credential',
    nombre: 'Control', apellido: 'Plane QA B', rol: 'DIRECCION', requires_password_change: false,
  } });
  await db.organizationMembership.create({ data: { organization_id: secondOrganizationId, user_id: secondUserId, rol: 'DIRECCION' } });
  await db.platformAdministrator.create({ data: {
    user_id: userId,
    permissions: ['platform.dashboard.read', 'platform.tenants.read', 'platform.tenant_access.grant', 'platform.ai.internal'],
  } });
  await db.tenantPlacement.create({ data: {
    organization_id: organizationId, shard_id: shard.id, deployment_type: 'SHARED',
    region: 'configured-primary', placement_version: 1,
  } });
  await db.tenantEntitlement.create({ data: {
    organization_id: organizationId, included_storage_bytes: 100n, addon_storage_bytes: 0n,
    total_storage_capacity_bytes: 100n,
  } });
  await db.tenantEntitlement.create({ data: {
    organization_id: secondOrganizationId, included_storage_bytes: 100n, addon_storage_bytes: 0n,
    total_storage_capacity_bytes: 100n,
  } });
  await db.tenantStorageUsage.create({ data: { organization_id: organizationId } });
  await db.tenantStorageUsage.create({ data: { organization_id: secondOrganizationId, production_bytes: 17n } });
  await db.aiWallet.create({ data: { organization_id: organizationId, balance_minor: 100n } });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe.runIf(process.env.CONTROL_PLANE_QA === '1').sequential('SaaS control plane accounting · physical PostgreSQL', () => {
  it('routes the Organization through the central single-shard placement', async () => {
    const placement = await router.forTenant(organizationId);
    expect(placement).toMatchObject({ organizationId, shardCode: 'primary-shared', deploymentType: 'SHARED', placementVersion: 1 });
  });

  it('TENANT/RLS exposes only the transaction tenant and rejects cross-tenant writes for a restricted role', async () => {
    const visible = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${rlsRole}`);
      await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${organizationId}, true)`;
      return tx.$queryRaw<Array<{ organization_id: string }>>`
        SELECT organization_id::text
        FROM pravia_os.tenant_storage_usage
        ORDER BY organization_id
      `;
    });
    expect(visible).toEqual([{ organization_id: organizationId }]);

    await expect(db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${rlsRole}`);
      await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${organizationId}, true)`;
      await tx.$executeRaw`
        INSERT INTO pravia_os.usage_alert_states (id, organization_id, resource_type, threshold, crossed_at)
        VALUES (${randomUUID()}::uuid, ${secondOrganizationId}::uuid, 'STORAGE', 90, NOW())
      `;
    })).rejects.toThrow();

    expect(await db.usageAlertState.count({ where: { organization_id: secondOrganizationId } })).toBe(0);
  });

  it('ST04/ST05/ST14 serializes concurrent storage reservations and never exceeds quota', async () => {
    const settled = await Promise.allSettled([
      storage.reserveStorageCapacity({ organizationId, bytes: 60n, idempotencyKey: 'parallel:a' }),
      storage.reserveStorageCapacity({ organizationId, bytes: 60n, idempotencyKey: 'parallel:b' }),
    ]);
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejection = settled.find((item) => item.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason.code).toBe('STORAGE_QUOTA_EXCEEDED');
    expect(rejection.reason).toBeInstanceOf(PlatformDomainError);
    const active = await db.storageReservation.findFirstOrThrow({ where: { organization_id: organizationId, status: 'RESERVED' } });
    await storage.abortStorageUpload({ organizationId, reservationId: active.id });
    const usage = await db.tenantStorageUsage.findUniqueOrThrow({ where: { organization_id: organizationId } });
    expect(usage.reserved_bytes).toBe(0n);
  });

  it('ST15/ST16/ST17 commits once, preserves ledger idempotency and excludes temporary bytes from quota', async () => {
    const first = await storage.reserveStorageCapacity({ organizationId, bytes: 40n, idempotencyKey: 'commit:once' });
    const repeated = await storage.reserveStorageCapacity({ organizationId, bytes: 40n, idempotencyKey: 'commit:once' });
    expect(first.id).toBe(repeated.id);
    await storage.commitStorageUpload({ organizationId, reservationId: first.id });
    await storage.commitStorageUpload({ organizationId, reservationId: first.id });
    const temporary = await storage.reserveStorageCapacity({ organizationId, bytes: 500n, idempotencyKey: 'temporary:large', storageClass: 'TEMPORARY' });
    await storage.commitStorageUpload({ organizationId, reservationId: temporary.id });
    const usage = await db.tenantStorageUsage.findUniqueOrThrow({ where: { organization_id: organizationId } });
    expect(usage.production_bytes).toBe(40n);
    expect(usage.temporary_bytes).toBe(500n);
    expect(usage.reserved_bytes).toBe(0n);
    expect(await db.storageLedgerEvent.count({ where: { organization_id: organizationId, event_type: 'UPLOAD_COMMITTED' } })).toBe(1);
  });

  it('ST01/ST02/ST06 stores immutable hashes, keeps tenant-local blobs and accounts physical deletion', async () => {
    const provider = new MemoryStorageProvider();
    const tracked = new TrackedStorageService(provider, db);
    const bytes = Buffer.from('tracked-storage-qa');
    const firstKey = `organizations/${organizationId}/qa/document.bin`;
    const secondKey = `organizations/${secondOrganizationId}/qa/document.bin`;

    await tracked.upload(bytes, firstKey, 'application/octet-stream');
    const beforeRetry = await db.tenantStorageUsage.findUniqueOrThrow({ where: { organization_id: organizationId } });
    await tracked.upload(bytes, firstKey, 'application/octet-stream');
    const afterRetry = await db.tenantStorageUsage.findUniqueOrThrow({ where: { organization_id: organizationId } });
    expect(afterRetry.production_bytes).toBe(beforeRetry.production_bytes);
    expect(await provider.download(firstKey)).toEqual(bytes);

    await tracked.upload(bytes, secondKey, 'application/octet-stream');
    const blobs = await db.storageBlob.findMany({
      where: { organization_id: { in: [organizationId, secondOrganizationId] } },
      select: { organization_id: true, sha256: true, size_bytes: true },
    });
    expect(blobs).toHaveLength(2);
    expect(new Set(blobs.map((blob) => blob.organization_id))).toEqual(new Set([organizationId, secondOrganizationId]));
    expect(new Set(blobs.map((blob) => blob.sha256)).size).toBe(1);

    const temporaryKey = `organizations/${organizationId}/migration-temp/part.bin`;
    await tracked.upload(Buffer.from('temporary'), temporaryKey, 'application/octet-stream', 'TEMPORARY');
    expect((await db.tenantStorageUsage.findUniqueOrThrow({ where: { organization_id: organizationId } })).temporary_bytes).toBe(509n);
    await tracked.delete(temporaryKey);
    expect((await db.tenantStorageUsage.findUniqueOrThrow({ where: { organization_id: organizationId } })).temporary_bytes).toBe(500n);

    await tracked.delete(firstKey);
    const afterDelete = await db.tenantStorageUsage.findUniqueOrThrow({ where: { organization_id: organizationId } });
    expect(afterDelete.production_bytes).toBe(beforeRetry.production_bytes - BigInt(bytes.byteLength));
    expect(await provider.exists(firstKey)).toBe(false);
  });

  it('ST-LEGACY denies untracked and live-document deletion, then accounts a retired historical key', async () => {
    const provider = new MemoryStorageProvider();
    const tracked = new TrackedStorageService(provider, db);
    const key = `legacy/control-plane-qa/${organizationId}.pdf`;
    const bytes = Buffer.from('legacy-document-qa');
    provider.objects.set(key, bytes);
    const document = await db.documento.create({ data: {
      organization_id: organizationId, nombre_original: 'historico.pdf', nombre_interno: key,
      storage_key: key, mime_type: 'application/pdf', tipo: 'HISTORICO',
      size_bytes: bytes.byteLength, subido_por_id: userId,
    } });
    await expect(tracked.delete(key)).rejects.toMatchObject({ code: 'STORAGE_LOCATION_REQUIRED' });
    expect(await provider.exists(key)).toBe(true);

    const providerRecord = await db.storageProviderRecord.findUniqueOrThrow({ where: { code: 'runtime-primary' } });
    const blob = await db.storageBlob.create({ data: {
      organization_id: organizationId, sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: BigInt(bytes.byteLength),
      mime_type: 'application/pdf', original_filename: 'historico.pdf', source: 'LEGACY_DOCUMENT_BACKFILL',
      provenance_json: { verification: 'PENDING_PROVIDER_RECONCILIATION' },
    } });
    const location = await db.storageBlobLocation.create({ data: {
      organization_id: organizationId, blob_id: blob.id, provider_id: providerRecord.id,
      object_key: key, storage_class: 'PRODUCTION', status: 'LEGACY_UNVERIFIED',
    } });
    const reference = await db.storageBlobReference.create({ data: {
      organization_id: organizationId, blob_id: blob.id, owner_type: 'DOCUMENTO', owner_id: document.id,
    } });
    const reservation = await storage.reserveStorageCapacity({
      organizationId, bytes: BigInt(bytes.byteLength), idempotencyKey: 'qa:legacy-document',
    });
    await storage.commitStorageUpload({ organizationId, reservationId: reservation.id, blobId: blob.id });
    const before = await db.tenantStorageUsage.findUniqueOrThrow({ where: { organization_id: organizationId } });
    await expect(tracked.delete(key)).rejects.toMatchObject({ code: 'STORAGE_OBJECT_REFERENCED' });
    expect(await provider.exists(key)).toBe(true);
    await db.documento.delete({ where: { id: document.id } });
    await expect(tracked.delete(key)).rejects.toMatchObject({ code: 'STORAGE_OBJECT_REFERENCED' });
    await db.storageBlobReference.delete({ where: { id: reference.id } });
    await tracked.delete(key);
    const after = await db.tenantStorageUsage.findUniqueOrThrow({ where: { organization_id: organizationId } });
    expect(after.production_bytes).toBe(before.production_bytes - BigInt(bytes.byteLength));
    expect(await provider.exists(key)).toBe(false);
    expect((await db.storageBlobLocation.findUniqueOrThrow({ where: { id: location.id } })).status).toBe('DELETED');
  });

  it('ST07/ST08/ST09 persists threshold alerts and blocks unsafe capacity downgrade', async () => {
    const alertReservation = await storage.reserveStorageCapacity({
      organizationId,
      bytes: 31n,
      idempotencyKey: 'qa:alert:seventy',
    });
    expect(await db.usageAlertState.findFirst({
      where: { organization_id: organizationId, resource_type: 'STORAGE', threshold: 70, resolved_at: null },
    })).not.toBeNull();
    await storage.abortStorageUpload({ organizationId, reservationId: alertReservation.id });
    expect(await db.usageAlertState.findFirst({
      where: { organization_id: organizationId, resource_type: 'STORAGE', threshold: 70, resolved_at: null },
    })).toBeNull();

    const version = await db.storageAddonVersion.create({ data: {
      sku: qaAddonSku,
      version: 1,
      capacity_bytes: 100n,
      monthly_price_minor: 1_000n,
      effective_from: new Date('2026-01-01T00:00:00Z'),
    } });
    const entitlements = new StorageEntitlementsService(db);
    const addon = await entitlements.activateAddon({
      organizationId,
      addonVersionId: version.id,
      quantity: 1,
      idempotencyKey: 'qa:addon:activate',
    });
    const retry = await entitlements.activateAddon({
      organizationId,
      addonVersionId: version.id,
      quantity: 1,
      idempotencyKey: 'qa:addon:activate',
    });
    expect(retry.id).toBe(addon.id);
    expect((await db.tenantEntitlement.findUniqueOrThrow({ where: { organization_id: organizationId } })).total_storage_capacity_bytes).toBe(200n);

    const highReservation = await storage.reserveStorageCapacity({
      organizationId,
      bytes: 80n,
      idempotencyKey: 'qa:addon:downgrade-block',
    });
    await expect(entitlements.scheduleCancellation({
      organizationId,
      addonId: addon.id,
      effectiveAt: new Date('2026-11-01T00:00:00Z'),
    })).rejects.toMatchObject({ code: 'STORAGE_DOWNGRADE_BLOCKED', status: 409 });
    await storage.abortStorageUpload({ organizationId, reservationId: highReservation.id });
    await expect(entitlements.scheduleCancellation({
      organizationId,
      addonId: addon.id,
      effectiveAt: new Date('2026-11-01T00:00:00Z'),
    })).resolves.toMatchObject({ cancel_at_period_end: true });
  });

  it('AI01/AI08/AI09 serializes reservations and prevents overspend', async () => {
    const settled = await Promise.allSettled([
      wallet.reserveAiBalance({ organizationId, estimatedMaxChargeMinor: 70n, idempotencyKey: 'ai:parallel:a' }),
      wallet.reserveAiBalance({ organizationId, estimatedMaxChargeMinor: 70n, idempotencyKey: 'ai:parallel:b' }),
    ]);
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejection = settled.find((item) => item.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason.code).toBe('AI_BALANCE_EXHAUSTED');
    const active = await db.aiBalanceReservation.findFirstOrThrow({ where: { organization_id: organizationId, status: 'RESERVED' } });
    await wallet.releaseAiReservation({ organizationId, reservationId: active.id });
  });

  it('AI05/AI11/AI13 settles actual charge once and releases the reservation difference', async () => {
    const reservation = await wallet.reserveAiBalance({ organizationId, estimatedMaxChargeMinor: 80n, idempotencyKey: 'ai:settlement' });
    const input = {
      organizationId, reservationId: reservation.id, userId, operationCode: 'QA_SUMMARY',
      providerCode: 'QA_PROVIDER', modelCode: 'qa-model', actualChargeMinor: 50n,
      providerCostAmount: '0.10', providerCostCurrency: 'USD', fxRate: '18.00', traceId: `qa:${reservation.id}`,
    };
    const first = await wallet.settleAiUsage(input);
    const retry = await wallet.settleAiUsage(input);
    expect(retry.id).toBe(first.id);
    const state = await wallet.getWallet(organizationId);
    expect(state.balance_minor).toBe('50');
    expect(state.reserved_minor).toBe('0');
    expect(await db.aiWalletTransaction.count({ where: { organization_id: organizationId, type: 'USAGE_DEBIT' } })).toBe(1);
  });

  it('AI06 returns the canonical exhaustion error while non-AI storage reads remain available', async () => {
    await expect(wallet.reserveAiBalance({ organizationId, estimatedMaxChargeMinor: 51n, idempotencyKey: 'ai:exhausted' }))
      .rejects.toMatchObject({ code: 'AI_BALANCE_EXHAUSTED', status: 402 });
    await expect(storage.getState(organizationId)).resolves.toMatchObject({ capacityBytes: '200', productionBytes: '40' });
  });

  it('AI14/AI18 routes through the gateway, debits configured price and exposes no provider cost in its response', async () => {
    await wallet.applyTopup({ organizationId, amountMinor: 100n, idempotencyKey: 'qa:gateway:topup', paymentRef: 'LOCAL-QA' });
    await db.aiOperationCatalog.create({ data: {
      operation_code: qaOperation, billing_class: 'CUSTOMER_WALLET', required_capability: 'ai.use', quality_tier: 'STANDARD',
      max_input: 1000, max_output: 1000, max_charge_minor: 20n, allow_fallback: false,
    } });
    await db.aiModelRegistry.create({ data: {
      provider_code: 'QA_PROVIDER', model_code: `qa-${organizationId}`,
      capabilities: ['text'], quality_tier: 'STANDARD', enabled: true,
    } });
    await db.aiRoutingPolicyVersion.create({ data: {
      operation_code: qaOperation, version: 1, effective_from: new Date('2026-01-01T00:00:00Z'),
      routing_rules_json: { candidates: [{ providerCode: 'QA_PROVIDER', modelCode: `qa-${organizationId}` }] },
    } });
    await db.commercialSkuVersion.create({ data: {
      sku: qaSku, kind: 'AI_USAGE', quantity: 1, unit: 'CALL', sale_price_minor: 10n,
      currency: 'MXN', version: 1, effective_from: new Date('2026-01-01T00:00:00Z'),
    } });
    let providerCalls = 0;
    const adapter: AiProviderAdapter = {
      providerCode: 'QA_PROVIDER',
      async execute() {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { output: { answer: 'respuesta sintética' }, inputTokens: 4, outputTokens: 3,
          providerCostAmount: '0.0001', providerCostCurrency: 'USD', fxRate: '18',
          fxSnapshot: { source: 'LOCAL_QA', rate: '18' }, latencyMs: 5 };
      },
    };
    const gateway = new AiGateway(db, [adapter]);
    const output = await gateway.execute<{ answer: string }>({
      actor: {
        userId, organizationId, membershipId: `${organizationId}:${userId}`, role: 'DIRECCION',
        permissions: ['ai.use'], scope: 'GLOBAL', sessionId: 'QA',
      },
      operationCode: qaOperation, billingClass: 'CUSTOMER_WALLET', idempotencyKey: 'qa:gateway:reservation', traceId: `qa:gateway:${organizationId}`,
      payload: { text: 'contenido sintético' },
    });
    expect(output).toEqual({ answer: 'respuesta sintética' });
    expect(output).not.toHaveProperty('providerCostAmount');
    await expect(gateway.execute({
      actor: { userId, organizationId, membershipId: `${organizationId}:${userId}`, role: 'DIRECCION',
        permissions: ['ai.use'], scope: 'GLOBAL', sessionId: 'QA' },
      operationCode: qaOperation, billingClass: 'CUSTOMER_WALLET', idempotencyKey: 'qa:gateway:reservation', traceId: `qa:gateway:${organizationId}`,
      payload: { text: 'contenido sintético' },
    })).rejects.toMatchObject({ code: 'AI_REQUEST_ALREADY_COMPLETED' });
    expect(providerCalls).toBe(1);
    const concurrentRequest = {
      actor: { userId, organizationId, membershipId: `${organizationId}:${userId}`, role: 'DIRECCION' as const,
        permissions: ['ai.use' as const], scope: 'GLOBAL' as const, sessionId: 'QA' },
      operationCode: qaOperation, billingClass: 'CUSTOMER_WALLET' as const,
      idempotencyKey: 'qa:gateway:concurrent', traceId: `qa:gateway:concurrent:${organizationId}`,
      payload: { text: 'contenido simultáneo' },
    };
    const concurrent = await Promise.allSettled([gateway.execute(concurrentRequest), gateway.execute(concurrentRequest)]);
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(['AI_REQUEST_IN_PROGRESS', 'AI_REQUEST_ALREADY_COMPLETED'])
      .toContain((concurrent.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.code);
    expect(providerCalls).toBe(2);
    const state = await wallet.getWallet(organizationId);
    expect(state.balance_minor).toBe('130');
  });

  it('AI provider failures release wallet reservations and retain an unverified-cost event', async () => {
    const before = (await wallet.getWallet(organizationId)).balance_minor;
    const gateway = new AiGateway(db, [{ providerCode: 'QA_PROVIDER', async execute() {
      throw new Error('synthetic provider timeout');
    } }]);
    await expect(gateway.execute({ actor: { userId, organizationId,
      membershipId: `${organizationId}:${userId}`, role: 'DIRECCION', permissions: ['ai.use'],
      scope: 'GLOBAL', sessionId: 'QA' },
      operationCode: qaOperation, billingClass: 'CUSTOMER_WALLET',
      idempotencyKey: 'qa:gateway:failure', traceId: `qa:gateway:failure:${organizationId}`,
      payload: {},
    })).rejects.toThrow('synthetic provider timeout');
    expect((await wallet.getWallet(organizationId)).balance_minor).toBe(before);
    expect((await db.aiBalanceReservation.findFirstOrThrow({ where: {
      organization_id: organizationId, idempotency_key: 'qa:gateway:failure',
    } })).status).toBe('RELEASED');
    expect(await db.aiUsageEvent.findFirstOrThrow({ where: {
      organization_id: organizationId, idempotency_key: 'qa:gateway:failure',
    } })).toMatchObject({ status: 'FAILED_COST_UNVERIFIED', wallet_debit_minor: 0n });
  });

  it('AI billing classes record included provider cost without wallet debit and reject unapproved plan use', async () => {
    const actor = { userId, organizationId, membershipId: `${organizationId}:${userId}`, role: 'DIRECCION' as const,
      permissions: ['ai.use' as const, 'platform.migrations.manage' as const], scope: 'GLOBAL' as const, sessionId: 'QA' };
    const modelCode = `qa-${organizationId}`;
    const includedOperations = [
      { code: `QA_SUMMARY_${organizationId}_PLATFORM`, billingClass: 'PLATFORM_INCLUDED' as const },
      { code: `QA_SUMMARY_${organizationId}_MIGRATION`, billingClass: 'MIGRATION_INCLUDED' as const },
      { code: `QA_SUMMARY_${organizationId}_PLAN`, billingClass: 'PLAN_INCLUDED' as const },
    ];
    for (const item of includedOperations) {
      await db.aiOperationCatalog.create({ data: { operation_code: item.code, billing_class: item.billingClass,
        required_capability: 'ai.use', quality_tier: 'ECONOMY', max_input: 100, max_output: 100,
      } });
      await db.aiRoutingPolicyVersion.create({ data: { operation_code: item.code, version: 1,
        effective_from: new Date('2026-01-01T00:00:00Z'),
        routing_rules_json: { candidates: [{ providerCode: 'QA_PROVIDER', modelCode }] },
      } });
    }
    const migration = await db.migrationJob.create({ data: {
      organization_id: organizationId, source_system: 'LOCAL_QA', created_by: userId,
      idempotency_key: `qa:included:${organizationId}`, status: 'MIGRATING',
      approved_by: userId, approved_at: new Date(),
    } });
    let providerCalls = 0;
    const gateway = new AiGateway(db, [{ providerCode: 'QA_PROVIDER', async execute() {
      providerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { output: { ok: true }, inputTokens: 5, outputTokens: 2,
        providerCostAmount: '0.02', providerCostCurrency: 'USD', fxRate: '18',
        fxSnapshot: { source: 'LOCAL_QA', rate: '18' }, latencyMs: 10 };
    } }]);
    const before = (await wallet.getWallet(organizationId)).balance_minor;
    await expect(gateway.execute({ actor, operationCode: includedOperations[0].code,
      billingClass: 'PLATFORM_INCLUDED', idempotencyKey: 'qa:platform:included', traceId: `qa:platform:${organizationId}`,
      payload: {},
    })).resolves.toEqual({ ok: true });
    await expect(gateway.execute({ actor, operationCode: includedOperations[1].code,
      billingClass: 'MIGRATION_INCLUDED', migrationJobId: migration.id,
      idempotencyKey: 'qa:migration:included', traceId: `qa:migration:${organizationId}`, payload: {},
    })).resolves.toEqual({ ok: true });
    await expect(gateway.execute({ actor, operationCode: includedOperations[1].code,
      billingClass: 'MIGRATION_INCLUDED', migrationJobId: randomUUID(),
      idempotencyKey: 'qa:migration:invalid', traceId: `qa:migration:invalid:${organizationId}`, payload: {},
    })).rejects.toMatchObject({ code: 'AI_MIGRATION_JOB_NOT_FOUND' });
    await expect(gateway.execute({ actor, operationCode: includedOperations[2].code,
      billingClass: 'PLAN_INCLUDED', idempotencyKey: 'qa:plan:disabled', traceId: `qa:plan:${organizationId}`, payload: {},
    })).rejects.toMatchObject({ code: 'AI_PLAN_ENTITLEMENT_NOT_CONFIGURED' });
    const included = await db.aiUsageEvent.findMany({ where: { organization_id: organizationId,
      operation_code: { in: includedOperations.slice(0, 2).map((item) => item.code) } },
      orderBy: { operation_code: 'asc' },
    });
    expect(included).toHaveLength(2);
    expect(included.map((event) => event.billing_class).sort()).toEqual(['MIGRATION_INCLUDED', 'PLATFORM_INCLUDED']);
    expect(included.every((event) => event.wallet_debit_minor === 0n && event.commercial_charge_minor === 0n
      && event.provider_cost_amount.toString() === '0.02')).toBe(true);
    expect(included.find((event) => event.billing_class === 'MIGRATION_INCLUDED')?.migration_job_id).toBe(migration.id);
    expect((await wallet.getWallet(organizationId)).balance_minor).toBe(before);
    await db.aiWallet.create({ data: { organization_id: secondOrganizationId, balance_minor: 0n } });
    const otherActor = { ...actor, userId: secondUserId, organizationId: secondOrganizationId,
      membershipId: `${secondOrganizationId}:${secondUserId}` };
    await expect(gateway.execute({ actor: otherActor, operationCode: includedOperations[0].code,
      billingClass: 'PLATFORM_INCLUDED', idempotencyKey: 'qa:other:platform-denied',
      traceId: `qa:other:platform-denied:${secondOrganizationId}`, payload: {},
    })).rejects.toMatchObject({ code: 'AI_PLATFORM_INCLUDED_DENIED' });
    await db.platformAdministrator.create({ data: { user_id: secondUserId,
      permissions: ['platform.ai.internal'] } });
    await expect(gateway.execute({ actor: otherActor, operationCode: includedOperations[0].code,
      billingClass: 'PLATFORM_INCLUDED', idempotencyKey: 'qa:other:platform',
      traceId: `qa:other:platform:${secondOrganizationId}`, payload: {},
    })).resolves.toEqual({ ok: true });
    await expect(gateway.execute({ actor: otherActor, operationCode: qaOperation,
      billingClass: 'CUSTOMER_WALLET', idempotencyKey: 'qa:other:wallet-empty',
      traceId: `qa:other:wallet-empty:${secondOrganizationId}`, payload: {},
    })).rejects.toMatchObject({ code: 'AI_BALANCE_EXHAUSTED' });
    await expect(gateway.execute({ actor: otherActor, operationCode: includedOperations[1].code,
      billingClass: 'MIGRATION_INCLUDED', migrationJobId: migration.id,
      idempotencyKey: 'qa:other:migration-cross-tenant',
      traceId: `qa:other:migration:${secondOrganizationId}`, payload: {},
    })).rejects.toMatchObject({ code: 'AI_MIGRATION_JOB_NOT_FOUND' });
    await expect(db.aiUsageEvent.create({ data: {
      organization_id: secondOrganizationId, user_id: secondUserId,
      operation_code: includedOperations[1].code, billing_class: 'MIGRATION_INCLUDED',
      migration_job_id: migration.id, provider_code: 'QA_PROVIDER', model_code: modelCode,
      provider_cost_currency: 'MXN', commercial_charge_minor: 0n, wallet_debit_minor: 0n,
      status: 'COMPLETED', trace_id: `qa:forged-migration:${secondOrganizationId}`,
    } })).rejects.toThrow();
    await expect(gateway.execute({ actor, operationCode: includedOperations[0].code,
      billingClass: 'PLATFORM_INCLUDED', idempotencyKey: 'qa:platform:included', traceId: `qa:platform:${organizationId}`,
      payload: {},
    })).rejects.toMatchObject({ code: 'AI_REQUEST_ALREADY_COMPLETED' });
    expect(providerCalls).toBe(3);
  });

  it('AI pricing enforces the configured 2x floor and records provider COGS without debiting the wallet', async () => {
    const operationCode = `QA_SUMMARY_${organizationId}_MARGIN`;
    await db.aiOperationCatalog.create({ data: { operation_code: operationCode,
      billing_class: 'CUSTOMER_WALLET', required_capability: 'ai.use', quality_tier: 'ECONOMY',
      max_input: 100, max_output: 100, max_charge_minor: 2n, allow_fallback: true,
    } });
    await db.aiRoutingPolicyVersion.create({ data: { operation_code: operationCode, version: 1,
      effective_from: new Date('2026-01-01T00:00:00Z'),
      routing_rules_json: { candidates: [{ providerCode: 'QA_PROVIDER', modelCode: `qa-${organizationId}` }] },
    } });
    const sku = await db.commercialSkuVersion.create({ data: { sku: `AI_USAGE:${operationCode}`, kind: 'AI_USAGE',
      quantity: 1, unit: 'CALL', sale_price_minor: 1n, currency: 'MXN', version: 1,
      effective_from: new Date('2026-01-01T00:00:00Z'),
    } });
    let providerCalls = 0;
    const gateway = new AiGateway(db, [{ providerCode: 'QA_PROVIDER', async execute() {
      providerCalls += 1;
      return { output: { answer: 'never delivered' }, inputTokens: 5, outputTokens: 2,
        providerCostAmount: '0.01', providerCostCurrency: 'USD', fxRate: '18',
        fxSnapshot: { source: 'LOCAL_QA', rate: '18' }, latencyMs: 4 };
    } }]);
    const before = (await wallet.getWallet(organizationId)).balance_minor;
    await expect(gateway.execute({ actor: { userId, organizationId,
      membershipId: `${organizationId}:${userId}`, role: 'DIRECCION', permissions: ['ai.use'],
      scope: 'GLOBAL', sessionId: 'QA' },
      operationCode, billingClass: 'CUSTOMER_WALLET', idempotencyKey: 'qa:margin:underfloor',
      traceId: `qa:margin:${organizationId}`, payload: {},
    })).rejects.toMatchObject({ code: 'MARGIN_FLOOR_VIOLATION' });
    expect(providerCalls).toBe(1);
    expect((await wallet.getWallet(organizationId)).balance_minor).toBe(before);
    expect((await db.aiBalanceReservation.findFirstOrThrow({ where: {
      organization_id: organizationId, idempotency_key: 'qa:margin:underfloor',
    } })).status).toBe('RELEASED');
    const usage = await db.aiUsageEvent.findFirstOrThrow({ where: { organization_id: organizationId,
      idempotency_key: 'qa:margin:underfloor' } });
    expect(usage).toMatchObject({ billing_class: 'CUSTOMER_WALLET', status: 'REJECTED',
      error_code: 'MARGIN_FLOOR_VIOLATION', commercial_charge_minor: 0n, wallet_debit_minor: 0n });
    expect(usage.provider_cost_amount.toString()).toBe('0.01');
    const approver = await db.platformAdministrator.update({ where: { user_id: userId }, data: {
      permissions: ['platform.dashboard.read', 'platform.tenants.read', 'platform.tenant_access.grant',
        'platform.ai.internal', 'platform.pricing.override'],
    } });
    const override = await db.pricingOverride.create({ data: {
      sku_version_id: sku.id, organization_id: organizationId,
      old_price_minor: 1n, new_price_minor: 1n, calculated_cost_minor: 18n,
      reason: 'Local QA: explicit under-floor exception',
      approval_metadata: { case: 'synthetic-only' }, approved_by_platform_id: approver.id,
    } });
    await db.platformAuditEvent.create({ data: {
      platform_actor_id: approver.id, organization_id: organizationId,
      action: 'AI_MARGIN_OVERRIDE_APPROVED', target_type: 'PricingOverride', target_id: override.id,
      reason: 'Local QA: explicit under-floor exception', trace_id: `qa:margin:approval:${organizationId}`,
    } });
    await expect(gateway.execute({ actor: { userId, organizationId,
      membershipId: `${organizationId}:${userId}`, role: 'DIRECCION', permissions: ['ai.use'],
      scope: 'GLOBAL', sessionId: 'QA' },
      operationCode, billingClass: 'CUSTOMER_WALLET', idempotencyKey: 'qa:margin:audited-override',
      traceId: `qa:margin:approved:${organizationId}`, payload: {},
    })).resolves.toEqual({ answer: 'never delivered' });
    expect(providerCalls).toBe(2);
    expect((await wallet.getWallet(organizationId)).balance_minor).toBe(String(BigInt(before) - 1n));
  });

  it('AI dynamic commercial charge uses a versioned markup and actual provider cost, not a hardcoded tariff', async () => {
    const operationCode = `QA_SUMMARY_${organizationId}_DYNAMIC`;
    await db.aiOperationCatalog.create({ data: { operation_code: operationCode,
      billing_class: 'CUSTOMER_WALLET', required_capability: 'ai.use', quality_tier: 'STANDARD',
      max_input: 100, max_output: 100, max_charge_minor: 100n,
    } });
    await db.aiRoutingPolicyVersion.create({ data: { operation_code: operationCode, version: 1,
      effective_from: new Date('2026-01-01T00:00:00Z'),
      routing_rules_json: { candidates: [{ providerCode: 'QA_PROVIDER', modelCode: `qa-${organizationId}` }] },
    } });
    await db.commercialSkuVersion.create({ data: { sku: `AI_USAGE:${operationCode}`, kind: 'AI_USAGE',
      quantity: 1, unit: 'CALL', sale_price_minor: null, min_markup_multiplier: '2.5',
      currency: 'MXN', version: 1, effective_from: new Date('2026-01-01T00:00:00Z'),
    } });
    await wallet.applyTopup({ organizationId: secondOrganizationId, amountMinor: 1_000n,
      idempotencyKey: 'qa:dynamic:synthetic-topup', paymentRef: 'LOCAL_QA' });
    const gateway = new AiGateway(db, [{ providerCode: 'QA_PROVIDER', async execute() {
      return { output: { ok: true }, inputTokens: 7, outputTokens: 2,
        providerCostAmount: '0.01', providerCostCurrency: 'USD', fxRate: '18',
        fxSnapshot: { source: 'LOCAL_QA', rate: '18' }, latencyMs: 8 };
    } }]);
    await expect(gateway.execute({ actor: { userId: secondUserId, organizationId: secondOrganizationId,
      membershipId: `${secondOrganizationId}:${secondUserId}`, role: 'DIRECCION',
      permissions: ['ai.use'], scope: 'GLOBAL', sessionId: 'QA' },
      operationCode, billingClass: 'CUSTOMER_WALLET', idempotencyKey: 'qa:dynamic:usage',
      traceId: `qa:dynamic:${secondOrganizationId}`, payload: {},
    })).resolves.toEqual({ ok: true });
    const usage = await db.aiUsageEvent.findFirstOrThrow({ where: { organization_id: secondOrganizationId,
      idempotency_key: 'qa:dynamic:usage' } });
    expect(usage.commercial_charge_minor).toBe(45n);
    expect(usage.wallet_debit_minor).toBe(45n);
    expect((await wallet.getWallet(secondOrganizationId)).balance_minor).toBe('955');
    expect((await wallet.getWallet(secondOrganizationId)).reserved_minor).toBe('0');
  });

  it('OpenAI gateway adapter requires versioned model rates and FX before any provider call', async () => {
    let calls = 0;
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      const sent = JSON.parse(String(init?.body)) as { model: string; store: boolean };
      expect(sent.model).toBe(`qa-${organizationId}`);
      expect(sent.store).toBe(false);
      return new Response(JSON.stringify({ id: 'qa-response', usage: {
        input_tokens: 1_000, output_tokens: 500, input_tokens_details: { cached_tokens: 200 },
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const adapter = new OpenAiResponsesGatewayAdapter(db, fetcher, 'synthetic-qa-key');
    await expect(adapter.execute({ modelCode: `qa-missing-${organizationId}`, payload: { body: { input: [] } },
      timeoutMs: 2_000, traceId: 'qa:missing-rate',
    })).rejects.toMatchObject({ code: 'AI_PROVIDER_RATE_NOT_CONFIGURED' });
    expect(calls).toBe(0);
    await db.resourceCostVersion.create({ data: {
      resource_code: `AI_MODEL:qa-${organizationId}`, provider_code: 'OPENAI',
      unit: 'MILLION_TOKENS', cost_amount: '1', currency: 'USD',
      effective_from: new Date('2026-01-01T00:00:00Z'), version: 1,
      metadata: { output_per_million: '4', cached_input_per_million: '0.2', fx_rate: '18',
        fx_source: 'LOCAL_QA', fx_as_of: '2026-10-17T00:00:00Z' },
    } });
    const result = await adapter.execute<Record<string, unknown>>({ modelCode: `qa-${organizationId}`,
      payload: { body: { model: 'ignored-domain-model', input: [] } }, timeoutMs: 2_000, traceId: 'qa:priced-rate',
    });
    expect(calls).toBe(1);
    expect(result.providerCostAmount).toBe('0.00284000');
    expect(result.fxRate).toBe('18');
    expect(result.inputTokens).toBe(1_000);
    expect(result.outputTokens).toBe(500);
  });

  it('BILLING verifies signatures, credits a paid top-up once, rejects conflicting replay and applies a same-provider refund', async () => {
    const topup = {
      eventId: `qa-topup-${organizationId}`,
      type: 'AI_TOPUP_PAID',
      organizationId,
      reference: 'qa-payment:topup',
      amountMinor: '60',
      currency: 'MXN',
      occurredAt: '2026-10-16T10:00:00.000Z',
    };
    const payload = Buffer.from(JSON.stringify(topup));
    await expect(billing.receiveVerifiedWebhook(billingProvider, payload, '')).rejects.toMatchObject({
      code: 'BILLING_SIGNATURE_REQUIRED', status: 401,
    });
    const first = await billing.receiveVerifiedWebhook(billingProvider, payload, 'qa-valid-signature');
    const repeated = await billing.receiveVerifiedWebhook(billingProvider, payload, 'qa-valid-signature');
    expect(first).toMatchObject({ duplicate: false, status: 'APPLIED' });
    expect(repeated).toMatchObject({ duplicate: true, eventId: first.eventId, status: 'APPLIED' });
    expect((await wallet.getWallet(organizationId)).balance_minor).toBe('189');

    const conflict = Buffer.from(JSON.stringify({ ...topup, amountMinor: '61' }));
    await expect(billing.receiveVerifiedWebhook(billingProvider, conflict, 'qa-valid-signature'))
      .rejects.toMatchObject({ code: 'BILLING_EVENT_REPLAY_CONFLICT', status: 409 });

    const refund = Buffer.from(JSON.stringify({
      eventId: `qa-refund-${organizationId}`,
      type: 'PAYMENT_REFUNDED',
      organizationId,
      reference: 'qa-refund:topup',
      amountMinor: '60',
      currency: 'MXN',
      occurredAt: '2026-10-16T10:05:00.000Z',
      metadata: { originalEventId: topup.eventId },
    }));
    await expect(billing.receiveVerifiedWebhook(billingProvider, refund, 'qa-valid-signature'))
      .resolves.toMatchObject({ duplicate: false, status: 'APPLIED' });
    expect((await wallet.getWallet(organizationId)).balance_minor).toBe('129');
    expect(await db.aiWalletTransaction.count({
      where: { organization_id: organizationId, idempotency_key: { in: [`billing:${topup.eventId}`, `billing:qa-refund-${organizationId}`] } },
    })).toBe(2);
  });

  it('BIL01-BIL12 local adapter remains pending until explicit confirmation and verifies signed webhooks', async () => {
    const provider = new LocalBillingSandboxProvider('local-qa-billing-signature-secret-000001');
    const subscription = await provider.createSubscription({ organizationId, planVersionId: 'plan-local-v1', idempotencyKey: 'local-subscription-1' });
    expect((await provider.createSubscription({ organizationId, planVersionId: 'plan-local-v1', idempotencyKey: 'local-subscription-1' })).reference).toBe(subscription.reference);
    expect(provider.getSubscriptionState(subscription.reference)).toMatchObject({ planVersionId: 'plan-local-v1', status: 'PENDING' });
    await provider.updateSubscription({ reference: subscription.reference, planVersionId: 'plan-local-v2', idempotencyKey: 'local-subscription-update-1' });
    expect(provider.getSubscriptionState(subscription.reference)?.planVersionId).toBe('plan-local-v2');
    await provider.cancelSubscription({ reference: subscription.reference, idempotencyKey: 'local-subscription-cancel-1' });
    expect(provider.getSubscriptionState(subscription.reference)?.status).toBe('CANCELLED');
    const payment = await provider.createOneTimePayment({ organizationId, sku: 'AI_TOPUP_QA', amountMinor: 25n, idempotencyKey: 'local-payment-1' });
    const retry = await provider.createOneTimePayment({ organizationId, sku: 'AI_TOPUP_QA', amountMinor: 25n, idempotencyKey: 'local-payment-1' });
    expect(retry.reference).toBe(payment.reference);
    expect(await provider.getPaymentStatus(payment.reference)).toBe('PENDING');
    provider.confirm(payment.reference);
    expect(await provider.getPaymentStatus(payment.reference)).toBe('PAID');
    const event = Buffer.from(JSON.stringify({
      eventId: `local-topup-${organizationId}`, type: 'AI_TOPUP_PAID', organizationId,
      reference: payment.reference, amountMinor: '25', currency: 'MXN', occurredAt: '2026-10-17T10:00:00.000Z',
    }));
    await expect(provider.verifyWebhook(event, '00')).rejects.toMatchObject({ code: 'BILLING_SIGNATURE_INVALID' });
    await expect(provider.verifyWebhook(event, provider.sign(event))).resolves.toMatchObject({ eventId: `local-topup-${organizationId}`, amountMinor: 25n });
    const refund = await provider.refund({ reference: payment.reference, amountMinor: 25n, idempotencyKey: 'local-refund-1' });
    expect((await provider.refund({ reference: payment.reference, amountMinor: 25n, idempotencyKey: 'local-refund-1' })).reference).toBe(refund.reference);
    expect(await provider.getPaymentStatus(payment.reference)).toBe('REFUNDED');
    const failed = await provider.createOneTimePayment({ organizationId, sku: 'STORAGE_ADDON_QA', amountMinor: 30n, idempotencyKey: 'local-payment-failed' });
    provider.fail(failed.reference);
    expect(await provider.getPaymentStatus(failed.reference)).toBe('FAILED');
    const disputed = await provider.createOneTimePayment({ organizationId, sku: 'STORAGE_ADDON_QA_2', amountMinor: 40n, idempotencyKey: 'local-payment-chargeback' });
    provider.confirm(disputed.reference);
    provider.chargeback(disputed.reference);
    expect(await provider.getPaymentStatus(disputed.reference)).toBe('CHARGEBACK');
    expect(payment).not.toHaveProperty('amountMinor');
  });

  it('MG01/MG11/MG14/MG25 resumes a CSV upload, verifies checksums and produces a real mapping preview', async () => {
    class CsvCleanupFailureProvider extends MemoryStorageProvider {
      failTemporaryDeleteOnce = false;
      override async delete(key: string) {
        if (this.failTemporaryDeleteOnce && key.includes('/migration-temp/')) {
          this.failTemporaryDeleteOnce = false;
          throw new Error('QA_CSV_TEMP_CLEANUP_INTERRUPTED');
        }
        return super.delete(key);
      }
    }
    const provider = new CsvCleanupFailureProvider();
    const migration = new MigrationEngineService(db, provider);
    const sourceRows = Array.from({ length: 205 }, (_, index) =>
      `legacy-${index + 1},Ana ${index + 1},ana${index + 1}@example.test,555${String(index + 1).padStart(4, '0')},valor heredado`);
    const source = Buffer.from(`id,nombre,correo,telefono,campo_desconocido\n${sourceRows.join('\n')}\n`, 'utf8');
    const checksum = createHash('sha256').update(source).digest('hex');
    const job = await migration.createJob({
      organizationId, userId, sourceSystem: 'QA CSV', declaredBytes: BigInt(source.byteLength), idempotencyKey: 'qa:migration:csv',
    }) as any;
    const retry = await migration.createJob({
      organizationId, userId, sourceSystem: 'QA CSV', declaredBytes: BigInt(source.byteLength), idempotencyKey: 'qa:migration:csv',
    }) as any;
    expect(retry.id).toBe(job.id);
    await expect(migration.createJob({
      organizationId, userId, sourceSystem: 'OTRO ORIGEN', declaredBytes: BigInt(source.byteLength), idempotencyKey: 'qa:migration:csv',
    })).rejects.toMatchObject({ code: 'MIGRATION_IDEMPOTENCY_CONFLICT' });
    const session = await migration.createUploadSession({
      organizationId, migrationJobId: job.id, filename: 'personas.csv', declaredBytes: BigInt(source.byteLength),
      partSizeBytes: 256 * 1024, idempotencyKey: 'qa:migration:csv:upload',
    }) as any;
    await expect(migration.createUploadSession({
      organizationId, migrationJobId: job.id, filename: 'otro.csv', declaredBytes: BigInt(source.byteLength),
      partSizeBytes: 256 * 1024, idempotencyKey: 'qa:migration:csv:upload',
    })).rejects.toMatchObject({ code: 'MIGRATION_IDEMPOTENCY_CONFLICT' });
    await expect(migration.createUploadSession({
      organizationId, migrationJobId: job.id, filename: '../personas.csv', declaredBytes: BigInt(source.byteLength),
      partSizeBytes: 256 * 1024, idempotencyKey: 'qa:migration:bad-filename',
    })).rejects.toMatchObject({ code: 'MIGRATION_FILENAME_INVALID' });
    await expect(migration.createUploadSession({
      organizationId, migrationJobId: job.id, filename: 'personas.csv', declaredBytes: BigInt(source.byteLength),
      partSizeBytes: Number.NaN, idempotencyKey: 'qa:migration:bad-part-size',
    })).rejects.toMatchObject({ code: 'MIGRATION_PART_SIZE_INVALID' });
    await expect(migration.uploadPart({ organizationId, migrationJobId: randomUUID(), uploadSessionId: session.id, partNumber: 1, buffer: source, checksumSha256: checksum }))
      .rejects.toMatchObject({ code: 'MIGRATION_UPLOAD_SESSION_NOT_FOUND' });
    await migration.pauseUpload(organizationId, job.id, session.id);
    await expect(migration.uploadPart({ organizationId, migrationJobId: job.id, uploadSessionId: session.id, partNumber: 1, buffer: source, checksumSha256: checksum }))
      .rejects.toMatchObject({ code: 'MIGRATION_UPLOAD_SESSION_CLOSED' });
    await migration.resumeUpload(organizationId, job.id, session.id);
    const firstPart = await migration.uploadPart({ organizationId, migrationJobId: job.id, uploadSessionId: session.id, partNumber: 1, buffer: source, checksumSha256: checksum }) as any;
    const repeatedPart = await migration.uploadPart({ organizationId, migrationJobId: job.id, uploadSessionId: session.id, partNumber: 1, buffer: source, checksumSha256: checksum }) as any;
    expect(repeatedPart.id).toBe(firstPart.id);
    await migration.completeUpload({ organizationId, migrationJobId: job.id, uploadSessionId: session.id, checksumSha256: checksum });
    const analyzed = await migration.analyze({ organizationId, migrationJobId: job.id, uploadSessionId: session.id }) as any;
    expect(analyzed).toMatchObject({ status: 'MAPPING_REQUIRED', detected_files: 1, detected_records: 205, corrupt_files: 0, dangerous_files: 0 });
    const preview = await migration.preview(organizationId, job.id) as any;
    expect(preview.approvalAllowed).toBe(false);
    expect(preview.capacity).toMatchObject({ sufficient: false, requiredBytes: String(source.byteLength) });
    expect(preview.mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_field: 'correo', target_field: 'email', status: 'MAPPED' }),
      expect.objectContaining({ source_field: 'nombre', target_field: 'nombre', status: 'MAPPED' }),
      expect.objectContaining({ source_field: 'campo_desconocido', target_field: null, status: 'NEEDS_REVIEW' }),
    ]));
    expect(preview.job.verification_json).toMatchObject({
      securityValidation: 'STRUCTURAL_AND_LOCAL_SIGNATURES', maliciousFileCheck: 'PASS',
      signatureScanner: 'PRAVIA_LOCAL_SIGNATURES_V1', checksumVerified: true,
      entityClassification: 'HUMAN_MAPPING_REQUIRED', executionAvailable: false,
    });
    const addonsBeforeCapacityBlock = await db.tenantStorageAddon.count({ where: { organization_id: organizationId } });
    const uploadedPartBeforeCapacityBlock = await db.resumableUploadPart.findUniqueOrThrow({
      where: { upload_session_id_part_number: { upload_session_id: session.id, part_number: 1 } },
    });
    const mapped = await migration.submitMapping({
      organizationId, migrationJobId: job.id, userId, entityType: 'COMPARECIENTE', fields: [
        { sourceField: 'id', targetField: 'source_id' }, { sourceField: 'nombre', targetField: 'nombre' },
        { sourceField: 'correo', targetField: 'email' }, { sourceField: 'telefono', targetField: 'telefono' },
        { sourceField: 'campo_desconocido', targetField: null },
      ],
    }) as any;
    expect(mapped.approvalAllowed).toBe(false);
    await expect(migration.approve({ organizationId, migrationJobId: job.id, userId }))
      .rejects.toMatchObject({ code: 'MIGRATION_APPROVAL_BLOCKED' });
    expect(await db.tenantStorageAddon.count({ where: { organization_id: organizationId } })).toBe(addonsBeforeCapacityBlock);
    expect(await db.resumableUploadPart.findUniqueOrThrow({
      where: { upload_session_id_part_number: { upload_session_id: session.id, part_number: 1 } },
    })).toMatchObject({ id: uploadedPartBeforeCapacityBlock.id, checksum_sha256: checksum });
    expect(uploadedPartBeforeCapacityBlock.provider_etag).toBeTruthy();
    expect(await provider.download(uploadedPartBeforeCapacityBlock.provider_etag!)).toEqual(source);
    await db.tenantEntitlement.update({ where: { organization_id: organizationId }, data: {
      included_storage_bytes: 2_000_000n, addon_storage_bytes: 0n, total_storage_capacity_bytes: 2_000_000n,
    } });
    expect(await migration.preview(organizationId, job.id)).toMatchObject({ capacity: { sufficient: true }, approvalAllowed: true });
    await migration.approve({ organizationId, migrationJobId: job.id, userId });
    await expect(migration.queueExecution({ organizationId, migrationJobId: job.id, backupRunId: randomUUID() }))
      .rejects.toMatchObject({ code: 'MIGRATION_BACKUP_GATE' });
    await expect(migration.preview(secondOrganizationId, job.id)).rejects.toThrow();
    const backups = new BackupOrchestrator(db);
    const backupProvider = new FakeIndependentBackupProvider(checksum, BigInt(source.byteLength));
    const unrelatedBackup = await backups.run({ organizationId, scope: 'TENANT_FULL', provider: backupProvider }) as any;
    await backups.restoreDrill({ backupRunId: unrelatedBackup.id, provider: backupProvider });
    await expect(migration.queueExecution({ organizationId, migrationJobId: job.id, backupRunId: unrelatedBackup.id }))
      .rejects.toMatchObject({ code: 'MIGRATION_BACKUP_GATE' });
    const failedRestoreBackup = await backups.run({ organizationId, scope: `MIGRATION_SOURCE:${job.id}`, provider: backupProvider }) as any;
    await backups.restoreDrill({ backupRunId: failedRestoreBackup.id, provider: backupProvider });
    await db.restoreDrill.create({ data: {
      backup_run_id: failedRestoreBackup.id, tested_at: new Date(Date.now() + 1_000), result: 'FAIL',
      sample_count: 0, report_ref: 'local://restore/latest-failure.json', details: { isolated: true },
    } });
    await expect(migration.queueExecution({ organizationId, migrationJobId: job.id, backupRunId: failedRestoreBackup.id }))
      .rejects.toMatchObject({ code: 'MIGRATION_BACKUP_GATE' });
    const wrongSourceProvider = new FakeIndependentBackupProvider('b'.repeat(64), BigInt(source.byteLength));
    const wrongSourceBackup = await backups.run({ organizationId, scope: `MIGRATION_SOURCE:${job.id}`, provider: wrongSourceProvider }) as any;
    await backups.restoreDrill({ backupRunId: wrongSourceBackup.id, provider: wrongSourceProvider });
    await expect(migration.queueExecution({ organizationId, migrationJobId: job.id, backupRunId: wrongSourceBackup.id }))
      .rejects.toMatchObject({ code: 'MIGRATION_BACKUP_SOURCE_MISMATCH' });
    const backup = await backups.run({ organizationId, scope: `MIGRATION_SOURCE:${job.id}`, provider: backupProvider }) as any;
    await backups.restoreDrill({ backupRunId: backup.id, provider: backupProvider });
    const queued = await migration.queueExecution({ organizationId, migrationJobId: job.id, backupRunId: backup.id }) as any;
    const repeatedQueue = await migration.queueExecution({ organizationId, migrationJobId: job.id, backupRunId: backup.id }) as any;
    expect(queued).toMatchObject({ job_type: 'MIGRATION_EXECUTE', status: 'PENDING' });
    expect(repeatedQueue.id).toBe(queued.id);
    expect(queued.payload_ref).toMatchObject({ migrationJobId: job.id, backupRunId: backup.id });
    await db.backgroundJob.delete({ where: { id: queued.id } });
    provider.failTemporaryDeleteOnce = true;
    await expect(migration.execute({ organizationId, migrationJobId: job.id, backupRunId: backup.id }))
      .rejects.toThrow('QA_CSV_TEMP_CLEANUP_INTERRUPTED');
    expect(await db.migrationJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'FAILED', verification_json: expect.objectContaining({ cleanupPending: true,
        errorCode: 'MIGRATION_TEMP_CLEANUP_FAILED' }),
    });
    const completed = await migration.execute({ organizationId, migrationJobId: job.id, backupRunId: backup.id }) as any;
    expect(completed).toMatchObject({ status: 'COMPLETED', temporary_bytes: '0' });
    expect(await migration.analyze({ organizationId, migrationJobId: job.id, uploadSessionId: session.id }))
      .toMatchObject({ status: 'COMPLETED' });
    expect(completed.verification_json).toMatchObject({ importedRecords: 205, provenanceRecords: 205,
      backupConfirmed: true, cleanupPending: false });
    expect(await db.migrationProvenance.count({ where: { organization_id: organizationId, migration_job_id: job.id } })).toBe(205);
    expect(await db.migrationProvenance.findFirstOrThrow({ where: {
      organization_id: organizationId, migration_job_id: job.id, source_record_id: 'legacy-1',
    } })).toMatchObject({ source_file: 'personas.csv', source_row: 1, target_type: 'COMPARECIENTE' });
    const migrationManifestKey = [...provider.objects.keys()].find((key) => key.includes(`/migrations/${job.id}/manifest-`));
    expect(migrationManifestKey).toBeTruthy();
    const migrationManifest = JSON.parse((await provider.download(migrationManifestKey!)).toString('utf8'));
    expect(migrationManifest).toMatchObject({
      migrationJobId: job.id, organizationId, detectedRecords: 205, importedRecords: 205,
      idempotentSkips: 0, relationshipsExpected: 0, relationshipsCreated: 0,
      orphanBlobs: 0, orphanReferences: 0, byteDiscrepancy: 0, criticalErrors: 0,
    });
    expect(migrationManifest.inputFiles).toEqual([expect.objectContaining({
      path: 'personas.csv', sizeBytes: String(source.byteLength), sha256: checksum, mimeType: 'text/csv',
    })]);
    expect(migrationManifest.mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'COMPARECIENTE', sourceField: 'nombre', targetField: 'nombre', status: 'APPROVED' }),
    ]));
    expect(migrationManifest.provenanceRecords).toHaveLength(205);
    expect(migrationManifest.provenanceRecords[0]).toMatchObject({ sourceFile: 'personas.csv', sourceRow: 1 });
    expect(await db.compareciente.count({ where: { organization_id: organizationId, nombre_busqueda: { startsWith: 'Ana ' } } })).toBe(205);
  });

  it('MGS01-MGS09 verifies a greater-than-50-MB source by chunks without a combined storage object', async () => {
    const provider = new MemoryStorageProvider();
    const migration = new MigrationEngineService(db, provider);
    const source = Buffer.alloc(50 * 1024 * 1024 + 1, 65);
    source.write('id\n', 0, 'utf8');
    source[source.length - 1] = 10;
    const checksum = createHash('sha256').update(source).digest('hex');
    const job = await migration.createJob({
      organizationId, userId, sourceSystem: 'QA large CSV', declaredBytes: BigInt(source.length), idempotencyKey: 'qa:migration:large-csv',
    }) as any;
    const session = await migration.createUploadSession({
      organizationId, migrationJobId: job.id, filename: 'large.csv', declaredBytes: BigInt(source.length),
      partSizeBytes: 16 * 1024 * 1024, idempotencyKey: 'qa:migration:large-csv:upload',
    }) as any;
    const parts = Math.ceil(source.length / (16 * 1024 * 1024));
    for (let index = 0; index < parts; index += 1) {
      const chunk = source.subarray(index * 16 * 1024 * 1024, (index + 1) * 16 * 1024 * 1024);
      const partChecksum = createHash('sha256').update(chunk).digest('hex');
      await migration.uploadPart({ organizationId, migrationJobId: job.id, uploadSessionId: session.id,
        partNumber: index + 1, buffer: chunk, checksumSha256: partChecksum });
    }
    const progress = await migration.uploadProgress(organizationId, job.id, session.id) as any;
    expect(progress.parts).toHaveLength(parts);
    expect(progress.session.uploaded_bytes).toBe(String(source.length));
    await migration.completeUpload({ organizationId, migrationJobId: job.id, uploadSessionId: session.id, checksumSha256: checksum });
    expect(provider.objects.has(session.object_key)).toBe(false);
    expect([...provider.objects.keys()].filter((key) => key.includes(`/parts/`))).toHaveLength(parts);
    const restartedWorker = new MigrationEngineService(db, provider);
    const analyzed = await restartedWorker.analyze({ organizationId, migrationJobId: job.id, uploadSessionId: session.id }) as any;
    expect(analyzed).toMatchObject({ status: 'MAPPING_REQUIRED', detected_files: 1, detected_records: 1 });
    expect(await migration.completeUpload({ organizationId, migrationJobId: job.id, uploadSessionId: session.id, checksumSha256: checksum }))
      .toMatchObject({ status: 'COMPLETED' });
  }, 60_000);

  it('MGS13 inventories XLSX fields but never approves an unsupported automatic import', async () => {
    const provider = new MemoryStorageProvider();
    const migration = new MigrationEngineService(db, provider);
    const workbook = new JSZip();
    workbook.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/></sheets></workbook>');
    workbook.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
    workbook.file('xl/sharedStrings.xml', '<sst><si><t>id</t></si><si><t>nombre</t></si><si><t>legacy-xlsx-1</t></si><si><t>Ana</t></si></sst>');
    workbook.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>');
    const source = await workbook.generateAsync({ type: 'nodebuffer' });
    const checksum = createHash('sha256').update(source).digest('hex');
    const job = await migration.createJob({ organizationId, userId, sourceSystem: 'QA XLSX review',
      declaredBytes: BigInt(source.length), idempotencyKey: 'qa:migration:xlsx-review' }) as any;
    const session = await migration.createUploadSession({ organizationId, migrationJobId: job.id,
      filename: 'personas.xlsx', declaredBytes: BigInt(source.length), partSizeBytes: 256 * 1024,
      idempotencyKey: 'qa:migration:xlsx-review:upload' }) as any;
    await migration.uploadPart({ organizationId, migrationJobId: job.id, uploadSessionId: session.id,
      partNumber: 1, buffer: source, checksumSha256: checksum });
    await migration.completeUpload({ organizationId, migrationJobId: job.id, uploadSessionId: session.id,
      checksumSha256: checksum });
    await expect(migration.analyze({ organizationId, migrationJobId: job.id, uploadSessionId: session.id }))
      .resolves.toMatchObject({ status: 'MAPPING_REQUIRED', detected_records: 1 });
    const preview = await migration.submitMapping({ organizationId, migrationJobId: job.id, userId,
      entityType: 'COMPARECIENTE', fields: [
        { sourceField: 'id', targetField: 'source_id' }, { sourceField: 'nombre', targetField: 'nombre' },
      ] }) as any;
    expect(preview.job.verification_json).toMatchObject({
      mappingApproved: true, executionAvailable: false, executionRestriction: 'REQUIRES_SOURCE_FORMAT_REVIEW',
    });
    expect(preview.approvalAllowed).toBe(false);
    await expect(migration.approve({ organizationId, migrationJobId: job.id, userId }))
      .rejects.toMatchObject({ code: 'MIGRATION_APPROVAL_BLOCKED' });
  });

  it('MGS23 refuses a package that omits an archive file from its manifest', async () => {
    const provider = new MemoryStorageProvider();
    const migration = new MigrationEngineService(db, provider);
    const archive = new JSZip();
    archive.file('pravia-migration.json', JSON.stringify({
      format: 'PRAVIA_MIGRATION_PACKAGE', version: 1, records: [], documents: [], relationships: [],
    }));
    archive.file('documentos/no-declarado.pdf', Buffer.from('%PDF-1.4\nQA\n%%EOF\n'));
    const source = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const checksum = createHash('sha256').update(source).digest('hex');
    const job = await migration.createJob({ organizationId, userId, sourceSystem: 'QA undeclared file',
      declaredBytes: BigInt(source.byteLength), idempotencyKey: 'qa:migration:undeclared' }) as any;
    const session = await migration.createUploadSession({ organizationId, migrationJobId: job.id,
      filename: 'undeclared.zip', declaredBytes: BigInt(source.byteLength), partSizeBytes: 256 * 1024,
      idempotencyKey: 'qa:migration:undeclared:upload' }) as any;
    await migration.uploadPart({ organizationId, migrationJobId: job.id, uploadSessionId: session.id,
      partNumber: 1, buffer: source, checksumSha256: checksum });
    await migration.completeUpload({ organizationId, migrationJobId: job.id, uploadSessionId: session.id, checksumSha256: checksum });
    await expect(migration.analyze({ organizationId, migrationJobId: job.id, uploadSessionId: session.id }))
      .rejects.toMatchObject({ code: 'MIGRATION_PACKAGE_UNDECLARED_FILE' });
    expect(await db.migrationJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'FAILED' });
  });

  it('MGS19/MGS20/MGS26 promotes package documents and resumes cleanup without duplicate records', async () => {
    class CleanupFailureProvider extends MemoryStorageProvider {
      failTemporaryDeleteOnce = false;
      override async delete(key: string) {
        if (this.failTemporaryDeleteOnce && key.includes('/migration-temp/')) {
          this.failTemporaryDeleteOnce = false;
          throw new Error('QA_TEMP_CLEANUP_INTERRUPTED');
        }
        return super.delete(key);
      }
    }
    const provider = new CleanupFailureProvider();
    const migration = new MigrationEngineService(db, provider);
    const usageBefore = await db.tenantStorageUsage.findUniqueOrThrow({ where: { organization_id: organizationId } });
    const documentBytes = Buffer.from('%PDF-1.4\nPRAVIA migration evidence\n%%EOF\n', 'utf8');
    const packageManifest = {
      format: 'PRAVIA_MIGRATION_PACKAGE', version: 1,
      records: [{ sourceRecordId: 'persona-package-1', entityType: 'COMPARECIENTE', data: {
        nombre: 'Paula', apellido: 'Migración', email: 'paula.migration@example.test',
      } }],
      documents: [{ sourceRecordId: 'document-package-1', path: 'documentos/identificacion.pdf',
        name: 'identificacion.pdf', type: 'IDENTIFICACION_MIGRADA', category: 'OTROS' }],
      relationships: [{ type: 'DOCUMENT_COMPARECIENTE', documentSourceRecordId: 'document-package-1',
        targetSourceRecordId: 'persona-package-1' }],
    };
    const packageZip = new JSZip();
    packageZip.file('pravia-migration.json', JSON.stringify(packageManifest));
    packageZip.file('documentos/identificacion.pdf', documentBytes);
    const source = await packageZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const checksum = createHash('sha256').update(source).digest('hex');
    const job = await migration.createJob({
      organizationId, userId, sourceSystem: 'QA PRAVIA package', declaredBytes: BigInt(source.byteLength),
      idempotencyKey: 'qa:migration:package-v1',
    }) as any;
    const session = await migration.createUploadSession({
      organizationId, migrationJobId: job.id, filename: 'migration-package.zip', declaredBytes: BigInt(source.byteLength),
      partSizeBytes: 256 * 1024, idempotencyKey: 'qa:migration:package-v1:upload',
    }) as any;
    await migration.uploadPart({ organizationId, migrationJobId: job.id, uploadSessionId: session.id,
      partNumber: 1, buffer: source, checksumSha256: checksum });
    await migration.completeUpload({ organizationId, migrationJobId: job.id, uploadSessionId: session.id, checksumSha256: checksum });
    const analyzed = await migration.analyze({ organizationId, migrationJobId: job.id, uploadSessionId: session.id }) as any;
    expect(analyzed).toMatchObject({ status: 'MAPPING_REQUIRED', detected_records: 2, detected_files: 2 });
    expect(analyzed.verification_json).toMatchObject({
      packageFormat: 'PRAVIA_MIGRATION_PACKAGE', packageVersion: 1,
      packageRecords: 1, packageDocuments: 1, packageRelationships: 1,
    });
    const mapped = await migration.submitMapping({
      organizationId, migrationJobId: job.id, userId, entityType: 'PRAVIA_PACKAGE_V1',
      fields: [{ sourceField: 'pravia-migration.json', targetField: 'PRAVIA_PACKAGE_V1' }],
    }) as any;
    expect(mapped.approvalAllowed).toBe(true);
    await migration.approve({ organizationId, migrationJobId: job.id, userId });
    const backups = new BackupOrchestrator(db);
    const backupProvider = new FakeIndependentBackupProvider(checksum, BigInt(source.byteLength));
    const backup = await backups.run({ organizationId, scope: `MIGRATION_SOURCE:${job.id}`, provider: backupProvider }) as any;
    await backups.restoreDrill({ backupRunId: backup.id, provider: backupProvider });
    provider.failTemporaryDeleteOnce = true;
    await expect(migration.execute({ organizationId, migrationJobId: job.id, backupRunId: backup.id }))
      .rejects.toThrow('QA_TEMP_CLEANUP_INTERRUPTED');
    const interrupted = await db.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(interrupted.status).toBe('FAILED');
    expect(interrupted.verification_json).toMatchObject({ cleanupPending: true,
      errorCode: 'MIGRATION_TEMP_CLEANUP_FAILED' });
    const completed = await migration.execute({ organizationId, migrationJobId: job.id, backupRunId: backup.id }) as any;
    expect(completed).toMatchObject({ status: 'COMPLETED', temporary_bytes: '0' });
    expect(completed.verification_json).toMatchObject({ documents: 1, relationshipsCreated: 1,
      provenanceRecords: 2, cleanupPending: false });
    const repeated = await migration.execute({ organizationId, migrationJobId: job.id, backupRunId: backup.id }) as any;
    expect(repeated.id).toBe(completed.id);
    expect(await db.migrationProvenance.count({ where: { organization_id: organizationId, migration_job_id: job.id } })).toBe(2);
    const documentProvenance = await db.migrationProvenance.findUniqueOrThrow({ where: {
      organization_id_migration_job_id_source_system_source_record_id_target_type: {
        organization_id: organizationId, migration_job_id: job.id, source_system: 'QA PRAVIA package',
        source_record_id: 'document-package-1', target_type: 'DOCUMENTO',
      },
    } });
    const migratedDocument = await db.documento.findUniqueOrThrow({ where: { id: documentProvenance.target_id } });
    expect(migratedDocument).toMatchObject({
      organization_id: organizationId, nombre_original: 'identificacion.pdf', tipo: 'IDENTIFICACION_MIGRADA',
      categoria: 'OTROS', mime_type: 'application/pdf', size_bytes: documentBytes.byteLength,
      checksum_sha256: createHash('sha256').update(documentBytes).digest('hex'),
    });
    expect(migratedDocument.compareciente_id).toBeTruthy();
    expect(await db.storageBlobReference.count({ where: {
      organization_id: organizationId, owner_type: 'DOCUMENTO', owner_id: migratedDocument.id,
    } })).toBe(1);
    expect(await db.migrationAsset.findFirstOrThrow({ where: {
      organization_id: organizationId, migration_job_id: job.id, source_path: 'documentos/identificacion.pdf',
    } })).toMatchObject({ status: 'PROMOTED', scan_status: 'PASS' });
    const migrationManifestKey = [...provider.objects.keys()].find((key) => key.includes(`/migrations/${job.id}/manifest-`));
    const finalManifest = JSON.parse((await provider.download(migrationManifestKey!)).toString('utf8'));
    expect(finalManifest).toMatchObject({
      detectedRecords: 2, documents: 1, logicalReferences: 1,
      relationshipsExpected: 1, relationshipsCreated: 1, orphanBlobs: 0, orphanReferences: 0, byteDiscrepancy: '0',
    });
    expect(finalManifest.inputFiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'documentos/identificacion.pdf', status: 'PROMOTED' }),
    ]));
    expect([...provider.objects.keys()].some((key) => key.includes(`/migration-temp/${session.id}/parts/`))).toBe(false);
    const usageAfter = await db.tenantStorageUsage.findUniqueOrThrow({ where: { organization_id: organizationId } });
    expect(usageAfter.temporary_bytes).toBe(usageBefore.temporary_bytes);
    expect(usageAfter.production_bytes).toBeGreaterThan(usageBefore.production_bytes);
    await db.storageBlobReference.deleteMany({ where: {
      organization_id: organizationId, owner_type: 'DOCUMENTO', owner_id: migratedDocument.id,
    } });
    await db.documento.delete({ where: { id: migratedDocument.id } });
    await new TrackedStorageService(provider, db).delete(migratedDocument.storage_key);
    await db.comparecienteContacto.deleteMany({ where: { organization_id: organizationId, compareciente_id: migratedDocument.compareciente_id! } });
    await db.personaFisica.deleteMany({ where: { organization_id: organizationId, compareciente_id: migratedDocument.compareciente_id! } });
    await db.compareciente.delete({ where: { id: migratedDocument.compareciente_id! } });
  });

  it('EX13/EX14 removes a partial manifest and retries with a new immutable artifact key', async () => {
    let targetExportJobId: string | undefined;
    let observedRunningProgress: number | undefined;
    class FailingArchiveProvider extends MemoryStorageProvider {
      failArchiveOnce = true;
      override async uploadFile(filename: string, key: string) {
        if (this.failArchiveOnce && key.endsWith('/export.zip')) {
          this.failArchiveOnce = false;
          const running = await db.exportJob.findUniqueOrThrow({ where: { id: targetExportJobId! } });
          expect(running.status).toBe('RUNNING');
          observedRunningProgress = running.progress;
          throw new Error('QA_ARCHIVE_UPLOAD_INTERRUPTED');
        }
        return super.uploadFile(filename, key);
      }
    }
    const provider = new FailingArchiveProvider();
    const exports = new TenantExportService(db, provider);
    const job = await exports.create({ organizationId, userId, scope: ['TENANT'], format: 'ZIP_CSV',
      idempotencyKey: 'qa:export:retry-partial' }) as any;
    targetExportJobId = job.id;
    await expect(exports.process({ organizationId, exportJobId: job.id }))
      .rejects.toThrow('QA_ARCHIVE_UPLOAD_INTERRUPTED');
    expect(observedRunningProgress).toBe(90);
    expect(await db.exportJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'FAILED' });
    expect(await db.exportArtifact.count({ where: { organization_id: organizationId, export_job_id: job.id } })).toBe(0);
    expect(await db.storageBlobReference.count({ where: { organization_id: organizationId, owner_id: job.id,
      owner_type: { in: ['EXPORT_JOB', 'EXPORT_MANIFEST'] } } })).toBe(0);
    expect(await db.storageBlobLocation.count({ where: { organization_id: organizationId, status: 'AVAILABLE',
      object_key: { startsWith: `organizations/${organizationId}/exports/${job.id}/` } } })).toBe(0);
    const completed = await exports.process({ organizationId, exportJobId: job.id }) as any;
    expect(completed.status).toBe('COMPLETED');
    expect(await db.exportArtifact.count({ where: { organization_id: organizationId, export_job_id: job.id } })).toBe(2);
    expect((await exports.signedDownload({ organizationId, exportJobId: job.id })).url).toContain(`/exports/${job.id}/`);
  });

  it('EX01/EX03/EX04/EX06/EX12 creates a tenant-only CSV archive, manifest and idempotent provider-receipt egress', async () => {
    const provider = new MemoryStorageProvider();
    const exports = new TenantExportService(db, provider);
    await db.entidadFiscalCfdi.create({ data: {
      organization_id: organizationId, razon_social: 'Fiscal QA', rfc: 'AAA010101AAA',
      regimen_fiscal: '601', codigo_postal: '63000', created_by_id: userId,
      pac_secret_ref: 'secret://must-not-export', csd_key_secret_ref: 'secret://private-key',
    } });
    const templateBytes = Buffer.from('Plantilla legal original control plane QA', 'utf8');
    const templateKey = `legacy/control-plane-qa/${organizationId}/plantilla.docx`;
    await provider.upload(templateBytes, templateKey,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const templateAct = await db.tipoActo.create({ data: {
      organization_id: organizationId, nombre: 'Acto exportable QA',
    } });
    const template = await db.plantillaDocumentalVersion.create({ data: {
      tipo_acto_id: templateAct.id, requisitos_json: {}, creado_por_id: userId,
      storage_key: templateKey, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: templateBytes.byteLength, checksum_sha256: createHash('sha256').update(templateBytes).digest('hex'),
    } });
    const attachmentBytes = Buffer.from('Adjunto original IA exportable QA', 'utf8');
    const attachmentKey = `legacy/control-plane-qa/${organizationId}/assistant-attachment.txt`;
    await provider.upload(attachmentBytes, attachmentKey, 'text/plain');
    const conversation = await db.assistantConversation.create({ data: {
      organization_id: organizationId, owner_user_id: userId,
    } });
    const attachment = await db.assistantAttachment.create({ data: {
      organization_id: organizationId, conversation_id: conversation.id, uploaded_by_id: userId,
      original_name: 'adjunto-ia.txt', storage_key: attachmentKey, mime_type: 'text/plain',
      size_bytes: attachmentBytes.byteLength, sha256: createHash('sha256').update(attachmentBytes).digest('hex'),
    } });
    const documentBytes = Buffer.from('Documento original exportable PRAVIA QA', 'utf8');
    const documentKey = `legacy/control-plane-qa/${organizationId}/export-source.txt`;
    const otherTenantKey = `legacy/control-plane-qa/${secondOrganizationId}/export-source.txt`;
    await provider.upload(documentBytes, documentKey, 'text/plain');
    await provider.upload(Buffer.from('TENANT B MUST NOT LEAK', 'utf8'), otherTenantKey, 'text/plain');
    const document = await db.documento.create({ data: {
      organization_id: organizationId, nombre_original: 'evidencia.txt', nombre_interno: `control-plane-export-${organizationId}.txt`,
      tipo: 'EVIDENCIA_QA', categoria: 'OTROS', storage_key: documentKey, mime_type: 'text/plain',
      size_bytes: documentBytes.byteLength, checksum_sha256: createHash('sha256').update(documentBytes).digest('hex'), subido_por_id: userId,
    } });
    const otherTenantDocument = await db.documento.create({ data: {
      organization_id: secondOrganizationId, nombre_original: 'secreto-tenant-b.txt', nombre_interno: `control-plane-export-${secondOrganizationId}.txt`,
      tipo: 'EVIDENCIA_QA', categoria: 'OTROS', storage_key: otherTenantKey, mime_type: 'text/plain',
      size_bytes: 22, checksum_sha256: createHash('sha256').update('TENANT B MUST NOT LEAK').digest('hex'), subido_por_id: secondUserId,
    } });
    const relationshipOwner = await db.compareciente.findFirstOrThrow({ where: {
      organization_id: organizationId, nombre_busqueda: { startsWith: 'Ana ' },
    }, orderBy: { nombre_busqueda: 'asc' } });
    await db.comparecienteDocumento.create({ data: {
      organization_id: organizationId, compareciente_id: relationshipOwner.id, documento_id: document.id,
      categoria: 'IDENTIFICACION', creado_por_id: userId,
    } });
    const fullScope = ['TENANT', 'USUARIOS', 'COMPARECIENTES', 'PROSPECTOS', 'COTIZACIONES', 'EXPEDIENTES', 'ACTOS', 'PREDIOS', 'ARCHIVO', 'AGENDA', 'FINANZAS', 'DOCUMENTOS', 'RELACIONES', 'CUMPLIMIENTO', 'CONOCIMIENTO', 'CONFIGURACION'];
    const job = await exports.create({
      organizationId, userId, scope: fullScope,
      format: 'ZIP_CSV', idempotencyKey: 'qa:export:csv',
    }) as any;
    const retry = await exports.create({
      organizationId, userId, scope: [...fullScope].reverse(), format: 'ZIP_CSV', idempotencyKey: 'qa:export:csv',
    }) as any;
    expect(retry.id).toBe(job.id);
    const simultaneousCreates = await Promise.all(Array.from({ length: 3 }, () => exports.create({
      organizationId, userId, scope: ['TENANT'], format: 'ZIP_CSV', idempotencyKey: 'qa:export:concurrent',
    }) as Promise<any>));
    expect(new Set(simultaneousCreates.map((created) => created.id)).size).toBe(1);
    expect(await db.backgroundJob.count({ where: { organization_id: organizationId,
      idempotency_key: `export:${simultaneousCreates[0].id}` } })).toBe(1);
    await expect(exports.create({
      organizationId, userId, scope: ['COMPARECIENTES'], format: 'ZIP_CSV', idempotencyKey: 'qa:export:csv',
    })).rejects.toMatchObject({ code: 'EXPORT_IDEMPOTENCY_CONFLICT' });
    expect(await exports.status(organizationId, job.id)).toMatchObject({ status: 'PENDING', progress: 0 });
    expect((await exports.list(organizationId) as Array<{ id: string }>).some((item) => item.id === job.id)).toBe(true);
    expect((await exports.list(secondOrganizationId) as Array<{ id: string }>).some((item) => item.id === job.id)).toBe(false);
    const restartedExportWorker = new TenantExportService(db, provider);
    await restartedExportWorker.process({ organizationId, exportJobId: job.id });
    const completedRetry = await exports.process({ organizationId, exportJobId: job.id }) as any;
    expect(completedRetry).toMatchObject({ id: job.id, status: 'COMPLETED', progress: 100 });
    expect(await exports.status(organizationId, job.id)).toMatchObject({ status: 'COMPLETED', progress: 100 });
    const key = [...provider.objects.keys()].find((candidate) => candidate.endsWith('/export.zip'))!;
    const zip = await JSZip.loadAsync(await provider.download(key));
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('text'));
    expect(manifest).toMatchObject({ export_schema_version: 1, exportJobId: job.id, organizationId, scope: fullScope });
    for (const entry of manifest.files as Array<{ path: string; sizeBytes: number; sha256: string; rows?: number }>) {
      if (entry.path === 'manifest.json') continue;
      const archived = zip.file(entry.path);
      expect(archived, `Manifest entry ${entry.path} must exist`).not.toBeNull();
      const bytes = await archived!.async('nodebuffer');
      expect(bytes.byteLength, `Size of ${entry.path}`).toBe(entry.sizeBytes);
      expect(createHash('sha256').update(bytes).digest('hex'), `SHA of ${entry.path}`).toBe(entry.sha256);
      if (entry.path.startsWith('data/') && typeof entry.rows === 'number') {
        const csv = bytes.toString('utf8').replace(/^\uFEFF/, '').trimEnd();
        const actualRows = csv ? Math.max(0, csv.split('\n').length - 1) : 0;
        expect(actualRows, `Rows of ${entry.path}`).toBe(entry.rows);
      }
    }
    const readme = await zip.file('README.txt')!.async('nodebuffer');
    expect(manifest.files).toEqual(expect.arrayContaining([expect.objectContaining({
      path: 'README.txt', sizeBytes: readme.byteLength,
      sha256: createHash('sha256').update(readme).digest('hex'),
      mimeType: 'text/plain',
    })]));
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining([
      'data/comparecientes.csv', 'data/personas_fisicas.csv', 'data/compareciente_contactos.csv',
      'data/prospecto_transiciones.csv', 'data/cotizacion_versiones.csv',
      'data/expedientes.csv', 'data/ExpedientePresupuesto.csv', 'data/predios.csv',
      'data/archivo.csv', 'data/EntidadFiscalCfdi.csv', 'data/ComplianceReview.csv',
      'data/KnowledgeSource.csv', 'data/TimingPolicyRevision.csv', 'manifest.json',
    ]));
    const fiscalCsv = await zip.file('data/EntidadFiscalCfdi.csv')!.async('text');
    expect(fiscalCsv).toContain('Fiscal QA');
    expect(fiscalCsv).not.toContain('secret://');
    expect(fiscalCsv).not.toContain('pac_secret_ref');
    expect(manifest.entityCounts.EntidadFiscalCfdi).toBe(1);
    expect(manifest.entityCounts.plantilla_documental_versiones).toBeGreaterThanOrEqual(1);
    const templateEntry = zip.file(`templates/${template.id}/plantilla.docx`);
    expect(await templateEntry!.async('nodebuffer')).toEqual(templateBytes);
    expect(await zip.file(`assistant-attachments/${attachment.id}/adjunto-ia.txt`)!.async('nodebuffer'))
      .toEqual(attachmentBytes);
    const comparecientesCsv = await zip.file('data/comparecientes.csv')!.async('text');
    expect(comparecientesCsv.trimEnd().split('\n')).toHaveLength(206);
    expect(manifest.entityCounts.comparecientes).toBe(205);
    expect(manifest.entityCounts.personas_fisicas).toBe(await db.personaFisica.count({ where: { organization_id: organizationId } }));
    expect(manifest.entityCounts.compareciente_contactos).toBe(await db.comparecienteContacto.count({ where: { organization_id: organizationId } }));
    expect(manifest.relationshipCounts.compareciente_documentos).toBe(1);
    expect(manifest.files).toEqual(expect.arrayContaining([expect.objectContaining({
      path: 'data/comparecientes.csv', rows: 205,
      sha256: createHash('sha256').update(comparecientesCsv).digest('hex'),
      mimeType: 'text/csv',
    })]));
    expect((await zip.file('data/compareciente_documentos.csv')!.async('text')).trimEnd().split('\n')).toHaveLength(2);
    const archivedDocument = zip.file(`documents/${document.id}/evidencia.txt`);
    expect(await archivedDocument!.async('nodebuffer')).toEqual(documentBytes);
    expect(manifest.files).toEqual(expect.arrayContaining([expect.objectContaining({
      path: `documents/${document.id}/evidencia.txt`, sizeBytes: documentBytes.byteLength,
      sha256: createHash('sha256').update(documentBytes).digest('hex'), mimeType: 'text/plain',
    })]));
    const persistedJob = await db.exportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(persistedJob.manifest_blob_id).not.toBe(persistedJob.archive_blob_id);
    expect(await db.exportArtifact.count({ where: { organization_id: organizationId, export_job_id: job.id } })).toBe(2);
    const manifestLocation = await db.storageBlobLocation.findFirstOrThrow({ where: {
      organization_id: organizationId, blob_id: persistedJob.manifest_blob_id!, status: 'AVAILABLE',
    } });
    expect(JSON.parse((await provider.download(manifestLocation.object_key)).toString('utf8'))).toMatchObject({
      exportJobId: job.id, organizationId,
    });
    expect(Object.keys(zip.files).some((name) => name.includes(otherTenantDocument.id))).toBe(false);
    expect((await zip.file('data/usuarios.csv')!.async('text')).toLowerCase()).not.toContain('password');
    const download = await exports.signedDownload({ organizationId, exportJobId: job.id }) as any;
    expect(download.url).toBe(`memory://qa/${key}`);
    await expect(exports.signedDownload({ organizationId: secondOrganizationId, exportJobId: job.id })).rejects.toThrow();
    const firstEgress = await exports.recordCompletedEgress({
      organizationId, exportJobId: job.id, bytes: BigInt(download.sizeBytes), providerReceipt: 'qa-provider-receipt',
    }) as any;
    const repeatedEgress = await exports.recordCompletedEgress({
      organizationId, exportJobId: job.id, bytes: BigInt(download.sizeBytes), providerReceipt: 'qa-provider-receipt',
    }) as any;
    expect(repeatedEgress.id).toBe(firstEgress.id);
    const simultaneousEgress = await Promise.all(Array.from({ length: 3 }, () => exports.recordCompletedEgress({
      organizationId, exportJobId: job.id, bytes: BigInt(download.sizeBytes), providerReceipt: 'qa-provider-concurrent-receipt',
    }) as Promise<any>));
    expect(new Set(simultaneousEgress.map((event) => event.id)).size).toBe(1);
    expect(await db.usageEvent.count({ where: { organization_id: organizationId, resource_type: 'EGRESS_BYTES' } })).toBe(2);
    const revoked = await exports.revoke({ organizationId, exportJobId: job.id }) as any;
    expect(revoked.status).toBe('REVOKED');
    await expect(exports.signedDownload({ organizationId, exportJobId: job.id })).rejects.toMatchObject({ code: 'EXPORT_NOT_AVAILABLE' });
    await expect(exports.recordCompletedEgress({
      organizationId, exportJobId: job.id, bytes: 1n, providerReceipt: 'qa-after-revoke',
    })).rejects.toMatchObject({ code: 'EXPORT_NOT_AVAILABLE' });
    expect(provider.objects.has(key)).toBe(false);
    expect(await db.exportArtifact.count({ where: { organization_id: organizationId, export_job_id: job.id } })).toBe(0);

    const expiryJob = await exports.create({
      organizationId, userId, scope: ['TENANT'], format: 'ZIP_CSV', idempotencyKey: 'qa:export:expiry',
    }) as any;
    await exports.process({ organizationId, exportJobId: expiryJob.id });
    await db.exportJob.update({ where: { id: expiryJob.id }, data: { expires_at: new Date(Date.now() - 1_000) } });
    await expect(exports.signedDownload({ organizationId, exportJobId: expiryJob.id })).rejects.toMatchObject({ code: 'EXPORT_NOT_AVAILABLE' });
    const expired = await exports.cleanupArtifact({ organizationId, exportJobId: expiryJob.id, reason: 'EXPIRED' }) as any;
    expect(expired.status).toBe('EXPIRED');
    expect(await db.exportArtifact.count({ where: { organization_id: organizationId, export_job_id: expiryJob.id } })).toBe(0);
  });

  it('EXP19 exports a source larger than 50 MiB through file-backed storage without a bounded-buffer fallback', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pravia-large-export-'));
    const previousRoot = process.env.LOCAL_STORAGE_PATH;
    process.env.LOCAL_STORAGE_PATH = root;
    const source = path.join(root, 'source-large.bin');
    const sourceKey = `organizations/${largeExportOrganizationId}/qa/large-source.bin`;
    const sizeBytes = 51 * 1024 * 1024;
    const provider = new LocalStorageProvider();
    let documentId: string | null = null;
    try {
      await db.organization.create({ data: { id: largeExportOrganizationId, name: 'Control Plane QA large export tenant' } });
      await db.organizationMembership.create({ data: {
        organization_id: largeExportOrganizationId, user_id: userId, rol: 'DIRECCION',
      } });
      await db.tenantEntitlement.create({ data: {
        organization_id: largeExportOrganizationId, included_storage_bytes: 200n * 1024n * 1024n,
        addon_storage_bytes: 0n, total_storage_capacity_bytes: 200n * 1024n * 1024n,
      } });
      await db.tenantStorageUsage.create({ data: { organization_id: largeExportOrganizationId } });
      const handle = await import('node:fs/promises').then((fs) => fs.open(source, 'wx', 0o600));
      try {
        for (let index = 0; index < 51; index += 1) await handle.write(randomBytes(1024 * 1024));
      }
      finally { await handle.close(); }
      const sourceHash = createHash('sha256');
      for await (const chunk of createReadStream(source)) sourceHash.update(chunk as Buffer);
      const sha256 = sourceHash.digest('hex');
      await provider.uploadFile(source, sourceKey, 'application/octet-stream');
      const document = await db.documento.create({ data: {
        organization_id: largeExportOrganizationId, nombre_original: 'large-source.bin', nombre_interno: 'qa-large-source.bin',
        tipo: 'EVIDENCIA_QA', categoria: 'OTROS', storage_key: sourceKey,
        mime_type: 'application/octet-stream', size_bytes: sizeBytes,
        checksum_sha256: sha256, subido_por_id: userId,
      } });
      documentId = document.id;
      const exports = new TenantExportService(db, provider);
      const job = await exports.create({ organizationId: largeExportOrganizationId, userId, scope: ['DOCUMENTOS'], format: 'ZIP_CSV',
        idempotencyKey: 'qa:export:large-synthetic' }) as any;
      const completed = await exports.process({ organizationId: largeExportOrganizationId, exportJobId: job.id }) as any;
      expect(completed).toMatchObject({ status: 'COMPLETED', progress: 100 });
      const archive = await db.storageBlobLocation.findFirstOrThrow({ where: {
        organization_id: largeExportOrganizationId, blob_id: completed.archive_blob_id, status: 'AVAILABLE',
      } });
      expect((await provider.head(archive.object_key))?.size).toBeGreaterThan(50 * 1024 * 1024);
      const manifestLocation = await db.storageBlobLocation.findFirstOrThrow({ where: {
        organization_id: largeExportOrganizationId, blob_id: completed.manifest_blob_id, status: 'AVAILABLE',
      } });
      const manifest = JSON.parse((await provider.download(manifestLocation.object_key)).toString('utf8'));
      expect(manifest.files).toEqual(expect.arrayContaining([expect.objectContaining({
        path: `documents/${document.id}/large-source.bin`, sizeBytes, sha256,
      })]));
      expect(manifest.entityCounts.documentos).toBeGreaterThanOrEqual(1);
      await exports.revoke({ organizationId: largeExportOrganizationId, exportJobId: job.id });
    } finally {
      await db.backgroundJob.deleteMany({ where: { organization_id: largeExportOrganizationId } });
      if (documentId) await db.documento.deleteMany({ where: { id: documentId, organization_id: largeExportOrganizationId } });
      await provider.delete(sourceKey).catch(() => undefined);
      if (previousRoot === undefined) delete process.env.LOCAL_STORAGE_PATH;
      else process.env.LOCAL_STORAGE_PATH = previousRoot;
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it('SAAS admin is an explicit platform identity and tenant access is time-bound, scoped and audited', async () => {
    const admin = new PlatformAdminService(db);
    await expect(admin.authorize(randomUUID(), 'platform.dashboard.read')).rejects.toMatchObject({
      code: 'PLATFORM_ADMIN_DENIED', status: 403,
    });
    await expect(admin.dashboard(secondUserId)).rejects.toMatchObject({
      code: 'PLATFORM_ADMIN_DENIED', status: 403,
    });
    const dashboard = await admin.dashboard(userId) as any;
    expect(dashboard.organizations).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'ACTIVE' })]));
    expect(dashboard).toMatchObject({
      staleThresholdMinutes: 30,
      operations: {
        failedJobs: expect.any(Array), stuckJobs: expect.any(Array), migrationIssues: expect.any(Array),
        exportIssues: expect.any(Array), temporaryStorage: expect.any(Array), aiSpendAnomalies: expect.any(Array),
        backupIssues: expect.any(Array), billingWebhookIssues: expect.any(Array),
      },
    });
    expect(dashboard.operations.temporaryStorage).toEqual(expect.arrayContaining([
      expect.objectContaining({ organization_id: organizationId }),
    ]));
    const tenants = await admin.tenants(userId) as any[];
    expect(tenants.find((tenant) => tenant.id === organizationId)).toMatchObject({
      id: organizationId, placement: expect.objectContaining({ organization_id: organizationId }),
    });
    const grant = await admin.grantTenantAccess({
      userId, organizationId, scope: ['SUPPORT_METADATA_READ'],
      reason: 'Diagnóstico sintético aprobado para QA local.', expiresAt: new Date(Date.now() + 60_000),
      approvalMetadata: { localQa: true }, traceId: `qa:grant:${organizationId}`,
    }) as any;
    expect(await admin.validTenantGrant({ userId, organizationId, requiredScope: 'SUPPORT_METADATA_READ' })).toMatchObject({ id: grant.id });
    expect(await admin.validTenantGrant({ userId, organizationId, requiredScope: 'LEGAL_DATA_READ' })).toBeNull();
    await admin.revokeTenantAccess({
      userId, grantId: grant.id, reason: 'Cierre del diagnóstico sintético local.', traceId: `qa:revoke:${organizationId}`,
    });
    expect(await admin.validTenantGrant({ userId, organizationId, requiredScope: 'SUPPORT_METADATA_READ' })).toBeNull();
    expect(await db.platformAuditEvent.count({ where: { platform_actor_id: (await db.platformAdministrator.findUniqueOrThrow({ where: { user_id: userId } })).id } })).toBeGreaterThanOrEqual(4);
  });

  it('BACKUP requires independent infrastructure and becomes certifiable only after a passing restore drill', async () => {
    const backups = new BackupOrchestrator(db);
    const invalidProvider: IndependentBackupProvider = {
      ...new FakeIndependentBackupProvider(), independentFromPrimary: false,
      create: async () => { throw new Error('must not run'); },
      restoreAndVerify: async () => { throw new Error('must not run'); },
    };
    await expect(backups.run({ organizationId, scope: 'TENANT_FULL', provider: invalidProvider }))
      .rejects.toMatchObject({ code: 'BACKUP_PROVIDER_NOT_INDEPENDENT', status: 409 });
    const provider = new FakeIndependentBackupProvider();
    const backup = await backups.run({ organizationId, scope: 'TENANT_FULL', provider }) as any;
    expect(await backups.certificationState(backup.id)).toMatchObject({ certifiable: false });
    const drill = await backups.restoreDrill({ backupRunId: backup.id, provider }) as any;
    expect(drill).toMatchObject({ result: 'PASS', sample_count: 7, details: { isolated: true } });
    expect(await backups.certificationState(backup.id)).toMatchObject({ certifiable: true });
    expect(await backups.listCertified(organizationId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: backup.id, latestRestoreDrill: expect.objectContaining({ result: 'PASS' }) }),
    ]));
    await db.restoreDrill.create({ data: {
      backup_run_id: backup.id, tested_at: new Date(Date.now() + 1_000), result: 'FAIL',
      sample_count: 0, report_ref: 'local://restore/latest-failure.json', details: { isolated: true },
    } });
    expect((await backups.listCertified(organizationId) as any[]).some((entry) => entry.id === backup.id)).toBe(false);
  });

  it('BAK01-BAK12 copies real bytes and restores into an isolated filesystem root with identical SHA', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pravia-backup-cert-'));
    const sourceRoot = path.join(root, 'source');
    const backupRoot = path.join(root, 'backup');
    const restoreRoot = path.join(root, 'restore');
    await mkdir(sourceRoot, { recursive: true });
    const source = path.join(sourceRoot, 'tenant-export.bin');
    await writeFile(source, Buffer.from('PRAVIA isolated backup certification fixture', 'utf8'));
    try {
      const provider = new FilesystemIndependentBackupProvider({ backupRoot, restoreRoot, sourceResolver: async () => source });
      const backups = new BackupOrchestrator(db);
      const backup = await backups.run({ organizationId, scope: 'TENANT_FULL', provider }) as any;
      const drill = await backups.restoreDrill({ backupRunId: backup.id, provider }) as any;
      expect(drill).toMatchObject({ result: 'PASS', sample_count: 1, details: {
        isolated: true, expectedSha256: backup.checksum_sha256, restoredSha256: backup.checksum_sha256,
      } });
      expect(await backups.certificationState(backup.id)).toMatchObject({ certifiable: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('JOB fairness prevents one tenant from monopolizing workers and enqueue is idempotent', async () => {
    await db.backgroundJob.deleteMany({ where: { organization_id: { in: [organizationId, secondOrganizationId] } } });
    const readyAt = new Date(Date.now() - 1_000);
    // Other isolated QA workflows may leave valid pending jobs in this local
    // database. These priorities make the fairness assertions independent of
    // unrelated backlog without deleting or claiming someone else's fixture.
    const first = await jobs.enqueue({ organizationId, jobType: 'MIGRATION_ANALYZE', idempotencyKey: 'job:org1:a', payload: {}, priority: -1_000_000, scheduledAt: readyAt });
    const retry = await jobs.enqueue({ organizationId, jobType: 'MIGRATION_ANALYZE', idempotencyKey: 'job:org1:a', payload: {}, priority: -1_000_000, scheduledAt: readyAt });
    expect(retry.id).toBe(first.id);
    await expect(jobs.enqueue({ organizationId, jobType: 'EXPORT', idempotencyKey: 'job:org1:a', payload: {} }))
      .rejects.toMatchObject({ code: 'JOB_IDEMPOTENCY_CONFLICT' });
    await jobs.enqueue({ organizationId, jobType: 'EXPORT', idempotencyKey: 'job:org1:b', payload: {}, priority: -999_998, scheduledAt: readyAt });
    await jobs.enqueue({ organizationId: secondOrganizationId, jobType: 'EXPORT', idempotencyKey: 'job:org2:a', payload: {}, priority: -999_999, scheduledAt: readyAt });
    expect(await db.backgroundJob.count({ where: {
      organization_id: { in: [organizationId, secondOrganizationId] }, status: 'PENDING', idempotency_key: { startsWith: 'job:' },
    } })).toBe(3);
    const claimA = await jobs.claimNext({ workerId: 'qa-worker-a', globalConcurrency: 100, perTenantConcurrency: 1 });
    const claimB = await jobs.claimNext({ workerId: 'qa-worker-b', globalConcurrency: 100, perTenantConcurrency: 1 });
    expect(claimA?.organization_id).toBe(organizationId);
    expect(claimB?.organization_id).toBe(secondOrganizationId);
    await jobs.complete(claimA!.id, 'qa-worker-a');
    await jobs.complete(claimB!.id, 'qa-worker-b');
    const claimC = await jobs.claimNext({ workerId: 'qa-worker-c', globalConcurrency: 100, perTenantConcurrency: 1 });
    expect(claimC?.organization_id).toBe(organizationId);
    await jobs.complete(claimC!.id, 'qa-worker-c');
    const abandoned = await jobs.enqueue({ organizationId, jobType: 'MIGRATION_ANALYZE', idempotencyKey: 'job:expired-lease', payload: {}, priority: -1_000_000, maxAttempts: 3 }) as any;
    await db.backgroundJob.update({ where: { id: abandoned.id }, data: {
      status: 'RUNNING', attempts: 1, lease_owner: 'dead-worker', lease_expires_at: new Date(Date.now() - 60_000),
    } });
    const recovered = await jobs.claimNext({ workerId: 'qa-worker-recovery', globalConcurrency: 100, perTenantConcurrency: 1 });
    expect(recovered).toMatchObject({ id: abandoned.id, status: 'RUNNING', lease_owner: 'qa-worker-recovery', attempts: 2 });
    await jobs.complete(recovered!.id, 'qa-worker-recovery');

    const exhausted = await jobs.enqueue({ organizationId, jobType: 'MIGRATION_ANALYZE', idempotencyKey: 'job:expired-final', payload: {}, maxAttempts: 1 }) as any;
    await db.backgroundJob.update({ where: { id: exhausted.id }, data: {
      status: 'RUNNING', attempts: 1, lease_owner: 'dead-worker', lease_expires_at: new Date(Date.now() - 60_000),
    } });
    expect(await jobs.claimNext({ workerId: 'qa-worker-final', globalConcurrency: 100, perTenantConcurrency: 1 })).toBeNull();
    expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: exhausted.id } })).toMatchObject({ status: 'FAILED', lease_owner: null });
  });
});
