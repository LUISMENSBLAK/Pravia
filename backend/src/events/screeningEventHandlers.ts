import prisma from '../config/prisma';
import { DomainEventBus, type DomainEvent } from './domainEventBus';
import { complianceScreeningService, queueMasterScreeningTx } from '../services/complianceScreening.service';
import { ensureOperationScreeningForPartyTx } from '../services/operationScreening.service';

type ScreeningPayload = {
  compareciente_id?: string;
  expediente_id?: string;
  relation_id?: string;
  expediente_acto_id?: string;
  review_id?: string;
  actor_user_id?: string;
};

async function handleMaster(event: DomainEvent<ScreeningPayload>, reason: 'COMPARECIENTE_CREATED' | 'RELEVANT_IDENTITY_CHANGED') {
  const organizationId = event.organization_id;
  const comparecienteId = String(event.payload.compareciente_id || event.aggregate_id || '');
  const actorUserId = String(event.payload.actor_user_id || event.actor_user_id || '');
  if (!organizationId || !comparecienteId || !actorUserId) throw new Error('H3_EVENT_CONTEXT_REQUIRED');
  const queued = await prisma.$transaction((tx) => queueMasterScreeningTx(tx, {
    organizationId, comparecienteId, requestedById: actorUserId, triggerReason: reason,
    triggerKey: `event:${event.event_id}`, triggerEventId: event.event_id, correlationId: event.correlation_id,
  }));
  if (queued.query.execution_state === 'QUEUED') await complianceScreeningService.execute(organizationId, queued.query.id, actorUserId, event.correlation_id);
}

DomainEventBus.register('ComparecienteCreado', 'H3_SCREEN_COMPARECIENTE_CREATED', (event) => handleMaster(event as DomainEvent<ScreeningPayload>, 'COMPARECIENTE_CREATED'));
DomainEventBus.register('ComparecienteIdentityChanged', 'H3_SCREEN_RELEVANT_IDENTITY_CHANGE', (event) => handleMaster(event as DomainEvent<ScreeningPayload>, 'RELEVANT_IDENTITY_CHANGED'));

async function handleOperationEligibility(raw: DomainEvent<ScreeningPayload>) {
  const event = raw as DomainEvent<ScreeningPayload>;
  const organizationId = event.organization_id;
  const expedienteId = String(event.payload.expediente_id || event.aggregate_id || '');
  const actorUserId = String(event.payload.actor_user_id || event.actor_user_id || '');
  if (!organizationId || !expedienteId || !actorUserId) throw new Error('H3_EVENT_CONTEXT_REQUIRED');
  const result = await prisma.$transaction((tx) => ensureOperationScreeningForPartyTx(tx, {
    organizationId,
    expedienteId,
    relationId: event.payload.relation_id || null,
    comparecienteId: event.payload.compareciente_id || null,
    expedienteActoId: event.payload.expediente_acto_id || null,
    reviewId: event.payload.review_id || null,
    actorUserId,
    correlationId: event.correlation_id,
    triggerEventId: event.event_id,
  }));
  if (result.eligible && !result.queryIdempotent && result.query.execution_state === 'QUEUED') {
    await complianceScreeningService.execute(organizationId, result.query.id, actorUserId, event.correlation_id);
  }
}

DomainEventBus.register('ComplianceVulnerableOperationDetected', 'H3_SCREEN_VULNERABLE_OPERATION', async (raw) => {
  const event = raw as DomainEvent<ScreeningPayload>;
  await handleOperationEligibility(event);
});
DomainEventBus.register('ExpedientePartyLinked', 'H3_SCREEN_OPERATION_PARTY_LINKED', (event) => handleOperationEligibility(event as DomainEvent<ScreeningPayload>));
DomainEventBus.register('ExpedientePartyRelationUpdated', 'H3_SCREEN_OPERATION_PARTY_RELATION_UPDATED', (event) => handleOperationEligibility(event as DomainEvent<ScreeningPayload>));

export {};
