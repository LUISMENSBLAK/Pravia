import type { Permission } from '../auth/permissions';
import type { ActorContext } from '../auth/actorContext';
import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { AiWalletService } from './aiWallet.service';
import { PlatformDomainError } from './platform.errors';
import { PlatformPricingService } from './pricing.service';
import { CURRENT_AI_BILLING_CLASS_BY_OPERATION, MIGRATION_INCLUDED_OPERATION_CODES,
  isAiBillingClass, type AiBillingClass } from './aiBillingPolicy';

export type AiGatewayRequest = {
  actor: ActorContext;
  operationCode: string;
  billingClass: AiBillingClass;
  migrationJobId?: string;
  idempotencyKey: string;
  traceId: string;
  payload: unknown;
  timeoutMs?: number;
};

export type AiProviderResult<T = unknown> = {
  output: T;
  inputTokens: number;
  outputTokens: number;
  providerCostAmount: string | number;
  providerCostCurrency: string;
  fxRate?: string | number;
  fxSnapshot?: Prisma.InputJsonValue;
  latencyMs: number;
};

export interface AiProviderAdapter {
  readonly providerCode: string;
  execute<T>(input: { modelCode: string; payload: unknown; timeoutMs: number; traceId: string }): Promise<AiProviderResult<T>>;
}

type RoutingCandidate = { providerCode: string; modelCode: string };
type FailedProviderAttempt = {
  providerCode: string;
  modelCode: string;
  status: 'FAILED_COST_UNVERIFIED';
  errorCode: string;
};

const failedProviderAttempt = (candidate: RoutingCandidate, error: unknown): FailedProviderAttempt => ({
  providerCode: candidate.providerCode,
  modelCode: candidate.modelCode,
  status: 'FAILED_COST_UNVERIFIED',
  errorCode: error instanceof PlatformDomainError ? error.code : 'AI_PROVIDER_FAILED',
});

const FALLBACK_ELIGIBLE_PROVIDER_ERRORS = new Set([
  'AI_PROVIDER_NOT_CONFIGURED',
  'AI_PROVIDER_HTTP_ERROR',
  'AI_PROVIDER_RATE_NOT_CONFIGURED',
  'AI_PROVIDER_RATE_INVALID',
  'AI_PROVIDER_CURRENCY_UNSUPPORTED',
  'AI_FX_SNAPSHOT_REQUIRED',
  'AI_PROVIDER_USAGE_MISSING',
  'AI_PROVIDER_USAGE_INVALID',
]);

const canTryNextProvider = (error: unknown) => !(error instanceof PlatformDomainError)
  || FALLBACK_ELIGIBLE_PROVIDER_ERRORS.has(error.code);

const economicSnapshot = (snapshot: Prisma.InputJsonValue | undefined, attempts: FailedProviderAttempt[]) => {
  const base = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? snapshot as Prisma.JsonObject : {};
  return (attempts.length ? { ...base, failedProviderAttempts: attempts } : base) as Prisma.InputJsonValue;
};

export class AiGateway {
  private readonly adapters = new Map<string, AiProviderAdapter>();
  private readonly wallet: AiWalletService;
  private readonly pricing: PlatformPricingService;

  constructor(private readonly db: PrismaClient = prisma, adapters: AiProviderAdapter[] = []) {
    this.wallet = new AiWalletService(db);
    this.pricing = new PlatformPricingService(db);
    adapters.forEach((adapter) => this.adapters.set(adapter.providerCode, adapter));
  }

  register(adapter: AiProviderAdapter) {
    this.adapters.set(adapter.providerCode, adapter);
  }

