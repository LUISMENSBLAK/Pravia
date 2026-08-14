import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import prisma from '../src/config/prisma';
import { DomainEventBus } from '../src/events/domainEventBus';
import { DomainEventOutboxService } from '../src/services/domainEventOutbox.service';
import { StorageCompensationWorker } from '../src/workers/storageCompensation.worker';

const rawUrl = String(process.env.DATABASE_URL || '');
const parsed = new URL(rawUrl);
if (process.env.PRAVIA_ENV !== 'staging' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55434'
  || parsed.pathname !== '/pravia_staging_future' || parsed.searchParams.get('schema') !== 'pravia_os') {
  throw new Error('REFUSED_PRODUCTION_WRITE: workers E2E solo admite staging local exacto.');
}
const storageRoot = path.resolve(process.env.STAGING_LOCAL_STORAGE_PATH || '/private/tmp/pravia-phase15c-staging-storage');
if (!storageRoot.includes('staging')) throw new Error('El storage local debe identificar staging.');
const suffix = randomUUID().slice(0, 8);
const checks: string[] = [];

async function createEvent(eventType: string, actorId: string, overrides: Record<string, unknown> = {}) {
  return prisma.domainEventOutbox.create({ data: {
    event_type: eventType, aggregate_type: 'E2EWorker', aggregate_id: randomUUID(),
    actor_user_id: actorId, payload: { actor_user_id: actorId, suffix }, ...overrides,
  } as any });
}

