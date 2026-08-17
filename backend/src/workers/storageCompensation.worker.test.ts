import { describe, expect, it, vi } from 'vitest';
import { getStorageCompensationHealth, StorageCompensationWorker } from './storageCompensation.worker';

const job = { id: 'job-1', carga_temporal_id: 'carga-1', storage_key: 'temporales/comparecientes/session-1/file.pdf', tipo_operacion: 'ELIMINAR_TEMPORAL', estatus: 'PENDIENTE', intentos: 0, ultimo_error: null, proxima_ejecucion_at: new Date(0), correlation_id: 'corr-1', created_at: new Date(0), updated_at: new Date(0) } as any;
const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const carga = { id: 'carga-1', alta_session_id: 'session-1', storage_key_temporal: job.storage_key, archived_at: new Date(), estado: 'DESCARTADO', altaSession: { estatus: 'CANCELADO' } };

function mockDb(overrides: Record<string, unknown> = {}) {
  return {
    storageCompensationJob: { findFirst: vi.fn().mockResolvedValue(job), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue(job), update: vi.fn().mockResolvedValue({}), create: vi.fn().mockResolvedValue({}) },
    cargaTemporalDocumento: { findUnique: vi.fn().mockResolvedValue(carga), count: vi.fn().mockResolvedValue(0), update: vi.fn().mockResolvedValue({}) },
    assistantAttachment: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), update: vi.fn().mockResolvedValue({}) },
    documento: { count: vi.fn().mockResolvedValue(0) }, ...overrides,
  } as any;
}

