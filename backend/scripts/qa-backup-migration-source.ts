import 'dotenv/config';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { BackupOrchestrator } from '../src/platform/backup.service';
import { FilesystemIndependentBackupProvider } from '../src/platform/filesystemBackup.provider';
import { withVerifiedSourceFile } from '../src/platform/migrationStreaming.service';
import { LocalStorageProvider } from '../src/storage/localStorage.provider';

const organizationId = '99999999-0000-4000-8000-000000000101';
const jobId = process.argv[2] || '';
const databaseUrl = process.env.DATABASE_URL || '';
const directUrl = process.env.DIRECT_URL || '';
const database = new URL(databaseUrl || 'postgresql://invalid.invalid/blocked');
const storageRoot = process.env.LOCAL_STORAGE_PATH || '';

if (process.env.NODE_ENV !== 'test' || process.env.STORAGE_MODE !== 'local'
  || databaseUrl !== directUrl || database.hostname !== '127.0.0.1'
  || database.port !== '55510' || database.pathname !== '/pravia_control_plane_20261016'
  || database.searchParams.get('schema') !== 'pravia_os'
  || !path.isAbsolute(storageRoot) || path.resolve(storageRoot) === path.parse(storageRoot).root
  || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(jobId)) {
  throw new Error('QA_BACKUP_MIGRATION_SOURCE_LOCAL_ONLY');
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

async function main() {
  const job = await db.migrationJob.findFirstOrThrow({ where: { id: jobId, organization_id: organizationId,
    status: 'PREVIEW_READY', approved_at: { not: null } } });
  const session = await db.resumableUploadSession.findFirstOrThrow({ where: {
    migration_job_id: job.id, organization_id: organizationId, status: 'COMPLETED',
  }, orderBy: { completed_at: 'desc' } });
  if (!session.sha256) throw new Error('QA_SOURCE_SHA_MISSING');
  const parts = await db.resumableUploadPart.findMany({ where: { upload_session_id: session.id }, orderBy: { part_number: 'asc' } });
  const provider = new LocalStorageProvider();
  const root = await mkdtemp(path.join(os.tmpdir(), 'pravia-migration-backup-qa-'));
  const backups = new BackupOrchestrator(db);

  return withVerifiedSourceFile({
    provider, parts,
    keyForPart: (part) => part.provider_etag || `organizations/${organizationId}/migration-temp/${session.id}/parts/${String(part.part_number).padStart(8, '0')}.bin`,
    expectedBytes: session.declared_bytes, expectedChecksum: session.sha256,
    inspect: async (sourceFilename) => {
      const backupProvider = new FilesystemIndependentBackupProvider({
        backupRoot: path.join(root, 'backup'), restoreRoot: path.join(root, 'restore'),
        sourceResolver: async () => sourceFilename,
      });
      const backup = await backups.run({ organizationId, scope: `MIGRATION_SOURCE:${job.id}`, provider: backupProvider }) as any;
      const drill = await backups.restoreDrill({ backupRunId: backup.id, provider: backupProvider }) as any;
      if (backup.checksum_sha256 !== session.sha256 || BigInt(backup.bytes) !== session.declared_bytes
        || drill.result !== 'PASS') throw new Error('QA_BACKUP_SOURCE_VERIFICATION_FAILED');
      return { backupId: backup.id, jobId: job.id, sourceSha256: session.sha256, bytes: session.declared_bytes.toString() };
    },
  });
}

main().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : 'QA_BACKUP_FAILED'}\n`); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
