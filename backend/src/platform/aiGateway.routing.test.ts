import { describe, expect, it, vi } from 'vitest';
import type { ActorContext } from '../auth/actorContext';
import { AiGateway, type AiProviderAdapter } from './aiGateway.service';
import { PlatformDomainError } from './platform.errors';

const actor: ActorContext = {
  userId: 'platform-user-qa', organizationId: 'organization-qa', membershipId: 'membership-qa',
  role: 'DIRECCION', permissions: ['ai.use'], scope: 'GLOBAL', sessionId: 'session-qa',
};

type FakeOptions = {
  tier?: 'ECONOMY' | 'STANDARD' | 'PREMIUM';
  active?: boolean;
  operationClass?: 'PLATFORM_INCLUDED' | 'PLAN_INCLUDED';
  candidates?: Array<{ providerCode: string; modelCode: string }>;
  enabled?: Array<{ provider_code: string; model_code: string }>;
  platformAdmin?: boolean;
  existing?: { status: string } | null;
  allowFallback?: boolean;
};

const fakeDb = (options: FakeOptions = {}) => {
  const tier = options.tier || 'STANDARD';
  const candidates = options.candidates || [{ providerCode: 'QA_PROVIDER', modelCode: `qa-${tier.toLowerCase()}` }];
  const enabled = options.enabled === undefined
    ? candidates.map((candidate) => ({ provider_code: candidate.providerCode, model_code: candidate.modelCode }))
    : options.enabled;
  return {
    aiOperationCatalog: { findUnique: vi.fn().mockResolvedValue({
      operation_code: `QA_${tier}`, active: options.active !== false,
      billing_class: options.operationClass || 'PLATFORM_INCLUDED', required_capability: 'ai.use',
      quality_tier: tier, max_input: 100, max_output: 100, allow_fallback: options.allowFallback === true,
    }) },
    platformAdministrator: { findUnique: vi.fn().mockResolvedValue(options.platformAdmin === false ? null : {
      status: 'ACTIVE', revoked_at: null, permissions: ['platform.ai.internal'],
    }) },
    aiRoutingPolicyVersion: { findFirst: vi.fn().mockResolvedValue(candidates.length ? {
      routing_rules_json: { candidates },
    } : null) },
    aiModelRegistry: { findMany: vi.fn().mockResolvedValue(enabled) },
    aiUsageEvent: {
      findUnique: vi.fn().mockResolvedValue(options.existing || null),
      create: vi.fn().mockResolvedValue({ id: 'usage-qa' }),
      update: vi.fn().mockResolvedValue({ id: 'usage-qa' }),
    },
  } as any;
};

const adapter = (providerCode: string, output: string, execute = vi.fn()) => ({
  providerCode,
  execute: execute.mockResolvedValue({
    output: { route: output }, inputTokens: 2, outputTokens: 1,
    providerCostAmount: '0.01', providerCostCurrency: 'MXN', fxRate: '1',
    fxSnapshot: { source: 'LOCAL_QA', rate: '1' }, latencyMs: 2,
  }),
}) as AiProviderAdapter;

