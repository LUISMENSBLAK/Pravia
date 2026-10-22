import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { PlatformDomainError, serializeBigInts } from './platform.errors';

export type BackupArtifact = {
  bytes: bigint;
  manifestRef: string;
  restorePointRef: string;
  checksumSha256: string;
};

export interface IndependentBackupProvider {
  readonly code: string;
  readonly independentFromPrimary: boolean;
  create(input: { backupRunId: string; organizationId?: string; scope: string }): Promise<BackupArtifact>;
  restoreAndVerify(input: { backupRunId: string; restorePointRef: string; checksumSha256: string }): Promise<{
    result: 'PASS' | 'FAIL'; sampleCount: number; reportRef: string; details: Prisma.InputJsonValue;
  }>;
}

export class BackupOrchestrator {
  constructor(private readonly db: PrismaClient = prisma) {}

  async listCertified(organizationId: string) {
    const backups = await this.db.backupRun.findMany({
      where: { organization_id: organizationId, status: 'COMPLETED' },
      orderBy: { completed_at: 'desc' },
      select: {
        id: true, scope: true, provider: true, status: true, started_at: true,
        completed_at: true, bytes: true, checksum_sha256: true,
      },
    });
    if (!backups.length) return [];
    const drills = await this.db.restoreDrill.findMany({
      where: { backup_run_id: { in: backups.map((backup) => backup.id) } },
      orderBy: { tested_at: 'desc' },
      select: { backup_run_id: true, tested_at: true, result: true, sample_count: true },
    });
    const latestPassingDrill = new Map<string, typeof drills[number]>();
    for (const drill of drills) {
      if (!latestPassingDrill.has(drill.backup_run_id)) latestPassingDrill.set(drill.backup_run_id, drill);
    }
    return serializeBigInts(backups.flatMap((backup) => {
      const drill = latestPassingDrill.get(backup.id);
      return drill?.result === 'PASS' ? [{ ...backup, latestRestoreDrill: drill }] : [];
    }));
  }

  async run(input: { organizationId?: string; scope: string; provider: IndependentBackupProvider }) {
    if (!input.scope.trim()) throw new PlatformDomainError('BACKUP_SCOPE_REQUIRED', 'El backup exige un alcance explícito.', 400);
    if (!input.provider.independentFromPrimary) {
      throw new PlatformDomainError('BACKUP_PROVIDER_NOT_INDEPENDENT', 'El backup debe usar infraestructura independiente del storage primario.', 409);
    }
    if (input.organizationId) await this.db.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
    const run = await this.db.backupRun.create({ data: {
      organization_id: input.organizationId, scope: input.scope.trim(), provider: input.provider.code,
      status: 'RUNNING', started_at: new Date(),
    } });
    try {
      const artifact = await input.provider.create({ backupRunId: run.id, organizationId: input.organizationId, scope: input.scope.trim() });
      if (artifact.bytes <= 0n || !artifact.manifestRef || !artifact.restorePointRef || !/^[a-f0-9]{64}$/i.test(artifact.checksumSha256)) {
        throw new PlatformDomainError('BACKUP_ARTIFACT_INVALID', 'El proveedor no devolvió un punto de restauración verificable.', 502);
      }
      return serializeBigInts(await this.db.backupRun.update({ where: { id: run.id }, data: {
        status: 'COMPLETED', completed_at: new Date(), bytes: artifact.bytes,
        manifest_ref: artifact.manifestRef, restore_point_ref: artifact.restorePointRef,
        checksum_sha256: artifact.checksumSha256.toLowerCase(),
      } }));
    } catch (error) {
      await this.db.backupRun.update({ where: { id: run.id }, data: { status: 'FAILED', completed_at: new Date() } }).catch(() => undefined);
      throw error;
    }
  }

  async restoreDrill(input: { backupRunId: string; provider: IndependentBackupProvider }) {
    if (!input.provider.independentFromPrimary) {
      throw new PlatformDomainError('BACKUP_PROVIDER_NOT_INDEPENDENT', 'El restore drill debe ejecutarse con el backup independiente.', 409);
    }
    const backup = await this.db.backupRun.findUniqueOrThrow({ where: { id: input.backupRunId } });
    if (backup.status !== 'COMPLETED' || backup.provider !== input.provider.code || !backup.restore_point_ref || !backup.checksum_sha256) {
      throw new PlatformDomainError('BACKUP_NOT_RESTORABLE', 'El backup no tiene un punto restaurable verificable.', 409);
    }
    const verification = await input.provider.restoreAndVerify({
      backupRunId: backup.id, restorePointRef: backup.restore_point_ref, checksumSha256: backup.checksum_sha256,
    });
    if (!Number.isInteger(verification.sampleCount) || verification.sampleCount < 0 || !verification.reportRef) {
      throw new PlatformDomainError('RESTORE_DRILL_RESULT_INVALID', 'El proveedor no devolvió evidencia verificable del restore.', 502);
    }
    return serializeBigInts(await this.db.restoreDrill.create({ data: {
      backup_run_id: backup.id, tested_at: new Date(), result: verification.result,
      sample_count: verification.sampleCount, report_ref: verification.reportRef, details: verification.details,
    } }));
  }

  async certificationState(backupRunId: string) {
    const backup = await this.db.backupRun.findUniqueOrThrow({ where: { id: backupRunId } });
    const drill = await this.db.restoreDrill.findFirst({ where: { backup_run_id: backup.id }, orderBy: { tested_at: 'desc' } });
    return serializeBigInts({ backup, latestRestoreDrill: drill, certifiable: backup.status === 'COMPLETED' && drill?.result === 'PASS' });
  }
}

export const backupOrchestrator = new BackupOrchestrator();