describe('StorageCompensationWorker', () => {
  it('elimina de forma idempotente solo una referencia temporal sin propietarios activos', async () => {
    const db = mockDb();
    const remove = vi.fn().mockResolvedValue(undefined);
    await new StorageCompensationWorker(db, remove, { pollMs: 1000, maxAttempts: 3, staleMs: 60_000 }).runOnce();
    expect(remove).toHaveBeenCalledWith(job.storage_key);
    expect(db.storageCompensationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estatus: 'COMPLETADO', intentos: 1 }) }));
  });

  it('no elimina si una referencia maestra utiliza el mismo storage key', async () => {
    const db = mockDb();
    db.documento.count.mockResolvedValue(1);
    const remove = vi.fn();
    await new StorageCompensationWorker(db, remove, { pollMs: 1000, maxAttempts: 3, staleMs: 60_000 }).runOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(db.storageCompensationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estatus: 'FALLIDO' }) }));
  });

  it('programa y elimina un adjunto temporal expirado con el ledger de compensación existente', async () => {
    const assistantJob = {
      ...job, id: 'job-assistant', carga_temporal_id: null, assistant_attachment_id: 'attachment-1',
      tipo_operacion: 'ELIMINAR_ADJUNTO_ASSISTANT',
      organization_id: organizationId,
      storage_key: `organizations/${organizationId}/temporales/assistant/user-1/conversation-1/audio.webm`,
    };
    const attachment = {
      id: 'attachment-1', organization_id: organizationId, conversation_id: 'conversation-1', uploaded_by_id: 'user-1', source: 'TEMPORARY_UPLOAD',
      storage_key: assistantJob.storage_key, status: 'AVAILABLE', expires_at: new Date(0), storage_deleted_at: null,
    };
    const db = mockDb();
    db.assistantAttachment.findFirst.mockResolvedValue(attachment);
    db.assistantAttachment.findUnique.mockResolvedValue({ ...attachment, status: 'ARCHIVED' });
    db.storageCompensationJob.findUnique.mockResolvedValue(assistantJob);
    db.storageCompensationJob.findFirst.mockResolvedValue(assistantJob);
    const remove = vi.fn().mockResolvedValue(undefined);

    await new StorageCompensationWorker(db, remove, { pollMs: 1000, maxAttempts: 3, staleMs: 60_000 }).runOnce();

    expect(db.storageCompensationJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      assistant_attachment_id: attachment.id, storage_key: assistantJob.storage_key,
      tipo_operacion: 'ELIMINAR_ADJUNTO_ASSISTANT',
    }) });
    expect(remove).toHaveBeenCalledWith(assistantJob.storage_key);
    expect(db.assistantAttachment.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: attachment.id }, data: expect.objectContaining({ storage_deleted_at: expect.any(Date), cleanup_error: null }),
    }));
  });

  it('rechaza un job de chat si el storage key también pertenece a un documento oficial', async () => {
    const assistantJob = {
      ...job, id: 'job-assistant', carga_temporal_id: null, assistant_attachment_id: 'attachment-1',
      tipo_operacion: 'ELIMINAR_ADJUNTO_ASSISTANT',
      organization_id: organizationId,
      storage_key: `organizations/${organizationId}/temporales/assistant/user-1/conversation-1/file.pdf`,
    };
    const db = mockDb();
    db.assistantAttachment.findUnique.mockResolvedValue({
      id: 'attachment-1', organization_id: organizationId, conversation_id: 'conversation-1', uploaded_by_id: 'user-1', source: 'TEMPORARY_UPLOAD',
      storage_key: assistantJob.storage_key, status: 'ARCHIVED', expires_at: new Date(0), storage_deleted_at: null,
    });
    db.storageCompensationJob.findFirst.mockResolvedValue(assistantJob);
    db.storageCompensationJob.findUnique.mockResolvedValue(assistantJob);
    db.documento.count.mockResolvedValue(1);
    const remove = vi.fn();

    await new StorageCompensationWorker(db, remove, { pollMs: 1000, maxAttempts: 3, staleMs: 60_000 }).runOnce();

    expect(remove).not.toHaveBeenCalled();
    expect(db.storageCompensationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estatus: 'FALLIDO' }) }));
    expect(db.assistantAttachment.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ storage_deleted_at: expect.any(Date) }) }));
  });

  it('no duplica jobs para adjuntos ya programados o eliminados', async () => {
    const db = mockDb();
    db.assistantAttachment.findFirst.mockResolvedValue(null);
    db.storageCompensationJob.findFirst.mockResolvedValue(null);
    const remove = vi.fn();
    expect(await new StorageCompensationWorker(db, remove, { pollMs: 1000, maxAttempts: 3, staleMs: 60_000 }).runOnce()).toBe(false);
    expect(db.storageCompensationJob.create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('reintenta con backoff y termina al alcanzar el máximo', async () => {
    const retryDb = mockDb();
    const remove = vi.fn().mockRejectedValue(new Error('storage temporalmente no disponible'));
    await new StorageCompensationWorker(retryDb, remove, { pollMs: 1000, maxAttempts: 2, staleMs: 60_000 }).runOnce();
    expect(retryDb.storageCompensationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estatus: 'PENDIENTE', intentos: 1, proxima_ejecucion_at: expect.any(Date) }) }));
    const terminal = { ...job, intentos: 1 };
    const terminalDb = mockDb();
    terminalDb.storageCompensationJob.findUnique.mockResolvedValue(terminal);
    await new StorageCompensationWorker(terminalDb, remove, { pollMs: 1000, maxAttempts: 2, staleMs: 60_000 }).runOnce();
    expect(terminalDb.storageCompensationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estatus: 'FALLIDO', intentos: 2 }) }));
  });

  it('no procesa dos veces el mismo job si pierde la reclamación optimista', async () => {
    const db = mockDb();
    db.storageCompensationJob.updateMany.mockResolvedValue({ count: 0 });
    const remove = vi.fn();
    expect(await new StorageCompensationWorker(db, remove, { pollMs: 1000, maxAttempts: 3, staleMs: 60_000 }).runOnce()).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('recupera un job PROCESANDO obsoleto mediante reclamación optimista', async () => {
    const staleJob = { ...job, estatus: 'PROCESANDO', updated_at: new Date(0) };
    const db = mockDb();
    db.storageCompensationJob.findFirst.mockResolvedValue(staleJob);
    db.storageCompensationJob.findUnique.mockResolvedValue(staleJob);
    const remove = vi.fn().mockResolvedValue(undefined);
    await new StorageCompensationWorker(db, remove, { pollMs: 1000, maxAttempts: 3, staleMs: 60_000 }).runOnce();
    expect(db.storageCompensationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ estatus: 'PROCESANDO', updated_at: staleJob.updated_at }) }));
    expect(remove).toHaveBeenCalledOnce();
  });

  it('detiene el polling sin iniciar trabajo nuevo', async () => {
    const db = mockDb();
    db.storageCompensationJob.findFirst.mockResolvedValue(null);
    const worker = new StorageCompensationWorker(db, vi.fn(), { pollMs: 1000, maxAttempts: 3, staleMs: 60_000 });
    worker.start();
    expect(await worker.stop()).toBe(true);
    const calls = db.storageCompensationJob.findFirst.mock.calls.length;
    await worker.tick();
    expect(db.storageCompensationJob.findFirst).toHaveBeenCalledTimes(calls);
  });

  it('aísla un fallo de telemetría del worker en el health', async () => {
    const db = mockDb();
    db.storageCompensationJob.count = vi.fn().mockRejectedValue(new Error('telemetría no disponible'));
    const health = await getStorageCompensationHealth(db);
    expect(health).toMatchObject({ status: 'unavailable', pending: null, processing: null, failed_jobs: null });
  });
});
