import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { PlatformDomainError, serializeBigInts } from './platform.errors';

export const BACKGROUND_JOB_TYPES = [
  'MIGRATION_ANALYZE', 'MIGRATION_EXECUTE', 'EXPORT', 'EXPORT_CLEANUP', 'STORAGE_RECONCILE',
  'STORAGE_ARCHIVE_MOVE', 'ARCHIVE_RESTORE', 'LARGE_OCR', 'BACKUP_VERIFY',
] as const;

const stablePayload = (value: unknown) => JSON.stringify(value, (_key, current) =>
  current && typeof current === 'object' && !Array.isArray(current)
    ? Object.fromEntries(Object.entries(current).sort(([left], [right]) => left.localeCompare(right)))
    : current);

export class BackgroundJobsService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async enqueue(input: {
    organizationId?: string;
    jobType: typeof BACKGROUND_JOB_TYPES[number];
    idempotencyKey: string;
    payload: Prisma.InputJsonValue;
    priority?: number;
    maxAttempts?: number;
    scheduledAt?: Date;
  }) {
    if (!BACKGROUND_JOB_TYPES.includes(input.jobType)) throw new PlatformDomainError('JOB_TYPE_INVALID', 'El tipo de job no es válido.', 400);
    const where = { organization_id: input.organizationId || null, idempotency_key: input.idempotencyKey };
    const assertSameJob = (job: { job_type: string; payload_ref: unknown }) => {
      if (job.job_type !== input.jobType || stablePayload(job.payload_ref) !== stablePayload(input.payload)) {
        throw new PlatformDomainError('JOB_IDEMPOTENCY_CONFLICT', 'La clave de idempotencia ya pertenece a otro trabajo.', 409);
      }
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.db.$transaction(async (tx) => {
          const existing = await tx.backgroundJob.findFirst({ where });
          if (existing) { assertSameJob(existing); return serializeBigInts(existing); }
          return serializeBigInts(await tx.backgroundJob.create({ data: {
            organization_id: input.organizationId,
            job_type: input.jobType,
            idempotency_key: input.idempotencyKey,
            payload_ref: input.payload,
            priority: input.priority ?? 100,
            max_attempts: Math.max(1, Math.min(input.maxAttempts || 5, 20)),
            // PostgreSQL supplies now() for immediate work, avoiding clock skew.
            scheduled_at: input.scheduledAt,
          } }));
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code);
        if (!retryable) throw error;
        const existing = await this.db.backgroundJob.findFirst({ where });
        if (existing) { assertSameJob(existing); return serializeBigInts(existing); }
        if (attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 10));
      }
    }
    throw new PlatformDomainError('JOB_ENQUEUE_RETRY_EXHAUSTED', 'No fue posible registrar el trabajo.', 503);
  }

  async claimNext(input: { workerId: string; globalConcurrency: number; perTenantConcurrency: number; leaseSeconds?: number }) {
    if (!input.workerId) throw new PlatformDomainError('WORKER_ID_REQUIRED', 'El worker debe identificarse.', 400);
    const leaseSeconds = Math.max(15, Math.min(input.leaseSeconds || 120, 900));
    const rows = await this.db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH serialized AS (
        SELECT pg_advisory_xact_lock(707261766961::bigint)
      ), exhausted AS (
        UPDATE background_jobs job
        SET status = 'FAILED', finished_at = now(), lease_owner = NULL, lease_expires_at = NULL,
            last_error = COALESCE(last_error, 'Worker lease expired after the maximum number of attempts.')
        FROM serialized
        WHERE job.status = 'RUNNING' AND job.lease_expires_at <= now() AND job.attempts >= job.max_attempts
        RETURNING job.id
      ), capacity AS (
        SELECT count(*)::int AS running
        FROM background_jobs, serialized
        WHERE status = 'RUNNING' AND lease_expires_at > now()
      ), candidate AS (
        SELECT job.id
        FROM background_jobs job, capacity
        WHERE capacity.running < ${Math.max(1, input.globalConcurrency)}
          AND (
            (job.status IN ('PENDING', 'RETRY') AND job.scheduled_at <= now())
            OR (job.status = 'RUNNING' AND job.lease_expires_at <= now())
          )
          AND job.attempts < job.max_attempts
          AND (
            job.organization_id IS NULL OR (
              SELECT count(*) FROM background_jobs active
              WHERE active.organization_id = job.organization_id
                AND active.status = 'RUNNING'
                AND active.lease_expires_at > now()
            ) < ${Math.max(1, input.perTenantConcurrency)}
          )
        ORDER BY job.priority ASC, job.scheduled_at ASC, job.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE background_jobs job
      SET status = 'RUNNING', lease_owner = ${input.workerId},
          lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
          heartbeat_at = now(), started_at = COALESCE(started_at, now()), attempts = attempts + 1
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING job.id
    `);
    if (!rows[0]) return null;
    const job = await this.db.backgroundJob.findUniqueOrThrow({ where: { id: rows[0].id } });
    return serializeBigInts(job);
  }

  async heartbeat(jobId: string, workerId: string, progress: number, leaseSeconds = 120) {
    const updated = await this.db.backgroundJob.updateMany({
      where: { id: jobId, status: 'RUNNING', lease_owner: workerId },
      data: {
        progress: Math.max(0, Math.min(Math.floor(progress), 100)),
        heartbeat_at: new Date(),
        lease_expires_at: new Date(Date.now() + Math.max(15, Math.min(leaseSeconds, 900)) * 1000),
      },
    });
    if (updated.count !== 1) throw new PlatformDomainError('JOB_LEASE_LOST', 'El worker ya no posee el lease del job.', 409);
  }

  async complete(jobId: string, workerId: string) {
    const updated = await this.db.backgroundJob.updateMany({
      where: { id: jobId, status: 'RUNNING', lease_owner: workerId },
      data: { status: 'COMPLETED', progress: 100, finished_at: new Date(), lease_expires_at: null, heartbeat_at: new Date() },
    });
    if (updated.count !== 1) throw new PlatformDomainError('JOB_LEASE_LOST', 'El worker ya no posee el lease del job.', 409);
  }

  async fail(jobId: string, workerId: string, message: string) {
    const job = await this.db.backgroundJob.findFirst({ where: { id: jobId, status: 'RUNNING', lease_owner: workerId } });
    if (!job) throw new PlatformDomainError('JOB_LEASE_LOST', 'El worker ya no posee el lease del job.', 409);
    const final = job.attempts >= job.max_attempts;
    await this.db.backgroundJob.update({ where: { id: job.id }, data: {
      status: final ? 'FAILED' : 'RETRY',
      last_error: message.slice(0, 8_000),
      scheduled_at: final ? job.scheduled_at : new Date(Date.now() + Math.min(60_000, 1000 * 2 ** job.attempts)),
      finished_at: final ? new Date() : null,
      lease_owner: null,
      lease_expires_at: null,
    } });
  }
}

export const backgroundJobsService = new BackgroundJobsService();
