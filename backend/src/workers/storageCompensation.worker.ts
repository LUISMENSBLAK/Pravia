import type { PrismaClient, StorageCompensationJob } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '../config/prisma';
import { deleteFile } from '../services/supabase.service';
import { runWithPlatformOperation } from '../auth/actorContext';

type WorkerDatabase = Pick<PrismaClient, 'storageCompensationJob' | 'cargaTemporalDocumento' | 'assistantAttachment' | 'documento'>;
type DeleteStorageObject = (key: string) => Promise<void>;

export class UnsafeStorageCompensationError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

const metrics = {
  running: false,
  processed: 0,
  retried: 0,
  failed: 0,
  unsafe_rejected: 0,
  stale_reclaimed: 0,
  last_run_at: null as string | null,
  last_success_at: null as string | null,
  last_error: null as string | null,
};

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ type: 'storage_compensation', event, ...data }));

export class StorageCompensationWorker {
  private timer: NodeJS.Timeout | null = null;
  private processing = false;
  private stopping = false;
  private activeTick: Promise<boolean> | null = null;

  constructor(
    private readonly db: WorkerDatabase = prisma,
    private readonly removeObject: DeleteStorageObject = deleteFile,
    private readonly options = {
      pollMs: Math.max(Number(process.env.STORAGE_COMPENSATION_POLL_MS || 15_000), 1_000),
      maxAttempts: Math.max(Number(process.env.STORAGE_COMPENSATION_MAX_ATTEMPTS || 5), 1),
      staleMs: Math.max(Number(process.env.STORAGE_COMPENSATION_STALE_MS || 300_000), 60_000),
    },
  ) {}

  start() {
    if (this.timer) return;
    this.stopping = false;
    metrics.running = true;
    log('worker_started', { poll_ms: this.options.pollMs, max_attempts: this.options.maxAttempts });
    this.scheduleTick();
    this.timer = setInterval(() => this.scheduleTick(), this.options.pollMs);
    this.timer.unref();
  }