  async execute<T = unknown>(request: AiGatewayRequest): Promise<T> {
    if (!request.idempotencyKey || !request.traceId) {
      throw new PlatformDomainError('AI_IDEMPOTENCY_CONTEXT_REQUIRED', 'La solicitud IA requiere trazabilidad e idempotencia.', 400);
    }
    const operation = await this.db.aiOperationCatalog.findUnique({ where: { operation_code: request.operationCode } });
    if (!operation?.active) throw new PlatformDomainError('AI_OPERATION_DISABLED', 'La operación IA no está disponible.', 409);
    if (!isAiBillingClass(operation.billing_class) || !isAiBillingClass(request.billingClass)) {
      throw new PlatformDomainError('AI_BILLING_CLASS_NOT_CONFIGURED', 'La clasificación de consumo IA no está configurada.', 503);
    }
    const approvedClass = CURRENT_AI_BILLING_CLASS_BY_OPERATION[request.operationCode];
    if (approvedClass && operation.billing_class !== approvedClass) {
      throw new PlatformDomainError('AI_BILLING_CLASS_POLICY_CONFLICT', 'La operación contradice la política de consumo aprobada.', 409);
    }
    if (approvedClass && request.billingClass !== approvedClass
      && !(request.billingClass === 'MIGRATION_INCLUDED' && MIGRATION_INCLUDED_OPERATION_CODES.has(request.operationCode))) {
      throw new PlatformDomainError('AI_BILLING_CLASS_POLICY_CONFLICT', 'La solicitud contradice la política de consumo aprobada.', 409);
    }
    if (request.billingClass === 'PLAN_INCLUDED') {
      throw new PlatformDomainError('AI_PLAN_ENTITLEMENT_NOT_CONFIGURED', 'El plan no incluye esta operación IA.', 403);
    }
    if (request.billingClass === 'PLATFORM_INCLUDED') {
      const administrator = await this.db.platformAdministrator.findUnique({ where: { user_id: request.actor.userId } });
      if (!administrator || administrator.status !== 'ACTIVE' || administrator.revoked_at
        || !Array.isArray(administrator.permissions) || !administrator.permissions.includes('platform.ai.internal')) {
        throw new PlatformDomainError('AI_PLATFORM_INCLUDED_DENIED', 'Esta operación IA es exclusiva de procesos internos.', 403);
      }
    }
    if (request.billingClass === 'MIGRATION_INCLUDED') {
      if (!MIGRATION_INCLUDED_OPERATION_CODES.has(request.operationCode)
        && operation.billing_class !== 'MIGRATION_INCLUDED') {
        throw new PlatformDomainError('AI_MIGRATION_OPERATION_DENIED', 'Esta operación no está autorizada para el costo de migración.', 403);
      }
      if (!request.actor.permissions.includes('platform.migrations.manage')) {
        throw new PlatformDomainError('AI_MIGRATION_PERMISSION_DENIED', 'No tienes permiso para ejecutar IA de migración.', 403);
      }
      if (!request.migrationJobId) throw new PlatformDomainError('AI_MIGRATION_JOB_REQUIRED', 'La operación IA de migración requiere un trabajo válido.', 400);
      const job = await this.db.migrationJob.findFirst({ where: { id: request.migrationJobId, organization_id: request.actor.organizationId } });
      if (!job) throw new PlatformDomainError('AI_MIGRATION_JOB_NOT_FOUND', 'El trabajo de migración no pertenece a esta notaría.', 404);
      if (!job.approved_at || !['MIGRATING', 'VERIFYING'].includes(job.status)) {
        throw new PlatformDomainError('AI_MIGRATION_NOT_APPROVED', 'La migración no está aprobada y activa.', 409);
      }
    } else if (request.billingClass !== operation.billing_class) {
      throw new PlatformDomainError('AI_BILLING_CLASS_MISMATCH', 'La clasificación de consumo IA no corresponde a la operación.', 409);
    }
    if (!request.actor.permissions.includes(operation.required_capability as Permission)) {
      throw new PlatformDomainError('AI_PERMISSION_DENIED', 'No tienes permiso para ejecutar esta operación IA.', 403);
    }
    const candidates = await this.routingCandidates(request.operationCode);
    if (candidates.length === 0) throw new PlatformDomainError('AI_ROUTE_UNAVAILABLE', 'No existe una ruta IA disponible.', 503);
    if (request.billingClass !== 'CUSTOMER_WALLET') return this.executeIncluded<T>(request, operation.allow_fallback, candidates);
    const sku = await this.pricing.activeCommercialSku(`AI_USAGE:${request.operationCode}`);
    if (sku.currency !== 'MXN') throw new PlatformDomainError('AI_PRICE_CURRENCY_UNSUPPORTED', 'La tarifa IA debe estar configurada en MXN.', 503);
    const fixedCharge = sku.sale_price_minor;
    if (operation.max_charge_minor !== null && fixedCharge !== null && fixedCharge > operation.max_charge_minor) {
      throw new PlatformDomainError('AI_PRICE_EXCEEDS_OPERATION_LIMIT', 'La tarifa configurada supera el límite de seguridad de la operación.', 503);
    }
    const maximumCharge = operation.max_charge_minor ?? fixedCharge;
    if (maximumCharge === null || maximumCharge <= 0n) {
      throw new PlatformDomainError('AI_MAX_CHARGE_NOT_CONFIGURED', 'Falta configurar el costo máximo de esta operación IA.', 503);
    }
    const reservation = await this.wallet.reserveAiBalance({
      organizationId: request.actor.organizationId,
      estimatedMaxChargeMinor: maximumCharge,
      idempotencyKey: request.idempotencyKey,
      ttlSeconds: Math.ceil((request.timeoutMs || 120_000) / 1000) + 30,
    });
    // A replay of a settled request or a concurrent request with the same key
    // must not invoke the external provider a second time.
    await this.wallet.claimReservationForExecution({
      organizationId: request.actor.organizationId, reservationId: reservation.id,
    });
    let lastCandidate = candidates[0];
    const failedAttempts: FailedProviderAttempt[] = [];
    try {
      let lastError: unknown;
      for (const [index, candidate] of candidates.entries()) {
        lastCandidate = candidate;
        const adapter = this.adapters.get(candidate.providerCode);
        if (!adapter) { lastError = new PlatformDomainError('AI_PROVIDER_NOT_CONFIGURED', 'El proveedor IA no está configurado.', 503); continue; }
        let result: AiProviderResult<T>;
        try {
          result = await adapter.execute<T>({
            modelCode: candidate.modelCode,
            payload: request.payload,
            timeoutMs: Math.max(1_000, Math.min(request.timeoutMs || 120_000, 300_000)),
            traceId: request.traceId,
          });
        } catch (error) {
          lastError = error;
          failedAttempts.push(failedProviderAttempt(candidate, error));
          if (!operation.allow_fallback || index === candidates.length - 1) break;
          continue;
        }
        try {
          const providerCost = new Prisma.Decimal(result.providerCostAmount);
          if (providerCost.isNegative()) throw new PlatformDomainError('AI_PROVIDER_COST_INVALID', 'El costo del proveedor no es válido.', 503);
          const currency = result.providerCostCurrency.toUpperCase();
          const fxRate = currency === 'MXN' ? new Prisma.Decimal(1) : result.fxRate ? new Prisma.Decimal(result.fxRate) : null;
          if (providerCost.greaterThan(0) && !fxRate) {
            throw new PlatformDomainError('AI_FX_SNAPSHOT_REQUIRED', 'Falta el tipo de cambio verificable del costo IA.', 503);
          }
          const convertedCostMinor = providerCost.mul(fxRate || 1).mul(100);
          const costMinor = BigInt(convertedCostMinor.ceil().toFixed(0));
          const exactFloorMinor = BigInt(convertedCostMinor.mul(2).ceil().toFixed(0));
          const targetMarkup = Prisma.Decimal.max(new Prisma.Decimal(2), sku.min_markup_multiplier);
          const charge = fixedCharge ?? BigInt(convertedCostMinor.mul(targetMarkup).ceil().toFixed(0));
          if (charge > maximumCharge) {
            throw new PlatformDomainError('AI_CHARGE_EXCEEDS_RESERVATION', 'El costo real excede la reserva máxima configurada.', 409);
          }
          const overrideApproved = charge < exactFloorMinor && await this.pricing.hasAuditedMarginOverride({
            skuVersionId: sku.id, organizationId: request.actor.organizationId,
            priceMinor: charge, providerCostMinor: costMinor,
          });
          this.pricing.validateMargin({ salePriceMinor: charge, worstCaseCostMinor: convertedCostMinor, overrideApproved });
          await this.wallet.settleAiUsage({
            organizationId: request.actor.organizationId,
            reservationId: reservation.id,
            userId: request.actor.userId,
            operationCode: request.operationCode,
            providerCode: candidate.providerCode,
            modelCode: candidate.modelCode,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            providerCostAmount: result.providerCostAmount,
            providerCostCurrency: result.providerCostCurrency,
            fxRate: fxRate?.toString(),
            fxSnapshot: economicSnapshot(
              result.fxSnapshot || (currency === 'MXN' ? { currency: 'MXN', rate: '1' } : {}),
              failedAttempts,
            ),
            actualChargeMinor: charge,
            pricingVersionId: sku.id,
            latencyMs: result.latencyMs,
            traceId: request.traceId,
            idempotencyKey: request.idempotencyKey,
          });
          return result.output;
        } catch (error) {
          if (error instanceof PlatformDomainError && ['MARGIN_FLOOR_VIOLATION', 'AI_FX_SNAPSHOT_REQUIRED', 'AI_CHARGE_EXCEEDS_RESERVATION'].includes(error.code)) {
            await this.db.aiUsageEvent.create({ data: {
              organization_id: request.actor.organizationId, user_id: request.actor.userId,
              operation_code: request.operationCode, billing_class: 'CUSTOMER_WALLET',
              provider_code: candidate.providerCode, model_code: candidate.modelCode,
              input_tokens: result.inputTokens, output_tokens: result.outputTokens,
              provider_cost_amount: result.providerCostAmount, provider_cost_currency: result.providerCostCurrency,
              fx_rate: result.fxRate || 1, fx_snapshot: economicSnapshot(result.fxSnapshot, failedAttempts),
              commercial_charge_minor: 0n, wallet_debit_minor: 0n,
              pricing_version_id: sku.id, latency_ms: result.latencyMs,
              status: 'REJECTED', error_code: error.code, trace_id: request.traceId,
              idempotency_key: request.idempotencyKey,
            } });
          }
          throw error;
        }
      }
      throw lastError || new PlatformDomainError('AI_ROUTE_UNAVAILABLE', 'No existe una ruta IA disponible.', 503);
    } catch (error) {
      await this.wallet.releaseAiReservation({ organizationId: request.actor.organizationId, reservationId: reservation.id })
        .catch(() => undefined);
      // A provider failure may have incurred a charge even when no usable
      // usage payload was returned. Preserve an explicit unverified-cost event;
      // never represent this as a verified zero-cost call.
      await this.db.aiUsageEvent.create({ data: {
        organization_id: request.actor.organizationId, user_id: request.actor.userId,
        operation_code: request.operationCode, billing_class: 'CUSTOMER_WALLET',
        provider_code: lastCandidate.providerCode, model_code: lastCandidate.modelCode,
        provider_cost_currency: 'MXN',
        fx_snapshot: { costUnverified: true, failedProviderAttempts: failedAttempts },
        commercial_charge_minor: 0n, wallet_debit_minor: 0n,
        pricing_version_id: sku.id, status: 'FAILED_COST_UNVERIFIED',
        error_code: error instanceof PlatformDomainError ? error.code : 'AI_PROVIDER_FAILED',
        trace_id: request.traceId, idempotency_key: request.idempotencyKey,
      } }).catch(() => undefined);
      throw error;
    }
  }