describe('AI Gateway versioned routing contract', () => {
  it.each(['ECONOMY', 'STANDARD', 'PREMIUM'] as const)(
    'AIG route %s uses the configured candidate and records its COGS without wallet debit',
    async (tier) => {
      const db = fakeDb({ tier });
      const provider = adapter('QA_PROVIDER', tier);
      const result = await new AiGateway(db, [provider]).execute<{ route: string }>({
        actor, operationCode: `QA_${tier}`, billingClass: 'PLATFORM_INCLUDED',
        idempotencyKey: `route:${tier}`, traceId: `trace:${tier}`, payload: { text: 'synthetic' },
      });

      expect(result).toEqual({ route: tier });
      expect(provider.execute).toHaveBeenCalledWith(expect.objectContaining({ modelCode: `qa-${tier.toLowerCase()}` }));
      expect(db.aiUsageEvent.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ provider_code: 'QA_PROVIDER', model_code: `qa-${tier.toLowerCase()}`,
          provider_cost_amount: '0.01', status: 'COMPLETED' }),
      }));
    },
  );

  it('AIG25 rejects a disabled provider before any external execution', async () => {
    const db = fakeDb({ enabled: [] });
    const provider = adapter('QA_PROVIDER', 'should-not-run');
    await expect(new AiGateway(db, [provider]).execute({
      actor, operationCode: 'QA_STANDARD', billingClass: 'PLATFORM_INCLUDED',
      idempotencyKey: 'disabled-provider', traceId: 'disabled-provider-trace', payload: {},
    })).rejects.toMatchObject({ code: 'AI_ROUTE_UNAVAILABLE', status: 503 });
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it('AIG17 rejects an actor without the operation capability before provider execution', async () => {
    const db = fakeDb();
    const provider = adapter('QA_PROVIDER', 'should-not-run');
    await expect(new AiGateway(db, [provider]).execute({
      actor: { ...actor, permissions: [] }, operationCode: 'QA_STANDARD', billingClass: 'PLATFORM_INCLUDED',
      idempotencyKey: 'permission-denied', traceId: 'permission-denied-trace', payload: {},
    })).rejects.toMatchObject({ code: 'AI_PERMISSION_DENIED', status: 403 });
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it('fails closed when the operation is disabled or has no versioned route', async () => {
    const provider = adapter('QA_PROVIDER', 'should-not-run');
    await expect(new AiGateway(fakeDb({ active: false }), [provider]).execute({
      actor, operationCode: 'QA_STANDARD', billingClass: 'PLATFORM_INCLUDED',
      idempotencyKey: 'inactive-operation', traceId: 'inactive-operation-trace', payload: {},
    })).rejects.toMatchObject({ code: 'AI_OPERATION_DISABLED' });
    await expect(new AiGateway(fakeDb({ candidates: [] }), [provider]).execute({
      actor, operationCode: 'QA_STANDARD', billingClass: 'PLATFORM_INCLUDED',
      idempotencyKey: 'missing-route', traceId: 'missing-route-trace', payload: {},
    })).rejects.toMatchObject({ code: 'AI_ROUTING_NOT_CONFIGURED' });
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it('uses fallback only when the operation policy permits it', async () => {
    const candidates = [
      { providerCode: 'QA_PRIMARY', modelCode: 'qa-primary' },
      { providerCode: 'QA_FALLBACK', modelCode: 'qa-fallback' },
    ];
    const primaryExecute = vi.fn().mockRejectedValue(
      new PlatformDomainError('AI_PROVIDER_HTTP_ERROR', 'synthetic primary outage', 502),
    );
    const fallback = adapter('QA_FALLBACK', 'fallback');
    const db = fakeDb({ candidates, allowFallback: true });
    await expect(new AiGateway(db, [
      { providerCode: 'QA_PRIMARY', execute: primaryExecute } as AiProviderAdapter,
      fallback,
    ]).execute({
      actor, operationCode: 'QA_STANDARD', billingClass: 'PLATFORM_INCLUDED',
      idempotencyKey: 'fallback-allowed', traceId: 'fallback-allowed-trace', payload: {},
    })).resolves.toEqual({ route: 'fallback' });
    expect(primaryExecute).toHaveBeenCalledTimes(1);
    expect(fallback.execute).toHaveBeenCalledTimes(1);
    expect(db.aiUsageEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      provider_code: 'QA_FALLBACK', model_code: 'qa-fallback',
      fx_snapshot: expect.objectContaining({ failedProviderAttempts: [expect.objectContaining({
        providerCode: 'QA_PRIMARY', modelCode: 'qa-primary', status: 'FAILED_COST_UNVERIFIED',
      })] }),
    }) }));

    const deniedFallback = adapter('QA_FALLBACK', 'should-not-run');
    await expect(new AiGateway(fakeDb({ candidates, allowFallback: false }), [
      { providerCode: 'QA_PRIMARY', execute: vi.fn().mockRejectedValue(
        new PlatformDomainError('AI_PROVIDER_HTTP_ERROR', 'synthetic primary outage', 502),
      ) } as AiProviderAdapter,
      deniedFallback,
    ]).execute({
      actor, operationCode: 'QA_STANDARD', billingClass: 'PLATFORM_INCLUDED',
      idempotencyKey: 'fallback-denied', traceId: 'fallback-denied-trace', payload: {},
    })).rejects.toMatchObject({ code: 'AI_PROVIDER_HTTP_ERROR' });
    expect(deniedFallback.execute).not.toHaveBeenCalled();
  });

  it('does not hide a non-recoverable provider payload defect behind fallback', async () => {
    const candidates = [
      { providerCode: 'QA_PRIMARY', modelCode: 'qa-primary' },
      { providerCode: 'QA_FALLBACK', modelCode: 'qa-fallback' },
    ];
    const fallback = adapter('QA_FALLBACK', 'should-not-run');
    await expect(new AiGateway(fakeDb({ candidates, allowFallback: true }), [
      { providerCode: 'QA_PRIMARY', execute: vi.fn().mockRejectedValue(
        new PlatformDomainError('AI_PROVIDER_PAYLOAD_INVALID', 'synthetic bad payload', 400),
      ) } as AiProviderAdapter,
      fallback,
    ]).execute({
      actor, operationCode: 'QA_STANDARD', billingClass: 'PLATFORM_INCLUDED',
      idempotencyKey: 'fallback-invalid-payload', traceId: 'fallback-invalid-payload-trace', payload: {},
    })).rejects.toMatchObject({ code: 'AI_PROVIDER_PAYLOAD_INVALID' });
    expect(fallback.execute).not.toHaveBeenCalled();
  });

  it('rejects unapproved PLAN_INCLUDED use and missing trace/idempotency context', async () => {
    const provider = adapter('QA_PROVIDER', 'should-not-run');
    await expect(new AiGateway(fakeDb({ operationClass: 'PLAN_INCLUDED' }), [provider]).execute({
      actor, operationCode: 'QA_STANDARD', billingClass: 'PLAN_INCLUDED',
      idempotencyKey: 'plan-disabled', traceId: 'plan-disabled-trace', payload: {},
    })).rejects.toMatchObject({ code: 'AI_PLAN_ENTITLEMENT_NOT_CONFIGURED' });
    await expect(new AiGateway(fakeDb(), [provider]).execute({
      actor, operationCode: 'QA_STANDARD', billingClass: 'PLATFORM_INCLUDED',
      idempotencyKey: '', traceId: '', payload: {},
    })).rejects.toMatchObject({ code: 'AI_IDEMPOTENCY_CONTEXT_REQUIRED' });
    expect(provider.execute).not.toHaveBeenCalled();
  });
});