  async stop(timeoutMs = 10_000) {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    metrics.running = false;
    if (!this.activeTick) return true;
    const drained = await Promise.race([
      this.activeTick.then(() => true, () => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), Math.max(100, timeoutMs))),
    ]);
    log('worker_stopped', { drained });
    return drained;
  }

  private scheduleTick() {
    if (this.stopping || this.activeTick) return;
    this.activeTick = this.tick()
      .catch((error: any) => {
        metrics.last_error = String(error?.message || 'Storage compensation tick failed').slice(0, 500);
        log('worker_tick_failed', { error_code: error?.code || 'STORAGE_WORKER_TICK_FAILED' });
        return false;
      })
      .finally(() => { this.activeTick = null; });
  }

  async tick() {
    if (this.processing || this.stopping) return false;
    this.processing = true;
    metrics.last_run_at = new Date().toISOString();
    try { return await this.runOnce(); }
    finally { this.processing = false; }
  }

  async runOnce() {
    return runWithPlatformOperation('STORAGE_COMPENSATION_WORKER', () => this.runOncePrivileged());
  }

  private async runOncePrivileged() {
    await this.enqueueAssistantCleanupCandidate();
    const job = await this.claimNext();
    if (!job) return false;
    try {
      const owner = await this.assertSafeOwnership(job);
      await this.removeObject(job.storage_key);
      if (owner.kind === 'compareciente') {
        await this.db.cargaTemporalDocumento.update({ where: { id: owner.record.id }, data: { eliminado_storage_at: new Date(), ultimo_error_limpieza: null } });
      } else {
        await this.db.assistantAttachment.update({ where: { id: owner.record.id }, data: { storage_deleted_at: new Date(), cleanup_error: null } });
      }
      await this.db.storageCompensationJob.update({ where: { id: job.id }, data: { estatus: 'COMPLETADO', intentos: job.intentos + 1, ultimo_error: null } });
      metrics.processed += 1;
      metrics.last_success_at = new Date().toISOString();
      metrics.last_error = null;
      log('job_completed', { job_id: job.id, attempts: job.intentos + 1, correlation_id: job.correlation_id });
    } catch (error: any) {
      await this.recordFailure(job, error);
    }
    return true;
  }

  private async enqueueAssistantCleanupCandidate() {
    const now = new Date();
    const attachment = await this.db.assistantAttachment.findFirst({
      where: {
        source: 'TEMPORARY_UPLOAD', storage_key: { not: null }, storage_deleted_at: null,
        compensationJobs: { none: {} },
        OR: [{ status: 'ARCHIVED' }, { expires_at: { lte: now } }],
      },
      select: { id: true, organization_id: true, storage_key: true, status: true },
      orderBy: { created_at: 'asc' },
    });
    if (!attachment?.storage_key) return false;
    if (attachment.status !== 'ARCHIVED') {
      await this.db.assistantAttachment.update({ where: { id: attachment.id }, data: { status: 'ARCHIVED', archived_at: now } });
    }
    await this.db.storageCompensationJob.create({ data: {
      organization_id: attachment.organization_id,
      assistant_attachment_id: attachment.id,
      storage_key: attachment.storage_key,
      tipo_operacion: 'ELIMINAR_ADJUNTO_ASSISTANT',
      correlation_id: randomUUID(),
    } });
    return true;
  }

  private async claimNext() {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - this.options.staleMs);
    const candidate = await this.db.storageCompensationJob.findFirst({
      where: { OR: [{ estatus: 'PENDIENTE', proxima_ejecucion_at: { lte: now } }, { estatus: 'PROCESANDO', updated_at: { lt: staleBefore } }] },
      orderBy: [{ proxima_ejecucion_at: 'asc' }, { created_at: 'asc' }],
    });
    if (!candidate) return null;
    const claimed = await this.db.storageCompensationJob.updateMany({
      where: { id: candidate.id, estatus: candidate.estatus, updated_at: candidate.updated_at },
      data: { estatus: 'PROCESANDO' },
    });
    if (claimed.count !== 1) return null;
    if (candidate.estatus === 'PROCESANDO') metrics.stale_reclaimed += 1;
    return this.db.storageCompensationJob.findUnique({ where: { id: candidate.id } });
  }

  private async assertSafeOwnership(job: StorageCompensationJob) {
    if (job.tipo_operacion === 'ELIMINAR_ADJUNTO_ASSISTANT' && job.assistant_attachment_id) {
      const attachment = await this.db.assistantAttachment.findUnique({ where: { id: job.assistant_attachment_id } });
      if (!attachment || attachment.source !== 'TEMPORARY_UPLOAD' || attachment.storage_key !== job.storage_key) {
        throw new UnsafeStorageCompensationError('La referencia no coincide con un adjunto temporal propietario.', 'STORAGE_JOB_KEY_MISMATCH');
      }
      if (!job.organization_id || attachment.organization_id !== job.organization_id) {
        throw new UnsafeStorageCompensationError('El adjunto no pertenece a la organización del job.', 'STORAGE_JOB_TENANT_MISMATCH');
      }
      const expectedPrefix = `organizations/${attachment.organization_id}/temporales/assistant/${attachment.uploaded_by_id}/${attachment.conversation_id}/`;
      if (!job.storage_key.startsWith(expectedPrefix) || job.storage_key.includes('..')) {
        throw new UnsafeStorageCompensationError('La referencia no pertenece al espacio temporal del asistente.', 'STORAGE_JOB_KEY_UNSAFE');
      }
      const [officialReferences, otherActiveOwners] = await Promise.all([
        this.db.documento.count({ where: { storage_key: job.storage_key } }),
        this.db.assistantAttachment.count({ where: {
          storage_key: job.storage_key, id: { not: attachment.id }, source: 'TEMPORARY_UPLOAD', storage_deleted_at: null,
        } }),
      ]);
      if (officialReferences > 0 || otherActiveOwners > 0) {
        throw new UnsafeStorageCompensationError('La referencia todavía pertenece a otro registro o documento oficial.', 'STORAGE_JOB_REFERENCE_IN_USE');
      }
      const expired = Boolean(attachment.expires_at && attachment.expires_at <= new Date());
      if (attachment.status !== 'ARCHIVED' && !expired) {
        throw new UnsafeStorageCompensationError('El adjunto temporal todavía está activo.', 'STORAGE_JOB_OWNER_ACTIVE');
      }
      return { kind: 'assistant' as const, record: attachment };
    }
    if (job.tipo_operacion !== 'ELIMINAR_TEMPORAL' || !job.carga_temporal_id) {
      throw new UnsafeStorageCompensationError('El job no acredita una carga temporal propietaria.', 'STORAGE_JOB_OWNER_REQUIRED');
    }
    const carga = await this.db.cargaTemporalDocumento.findUnique({ where: { id: job.carga_temporal_id }, include: { altaSession: { select: { estatus: true } } } });
    if (!carga || carga.storage_key_temporal !== job.storage_key) {
      throw new UnsafeStorageCompensationError('La referencia de almacenamiento no coincide con la carga propietaria.', 'STORAGE_JOB_KEY_MISMATCH');
    }
    const tenantPrefix = job.organization_id ? `organizations/${job.organization_id}/temporales/comparecientes/${carga.alta_session_id}/` : '';
    const legacyPrefix = `temporales/comparecientes/${carga.alta_session_id}/`;
    if (!(job.organization_id ? job.storage_key.startsWith(tenantPrefix) : job.storage_key.startsWith(legacyPrefix)) || job.storage_key.includes('..')) {
      throw new UnsafeStorageCompensationError('La referencia no pertenece al espacio temporal acotado.', 'STORAGE_JOB_KEY_UNSAFE');
    }
    const [masterReferences, otherActiveOwners] = await Promise.all([
      this.db.documento.count({ where: { storage_key: job.storage_key } }),
      this.db.cargaTemporalDocumento.count({ where: { storage_key_temporal: job.storage_key, id: { not: carga.id }, archived_at: null } }),
    ]);
    if (masterReferences > 0 || otherActiveOwners > 0) {
      throw new UnsafeStorageCompensationError('La referencia todavía tiene propietarios activos; no se elimina.', 'STORAGE_JOB_REFERENCE_IN_USE');
    }
    const terminalSession = ['CANCELADO', 'EXPIRADO', 'FALLIDO'].includes(carga.altaSession.estatus);
    if (!carga.archived_at && carga.estado !== 'DESCARTADO' && !terminalSession) {
      throw new UnsafeStorageCompensationError('La carga sigue activa y su propiedad no es inequívoca.', 'STORAGE_JOB_OWNER_ACTIVE');
    }
    return { kind: 'compareciente' as const, record: carga };
  }

  private async recordFailure(job: StorageCompensationJob, error: any) {
    const attempts = job.intentos + 1;
    const unsafe = error instanceof UnsafeStorageCompensationError;
    const terminal = unsafe || attempts >= this.options.maxAttempts;
    const delayMs = Math.min(60_000 * 2 ** Math.max(attempts - 1, 0), 3_600_000);
    const safeMessage = String(error?.message || 'Error de almacenamiento').slice(0, 500);
    await this.db.storageCompensationJob.update({ where: { id: job.id }, data: { estatus: terminal ? 'FALLIDO' : 'PENDIENTE', intentos: attempts, ultimo_error: safeMessage, proxima_ejecucion_at: new Date(Date.now() + delayMs) } });
    if (job.assistant_attachment_id) {
      await this.db.assistantAttachment.update({ where: { id: job.assistant_attachment_id }, data: { cleanup_error: safeMessage } }).catch(() => undefined);
    }
    metrics.last_error = safeMessage;
    if (unsafe) metrics.unsafe_rejected += 1;
    if (terminal) metrics.failed += 1; else metrics.retried += 1;
    log(terminal ? 'job_failed' : 'job_retried', { job_id: job.id, attempts, error_code: error?.code || 'STORAGE_DELETE_FAILED', retry_in_ms: terminal ? null : delayMs, correlation_id: job.correlation_id });
  }
}

export async function getStorageCompensationHealth(db: WorkerDatabase = prisma) {
  try {
    return await runWithPlatformOperation('STORAGE_COMPENSATION_HEALTH', async () => {
    const [pending, processing, failed] = await Promise.all([
      db.storageCompensationJob.count({ where: { estatus: 'PENDIENTE' } }),
      db.storageCompensationJob.count({ where: { estatus: 'PROCESANDO' } }),
      db.storageCompensationJob.count({ where: { estatus: 'FALLIDO' } }),
    ]);
    return { ...metrics, pending, processing, failed_jobs: failed, status: failed > 0 ? 'degraded' : metrics.running ? 'ok' : 'disabled' };
    });
  } catch (error: any) {
    return { ...metrics, pending: null, processing: null, failed_jobs: null, status: 'unavailable', last_error: String(error?.message || 'Health unavailable').slice(0, 500) };
  }
}

export const storageCompensationWorker = new StorageCompensationWorker();
