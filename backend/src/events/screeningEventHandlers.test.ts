import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const queries = new Map<string, { query: { id: string; execution_state: string }; idempotent: boolean }>();
  const snapshots: Array<Record<string, string>> = [];
  let sequence = 0;
  return {
    queries,
    snapshots,
    reset() {
      queries.clear();
      snapshots.splice(0);
      sequence = 0;
    },
    nextId() {
      sequence += 1;
      return `query-${sequence}`;
    },
  };
});

const execute = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const ensureOperation = vi.hoisted(() => vi.fn());

vi.mock('../config/prisma', () => ({
  default: {
    $transaction: vi.fn((callback: (tx: Record<string, never>) => unknown) => callback({})),
  },
}));

vi.mock('../services/complianceScreening.service', () => ({
  complianceScreeningService: { execute },
  queueMasterScreeningTx: vi.fn(async (_tx: unknown, input: { triggerKey: string }) => {
    const existing = state.queries.get(input.triggerKey);
    if (existing) return { ...existing, idempotent: true };
    const created = { query: { id: state.nextId(), execution_state: 'NOT_CONFIGURED' }, idempotent: false };
    state.queries.set(input.triggerKey, created);
    return created;
  }),
}));

vi.mock('../services/operationScreening.service', () => ({
  ensureOperationScreeningForPartyTx: ensureOperation,
}));

import { DomainEventBus, type DomainEvent } from './domainEventBus';
import './screeningEventHandlers';

const organizationId = '00000000-0000-4000-8000-000000009301';
const actorId = '00000000-0000-4000-8000-000000009302';
const comparecienteId = '00000000-0000-4000-8000-000000009303';
const requirementId = '00000000-0000-4000-8000-000000009304';

function event(eventId: string, eventType = 'ComparecienteCreado'): DomainEvent {
  return {
    event_id: eventId,
    organization_id: organizationId,
    event_type: eventType,
    aggregate_type: 'Compareciente',
    aggregate_id: comparecienteId,
    actor_user_id: actorId,
    occurred_at: new Date('2026-09-01T00:00:00.000Z'),
    correlation_id: `correlation-${eventId}`,
    payload: { compareciente_id: comparecienteId, actor_user_id: actorId },
  };
}

async function dispatch(eventType: string, domainEvent: DomainEvent) {
  const handlers = DomainEventBus.getHandlers(eventType);
  expect(handlers).toHaveLength(1);
  await handlers[0].handler(domainEvent);
}

describe('CUM-LST-001 · handlers canónicos de outbox', () => {
  beforeEach(() => {
    state.reset();
    execute.mockClear();
    ensureOperation.mockReset().mockResolvedValue({
      eligible: true, query: { id: 'query-operation', execution_state: 'NOT_CONFIGURED' },
      queryIdempotent: false, requirement: { id: requirementId }, snapshot: { id: 'snapshot-1' },
    });
  });

  it('crea la consulta MASTER desde ComparecienteCreado y reintenta el mismo evento sin duplicarla', async () => {
    const created = event('event-create-1');
    await dispatch('ComparecienteCreado', created);
    await dispatch('ComparecienteCreado', created);

    expect([...state.queries.keys()]).toEqual(['event:event-create-1']);
    expect(state.queries).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('conserva consultas distintas para triggers de outbox distintos', async () => {
    await dispatch('ComparecienteCreado', event('event-create-1'));
    await dispatch('ComparecienteIdentityChanged', event('event-identity-1', 'ComparecienteIdentityChanged'));

    expect(new Set(state.queries.keys())).toEqual(new Set(['event:event-create-1', 'event:event-identity-1']));
    expect(new Set([...state.queries.values()].map(({ query }) => query.id)).size).toBe(2);
  });

  it('envía la operación vulnerable a la autoridad compartida con contexto tenant-aware', async () => {
    const vulnerable = event('event-operation-1', 'ComplianceVulnerableOperationDetected');
    vulnerable.aggregate_type = 'Expediente';
    vulnerable.aggregate_id = 'expediente-1';
    vulnerable.payload = { ...vulnerable.payload, expediente_id: 'expediente-1', expediente_acto_id: 'acto-1', review_id: 'review-1' };
    await dispatch('ComplianceVulnerableOperationDetected', vulnerable);

    expect(ensureOperation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      organizationId,
      expedienteId: 'expediente-1',
      comparecienteId,
      expedienteActoId: 'acto-1',
      reviewId: 'review-1',
      actorUserId: actorId,
      triggerEventId: 'event-operation-1',
    }));
  });

  it.each(['ExpedientePartyLinked', 'ExpedientePartyRelationUpdated'])('conecta %s a la misma autoridad compartida', async (eventType) => {
    const linked = event(`event-${eventType}`, eventType);
    linked.aggregate_type = 'Expediente';
    linked.aggregate_id = 'expediente-1';
    linked.payload = { relation_id: 'relation-1', compareciente_id: comparecienteId, expediente_acto_id: 'acto-1' };
    await dispatch(eventType, linked);
    expect(ensureOperation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      organizationId, expedienteId: 'expediente-1', relationId: 'relation-1', actorUserId: actorId,
    }));
  });
});