async function main() {
  const user = await prisma.user.findFirstOrThrow({ where: { activo: true, rol: { in: ['DIRECCION', 'ADMINISTRACION'] } } });
  const service = new DomainEventOutboxService(prisma);
  const notificationType = `E2ENotificationRequested.${suffix}`;
  const reminderType = `E2EReminderRequested.${suffix}`;
  const aiType = `E2EAIDocumentJobRequested.${suffix}`;
  const staleType = `E2EStaleLock.${suffix}`;
  const failureType = `E2EFailure.${suffix}`;
  const noHandlerType = `E2ENoHandler.${suffix}`;

  DomainEventBus.register(notificationType, `notification-${suffix}`, async (event) => {
    await prisma.notification.create({ data: { recipient_id: user.id, created_by_id: user.id, type: 'E2E', title: 'Worker notification', body: event.event_id } });
  });
  DomainEventBus.register(reminderType, `reminder-${suffix}`, async (event) => {
    await prisma.tarea.upsert({ where: { idempotency_key: `event:${event.event_id}:reminder` }, update: {}, create: {
      asignado_a_id: user.id, creador_id: user.id, titulo: 'Recordatorio E2E', idempotency_key: `event:${event.event_id}:reminder`, event_id: event.event_id,
    } });
  });
  DomainEventBus.register(aiType, `ai-document-${suffix}`, async (event) => {
    await prisma.aIUsageLog.create({ data: { modelo: 'fixture-local-no-provider', operacion: 'DOCUMENT_JOB_LIFECYCLE', usuario_id: user.id, metadata: { event_id: event.event_id }, total_tokens: 0, duracion_ms: 0 } });
  });
  DomainEventBus.register(staleType, `stale-${suffix}`, async () => undefined);
  DomainEventBus.register(failureType, `failure-${suffix}`, async () => { throw new Error('Fallo sintético recuperable'); });

  const [notification, reminder, aiJob, noHandler] = await Promise.all([
    createEvent(notificationType, user.id), createEvent(reminderType, user.id), createEvent(aiType, user.id), createEvent(noHandlerType, user.id),
  ]);
  const stale = await createEvent(staleType, user.id, { estatus: 'PROCESANDO', locked_at: new Date(Date.now() - 10 * 60_000), locked_by: 'dead-worker' });
  const failure = await createEvent(failureType, user.id);
  await service.processPendingOutboxEvents(500, `phase15c-${suffix}`);

  const [notificationState, reminderState, aiState, staleState, noHandlerState, failureState] = await Promise.all([
    prisma.domainEventOutbox.findUniqueOrThrow({ where: { id: notification.id } }),
    prisma.domainEventOutbox.findUniqueOrThrow({ where: { id: reminder.id } }),
    prisma.domainEventOutbox.findUniqueOrThrow({ where: { id: aiJob.id } }),
    prisma.domainEventOutbox.findUniqueOrThrow({ where: { id: stale.id } }),
    prisma.domainEventOutbox.findUniqueOrThrow({ where: { id: noHandler.id } }),
    prisma.domainEventOutbox.findUniqueOrThrow({ where: { id: failure.id } }),
  ]);
  if (![notificationState, reminderState, aiState, staleState].every((item) => item.estatus === 'PROCESADO')) throw new Error('Claim/success/stale reclaim no terminaron correctamente.');
  if (noHandlerState.estatus !== 'FALLIDO' || !noHandlerState.last_error?.startsWith('NO_HANDLER_REGISTERED:')) throw new Error('Evento sin handler se marcó como éxito.');
  if (failureState.estatus !== 'FALLIDO' || failureState.available_at <= new Date()) throw new Error('Fallo no quedó programado con backoff.');
  checks.push('outbox:claim-lock-success-failure-backoff-stale-reclaim');
  checks.push('outbox:no-handler-nunca-success');

  for (let attempt = failureState.attempts; attempt < 5; attempt++) {
    await prisma.domainEventOutbox.update({ where: { id: failure.id }, data: { available_at: new Date(0) } });
    await service.processPendingOutboxEvents(50, `phase15c-retry-${attempt}`);
  }
  const terminal = await prisma.domainEventOutbox.findUniqueOrThrow({ where: { id: failure.id } });
  await prisma.domainEventOutbox.update({ where: { id: failure.id }, data: { available_at: new Date(0) } });
  const terminalProcessed = await service.processPendingOutboxEvents(50, 'phase15c-terminal-check');
  const terminalAfter = await prisma.domainEventOutbox.findUniqueOrThrow({ where: { id: failure.id } });
  if (terminal.attempts !== 5 || terminal.estatus !== 'FALLIDO' || terminalAfter.attempts !== 5 || terminalProcessed !== 0) throw new Error('El fallo terminal no quedó bloqueado después del máximo.');
  checks.push('outbox:retry-terminal-attempts-5');

  const notificationsBefore = await prisma.notification.count({ where: { body: notification.id } });
  await prisma.domainEventOutbox.update({ where: { id: notification.id }, data: { estatus: 'FALLIDO', processed_at: null, available_at: new Date(0) } });
  await service.processPendingOutboxEvents(50, 'phase15c-idempotency-check');
  const notificationsAfter = await prisma.notification.count({ where: { body: notification.id } });
  if (notificationsBefore !== 1 || notificationsAfter !== 1) throw new Error('El handler completado produjo un efecto duplicado.');
  checks.push('outbox:idempotencia-por-handler');

  const session = await prisma.comparecienteAltaSession.create({ data: {
    usuario_id: user.id, tipo_persona: 'FISICA', estatus: 'CANCELADO', expires_at: new Date(Date.now() + 3600000),
  } });
  const storageKey = `temporales/comparecientes/${session.id}/worker-${suffix}.pdf`;
  const absolute = path.join(storageRoot, storageKey);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, '%PDF-1.4\n% local worker fixture');
  const carga = await prisma.cargaTemporalDocumento.create({ data: {
    alta_session_id: session.id, usuario_id: user.id, tipo_documento: 'OTRO', nombre_original: `worker-${suffix}.pdf`,
    storage_key_temporal: storageKey, mime_type: 'application/pdf', tamano_bytes: 32, sha256: 'e2e-fixture',
    estado: 'DESCARTADO', expires_at: session.expires_at, archived_at: new Date(),
  } });
  const job = await prisma.storageCompensationJob.create({ data: { carga_temporal_id: carga.id, storage_key: storageKey, correlation_id: randomUUID() } });
  const storageWorker = new StorageCompensationWorker(prisma as any, async (key) => fs.unlink(path.join(storageRoot, key)), { pollMs: 1000, maxAttempts: 3, staleMs: 60000 });
  await storageWorker.runOnce();
  const [jobState, cargaState] = await Promise.all([
    prisma.storageCompensationJob.findUniqueOrThrow({ where: { id: job.id } }),
    prisma.cargaTemporalDocumento.findUniqueOrThrow({ where: { id: carga.id } }),
  ]);
  let fileExists = true;
  try { await fs.access(absolute); } catch { fileExists = false; }
  if (jobState.estatus !== 'COMPLETADO' || !cargaState.eliminado_storage_at || fileExists) throw new Error('Storage compensation no completó el lifecycle real.');
  checks.push('storage-compensation:claim-delete-success-final');

  const sideEffects = {
    notifications: await prisma.notification.count({ where: { body: notification.id } }),
    reminders: await prisma.tarea.count({ where: { event_id: reminder.id } }),
    ai_document_logs: await prisma.aIUsageLog.count({ where: { metadata: { path: ['event_id'], equals: aiJob.id } } }),
  };
  if (sideEffects.notifications !== 1 || sideEffects.reminders !== 1 || sideEffects.ai_document_logs !== 1) throw new Error('Faltó un efecto esperado de notification/reminder/AI-document.');
  checks.push('consumers:notification-reminder-ai-document-fixture');
  console.log(JSON.stringify({ ok: true, environment: 'local-staging-s2', checks, side_effects: sideEffects, paid_provider_used: false }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, checks, error: error.message }, null, 2));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
