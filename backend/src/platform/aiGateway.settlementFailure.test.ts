import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { AiGateway } from './aiGateway.service';
import { AiWalletService } from './aiWallet.service';
import { PlatformPricingService } from './pricing.service';

describe('AI extraction: bounded settlement and provider cost preservation', () => {
  afterEach(() => vi.restoreAllMocks());
  it('preserva el costo real si falla la liquidación, no repite proveedor ni filtra Prisma', async () => {
    const reserve = vi.spyOn(AiWalletService.prototype, 'reserveAiBalance').mockResolvedValue({ id: 'reservation' } as any);
    vi.spyOn(AiWalletService.prototype, 'claimReservationForExecution').mockResolvedValue(undefined as any);
    vi.spyOn(AiWalletService.prototype, 'settleAiUsage').mockRejectedValue(new Error('Invalid Prisma invocation /internal/path'));
    const release = vi.spyOn(AiWalletService.prototype, 'releaseAiReservation').mockResolvedValue(undefined as any);
    vi.spyOn(PlatformPricingService.prototype, 'activeCommercialSku').mockResolvedValue({ id: 'sku', currency: 'MXN', sale_price_minor: 10n, min_markup_multiplier: new Prisma.Decimal(2) } as any);
    const create = vi.fn().mockResolvedValue({ id: 'usage' });
    const db = { aiOperationCatalog: { findUnique: vi.fn().mockResolvedValue({ active: true, billing_class: 'CUSTOMER_WALLET', required_capability: 'ia.execute', max_charge_minor: 20n, allow_fallback: false }) },
      aiRoutingPolicyVersion: { findFirst: vi.fn().mockResolvedValue({ routing_rules_json: { candidates: [{ providerCode: 'QA_PROVIDER', modelCode: 'qa-model' }] } }) },
      aiModelRegistry: { findMany: vi.fn().mockResolvedValue([{ provider_code: 'QA_PROVIDER', model_code: 'qa-model' }]) }, aiUsageEvent: { create } } as any;
    const execute = vi.fn().mockResolvedValue({ output: { synthetic: true }, inputTokens: 34, outputTokens: 12, providerCostAmount: '0.01', providerCostCurrency: 'MXN', fxRate: '1', fxSnapshot: { source: 'QA' }, latencyMs: 5 });
    await expect(new AiGateway(db, [{ providerCode: 'QA_PROVIDER', execute }]).execute({
      actor: { userId: 'user', organizationId: 'org', membershipId: 'member', role: 'ADMINISTRACION', permissions: ['ia.execute'], scope: 'GLOBAL', sessionId: 'session' },
      operationCode: 'DOCUMENT_STRUCTURED_EXTRACTION', billingClass: 'CUSTOMER_WALLET', idempotencyKey: 'request', traceId: 'request', payload: {},
    })).rejects.toMatchObject({ code: 'AI_SETTLEMENT_FAILED', status: 503 });
    expect(execute).toHaveBeenCalledTimes(1); expect(reserve).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ provider_cost_amount: '0.01', input_tokens: 34, output_tokens: 12, wallet_debit_minor: 0n, status: 'REJECTED', error_code: 'AI_SETTLEMENT_FAILED', fx_snapshot: expect.objectContaining({ costUnverified: false }) }) });
  });
  it('usa una transacción serializable con espera y duración acotadas', async () => {
    const transaction = vi.fn().mockResolvedValue({});
    await new AiWalletService({ $transaction: transaction } as any).reserveAiBalance({ organizationId: 'org', estimatedMaxChargeMinor: 10n, idempotencyKey: 'request' });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 20_000 });
  });
});
