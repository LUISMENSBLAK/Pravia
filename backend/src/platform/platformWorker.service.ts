import type { PrismaClient } from '@prisma/client';
import { runWithOrganizationSystemContext, runWithPlatformOperation } from '../auth/actorContext';
import prisma from '../config/prisma';
import { BackgroundJobsService } from './backgroundJobs.service';
import { TenantExportService } from './export.service';
import { MigrationEngineService } from './migrationEngine.service';
import { PlatformDomainError } from './platform.errors';
import { StorageAccountingService } from './storageAccounting.service';

type WorkerPayload = Record<string, unknown>;

const payloadObject = (value: unknown): WorkerPayload => {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new PlatformDomainError('JOB_PAYLOAD_INVALID', 'El job no contiene un payload válido.', 422);
  }
  return value as WorkerPayload;
};

const requiredString = (payload: WorkerPayload, name: string) => {
  const value = payload[name];
  if (typeof value !== 'string' || !value) throw new PlatformDomainError('JOB_PAYLOAD_INVALID', `El job no contiene ${name}.`, 422);
  return value;
};

export class PlatformWorkerService {
  private readonly jobs: BackgroundJobsService;
  private readonly migrations: MigrationEngineService;
  private readonly exports: TenantExportService;
  private readonly storage: StorageAccountingService;

  constructor(private readonly db: PrismaClient = prisma) {
    this.jobs = new BackgroundJobsService(db);
    this.migrations = new MigrationEngineService(db);
    this.exports = new TenantExportService(db);
    this.storage = new StorageAccountingService(db);
  }

  async runOnce(input: { workerId: string; globalConcurrency: number; perTenantConcurrency: number }) {
    const leaseSeconds = 120;
    // Claiming is the only cross-tenant step. Once a job has been claimed, all
    // of its reads and writes must execute inside that job's explicit tenant
    // context so Prisma isolation remains active for the whole handler.
    const job = await runWithPlatformOperation('PLATFORM_JOB_CLAIM', () =>
      this.jobs.claimNext({ ...input, leaseSeconds }));
    if (!job) return null;
    if (!job.organization_id) {
      return runWithPlatformOperation(`PLATFORM_JOB:${job.job_type}`, () =>
        this.processClaimedJob(job, input.workerId, leaseSeconds));
    }
    return runWithOrganizationSystemContext(job.organization_id, `PLATFORM_JOB:${job.job_type}`, () =>
      this.processClaimedJob(job, input.workerId, leaseSeconds));
  }

  private async processClaimedJob(job: any, workerId: string, leaseSeconds: number) {
    let heartbeatError: unknown;
    const heartbeat = setInterval(() => {
      void this.jobs.heartbeat(job.id, workerId, Math.max(1, Number(job.progress || 0)), leaseSeconds)
        .catch((error) => { heartbeatError = error; });
    }, Math.floor(leaseSeconds * 1000 / 3));
    heartbeat.unref();
    try {
      const payload = payloadObject(job.payload_ref);
      if (job.job_type === 'MIGRATION_ANALYZE') {
        if (!job.organization_id) throw new PlatformDomainError('JOB_TENANT_REQUIRED', 'El análisis de migración exige organización.', 422);
        await this.migrations.analyze({
          organizationId: job.organization_id,
          migrationJobId: requiredString(payload, 'migrationJobId'),
          uploadSessionId: requiredString(payload, 'uploadSessionId'),
        });
      } else if (job.job_type === 'MIGRATION_EXECUTE') {
        if (!job.organization_id) throw new PlatformDomainError('JOB_TENANT_REQUIRED', 'La ejecución de migración exige organización.', 422);
        await this.migrations.execute({
          organizationId: job.organization_id,
          migrationJobId: requiredString(payload, 'migrationJobId'),
          backupRunId: requiredString(payload, 'backupRunId'),
        });
      } else if (job.job_type === 'EXPORT') {
        if (!job.organization_id) throw new PlatformDomainError('JOB_TENANT_REQUIRED', 'La exportación exige organización.', 422);
        await this.exports.process({ organizationId: job.organization_id, exportJobId: requiredString(payload, 'exportJobId') });
      } else if (job.job_type === 'EXPORT_CLEANUP') {
        if (!job.organization_id) throw new PlatformDomainError('JOB_TENANT_REQUIRED', 'La limpieza de exportación exige organización.', 422);
        await this.exports.cleanupArtifact({
          organizationId: job.organization_id,
          exportJobId: requiredString(payload, 'exportJobId'),
          reason: 'EXPIRED',
        });
      } else if (job.job_type === 'STORAGE_RECONCILE') {
        if (!job.organization_id) throw new PlatformDomainError('JOB_TENANT_REQUIRED', 'La reconciliación exige organización.', 422);
        await this.storage.reconcileStorageUsage(job.organization_id, requiredString(payload, 'providerId'));
      } else {
        throw new PlatformDomainError('JOB_HANDLER_NOT_CONFIGURED', `No existe handler activo para ${job.job_type}.`, 501);
      }
      if (heartbeatError) throw heartbeatError;
      await this.jobs.complete(job.id, workerId);
      return { id: job.id, status: 'COMPLETED' as const };
    } catch (error) {
      await this.jobs.fail(job.id, workerId, error instanceof Error ? error.message : 'Fallo de worker no identificado.');
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }
}

export const platformWorkerService = new PlatformWorkerService();