  private async executeIncluded<T>(request: AiGatewayRequest, allowFallback: boolean, candidates: RoutingCandidate[]): Promise<T> {
    const existing = await this.db.aiUsageEvent.findUnique({ where: {
      organization_id_idempotency_key: { organization_id: request.actor.organizationId, idempotency_key: request.idempotencyKey },
    } });
    if (existing) throw new PlatformDomainError(existing.status === 'PROCESSING' ? 'AI_REQUEST_IN_PROGRESS' : 'AI_REQUEST_ALREADY_COMPLETED',
      'La operación IA ya fue solicitada con esta clave.', 409);
    const first = candidates[0];
    let claim;
    try {
      claim = await this.db.aiUsageEvent.create({ data: {
        organization_id: request.actor.organizationId, user_id: request.actor.userId,
        operation_code: request.operationCode, billing_class: request.billingClass,
        migration_job_id: request.migrationJobId,
        cost_center: request.billingClass === 'MIGRATION_INCLUDED' ? `MIGRATION:${request.migrationJobId}` : 'PLATFORM',
        provider_code: first.providerCode, model_code: first.modelCode,
        provider_cost_currency: 'MXN', commercial_charge_minor: 0n, wallet_debit_minor: 0n,
        status: 'PROCESSING', trace_id: request.traceId, idempotency_key: request.idempotencyKey,
      } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PlatformDomainError('AI_REQUEST_IN_PROGRESS', 'La operación IA ya está en curso.', 409);
      }
      throw error;
    }
    let lastError: unknown;
    const failedAttempts: FailedProviderAttempt[] = [];
    for (const [index, candidate] of candidates.entries()) {
      const adapter = this.adapters.get(candidate.providerCode);
      if (!adapter) { lastError = new PlatformDomainError('AI_PROVIDER_NOT_CONFIGURED', 'El proveedor IA no está configurado.', 503); continue; }
      try {
        const result = await adapter.execute<T>({
          modelCode: candidate.modelCode, payload: request.payload,
          timeoutMs: Math.max(1_000, Math.min(request.timeoutMs || 120_000, 300_000)), traceId: request.traceId,
        });
        await this.db.aiUsageEvent.update({ where: { id: claim.id }, data: {
          provider_code: candidate.providerCode, model_code: candidate.modelCode,
          input_tokens: result.inputTokens, output_tokens: result.outputTokens,
          provider_cost_amount: result.providerCostAmount, provider_cost_currency: result.providerCostCurrency,
          fx_rate: result.fxRate || 1,
          fx_snapshot: economicSnapshot(result.fxSnapshot, failedAttempts),
          latency_ms: result.latencyMs,
          status: 'COMPLETED',
        } });
        return result.output;
      } catch (error) {
        lastError = error;
        failedAttempts.push(failedProviderAttempt(candidate, error));
        if (!allowFallback || index === candidates.length - 1 || !canTryNextProvider(error)) break;
      }
    }
    await this.db.aiUsageEvent.update({ where: { id: claim.id }, data: {
      status: 'FAILED_COST_UNVERIFIED',
      fx_snapshot: { costUnverified: true, failedProviderAttempts: failedAttempts },
      error_code: lastError instanceof PlatformDomainError ? lastError.code : 'AI_PROVIDER_FAILED',
    } });
    throw lastError || new PlatformDomainError('AI_ROUTE_UNAVAILABLE', 'No existe una ruta IA disponible.', 503);
  }

  private async routingCandidates(operationCode: string): Promise<RoutingCandidate[]> {
    const policy = await this.db.aiRoutingPolicyVersion.findFirst({
      where: { operation_code: operationCode, active: true, effective_from: { lte: new Date() } },
      orderBy: { version: 'desc' },
    });
    const rules = policy?.routing_rules_json as { candidates?: RoutingCandidate[] } | null;
    const candidates = Array.isArray(rules?.candidates) ? rules!.candidates : [];
    if (candidates.length === 0) throw new PlatformDomainError('AI_ROUTING_NOT_CONFIGURED', 'La ruta IA todavía no está configurada.', 503);
    const enabled = await this.db.aiModelRegistry.findMany({
      where: { enabled: true, OR: candidates.map((candidate) => ({ provider_code: candidate.providerCode, model_code: candidate.modelCode })) },
    });
    const allowed = new Set(enabled.map((model) => `${model.provider_code}:${model.model_code}`));
    return candidates.filter((candidate) => allowed.has(`${candidate.providerCode}:${candidate.modelCode}`));
  }
}
