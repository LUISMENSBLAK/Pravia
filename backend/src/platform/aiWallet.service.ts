import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { PlatformDomainError, serializeBigInts } from './platform.errors';

export const PROMOTIONAL_AI_CREDIT_MINOR = 300_000n;

const positiveMinor = (amount: bigint | number | string) => {
  const parsed = BigInt(amount);
  if (parsed <= 0n) throw new PlatformDomainError('INVALID_AI_CHARGE', 'El importe debe ser mayor que cero.', 400);
  return parsed;
};

const nonNegativeMinor = (amount: bigint | number | string) => {
  const parsed = BigInt(amount);
  if (parsed < 0n) throw new PlatformDomainError('INVALID_AI_CHARGE', 'El importe no puede ser negativo.', 400);
  return parsed;
};

export class AiWalletService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async serializable<T>(callback: Parameters<PrismaClient['$transaction']>[0] extends (tx: infer U) => unknown ? (tx: U) => Promise<T> : never): Promise<T> {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await this.db.$transaction(callback as never, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }) as T;
      } catch (error) {
        const sqlState = error instanceof Prisma.PrismaClientKnownRequestError
          ? String((error.meta as { code?: unknown } | undefined)?.code || '')
          : '';
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError
          && (error.code === 'P2034' || (error.code === 'P2010' && ['40001', '40P01'].includes(sqlState)));
        if (!retryable || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 10));
      }
    }
    throw new PlatformDomainError('AI_CONCURRENCY_RETRY_EXHAUSTED', 'No fue posible reservar saldo IA de forma segura.', 503);
  }

  async getWallet(organizationId: string) {
    const wallet = await this.db.aiWallet.findUnique({ where: { organization_id: organizationId } });
    if (!wallet) throw new PlatformDomainError('AI_WALLET_NOT_INITIALIZED', 'El saldo IA no está inicializado.', 503);
    const reserved = await this.db.aiBalanceReservation.aggregate({
      where: { organization_id: organizationId, status: { in: ['RESERVED', 'PROCESSING'] }, expires_at: { gt: new Date() } },
      _sum: { estimated_max_charge_minor: true },
    });
    const reservedMinor = reserved._sum.estimated_max_charge_minor || 0n;
    return serializeBigInts({ ...wallet, reserved_minor: reservedMinor, available_minor: wallet.balance_minor - reservedMinor });
  }

  async reserveAiBalance(input: {
    organizationId: string;
    estimatedMaxChargeMinor: bigint | number | string;
    idempotencyKey: string;
    ttlSeconds?: number;
  }) {
    const amount = positiveMinor(input.estimatedMaxChargeMinor);
    const expiresAt = new Date(Date.now() + Math.max(30, Math.min(input.ttlSeconds || 300, 3600)) * 1000);
    if (!input.idempotencyKey) throw new PlatformDomainError('IDEMPOTENCY_KEY_REQUIRED', 'La clave de idempotencia es obligatoria.', 400);
    return this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT organization_id FROM ai_wallets WHERE organization_id = ${input.organizationId}::uuid FOR UPDATE`;
      const existing = await tx.aiBalanceReservation.findUnique({
        where: { organization_id_idempotency_key: { organization_id: input.organizationId, idempotency_key: input.idempotencyKey } },
      });
      if (existing) {
        if (existing.estimated_max_charge_minor !== amount) throw new PlatformDomainError('IDEMPOTENCY_CONFLICT', 'La reserva IA existente no coincide con la solicitud.');
        return serializeBigInts(existing);
      }
      const wallet = await tx.aiWallet.findUnique({ where: { organization_id: input.organizationId } });
      if (!wallet || wallet.status !== 'ACTIVE') throw new PlatformDomainError('AI_WALLET_UNAVAILABLE', 'El saldo IA no está disponible.', 503);
      const active = await tx.aiBalanceReservation.aggregate({
        where: { organization_id: input.organizationId, status: { in: ['RESERVED', 'PROCESSING'] }, expires_at: { gt: new Date() } },
        _sum: { estimated_max_charge_minor: true },
      });
      const available = wallet.balance_minor - (active._sum.estimated_max_charge_minor || 0n);
      if (available < amount) {
        throw new PlatformDomainError('AI_BALANCE_EXHAUSTED', 'Tu saldo IA se ha agotado. Recarga para continuar utilizando las funciones inteligentes.', 402, {
          balanceMinor: wallet.balance_minor.toString(), availableMinor: available.toString(), requiredMinor: amount.toString(),
        });
      }
      return serializeBigInts(await tx.aiBalanceReservation.create({ data: {
        organization_id: input.organizationId,
        estimated_max_charge_minor: amount,
        status: 'RESERVED',
        expires_at: expiresAt,
        idempotency_key: input.idempotencyKey,
      } }));
    });
  }

  async claimReservationForExecution(input: { organizationId: string; reservationId: string }) {
    const claimed = await this.db.aiBalanceReservation.updateMany({ where: {
      id: input.reservationId, organization_id: input.organizationId,
      status: 'RESERVED', expires_at: { gt: new Date() },
    }, data: { status: 'PROCESSING' } });
    if (claimed.count === 1) return;
    const reservation = await this.db.aiBalanceReservation.findFirst({ where: {
      id: input.reservationId, organization_id: input.organizationId,
    } });
    if (!reservation) throw new PlatformDomainError('AI_RESERVATION_NOT_FOUND', 'La reserva IA no existe.', 404);
    if (reservation.status === 'SETTLED') throw new PlatformDomainError('AI_REQUEST_ALREADY_COMPLETED', 'La operación IA ya se completó con esta clave.', 409);
    if (reservation.status === 'PROCESSING') throw new PlatformDomainError('AI_REQUEST_IN_PROGRESS', 'La operación IA ya está en curso.', 409);
    throw new PlatformDomainError('AI_RESERVATION_NOT_ACTIVE', 'La reserva IA ya no está activa.', 409);
  }

  async settleAiUsage(input: {
    organizationId: string;
    reservationId: string;
    userId: string;
    operationCode: string;
    providerCode: string;
    modelCode: string;
    inputTokens?: number;
    outputTokens?: number;
    providerCostAmount?: Prisma.Decimal.Value;
    providerCostCurrency?: string;
    fxRate?: Prisma.Decimal.Value;
    fxSnapshot?: Prisma.InputJsonValue;
    actualChargeMinor: bigint | number | string;
    pricingVersionId?: string;
    latencyMs?: number;
    traceId: string;
    idempotencyKey?: string;
    status?: string;
    errorCode?: string;
  }) {
    const charge = nonNegativeMinor(input.actualChargeMinor);
    return this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT organization_id FROM ai_wallets WHERE organization_id = ${input.organizationId}::uuid FOR UPDATE`;
      const reservation = await tx.aiBalanceReservation.findFirst({ where: { id: input.reservationId, organization_id: input.organizationId } });
      if (!reservation) throw new PlatformDomainError('AI_RESERVATION_NOT_FOUND', 'La reserva IA no existe.', 404);
      if (reservation.status === 'SETTLED' && reservation.usage_event_id) {
        return serializeBigInts(await tx.aiUsageEvent.findUniqueOrThrow({ where: { id: reservation.usage_event_id } }));
      }
      if (!['RESERVED', 'PROCESSING'].includes(reservation.status)) throw new PlatformDomainError('AI_RESERVATION_NOT_ACTIVE', 'La reserva IA ya no está activa.');
      if (charge > reservation.estimated_max_charge_minor) {
        throw new PlatformDomainError('AI_CHARGE_EXCEEDS_RESERVATION', 'El consumo real supera la reserva máxima y requiere revisión.', 409);
      }
      const wallet = await tx.aiWallet.findUniqueOrThrow({ where: { organization_id: input.organizationId } });
      if (wallet.balance_minor < charge) throw new PlatformDomainError('AI_BALANCE_EXHAUSTED', 'Tu saldo IA se ha agotado. Recarga para continuar utilizando las funciones inteligentes.', 402);
      const usage = await tx.aiUsageEvent.create({ data: {
        organization_id: input.organizationId,
        user_id: input.userId,
        operation_code: input.operationCode,
        billing_class: 'CUSTOMER_WALLET',
        provider_code: input.providerCode,
        model_code: input.modelCode,
        input_tokens: input.inputTokens || 0,
        output_tokens: input.outputTokens || 0,
        provider_cost_amount: input.providerCostAmount || 0,
        provider_cost_currency: input.providerCostCurrency || 'USD',
        fx_rate: input.fxRate || 1,
        fx_snapshot: input.fxSnapshot || {},
        commercial_charge_minor: charge,
        wallet_debit_minor: charge,
        pricing_version_id: input.pricingVersionId,
        latency_ms: input.latencyMs,
        status: input.status || 'COMPLETED',
        error_code: input.errorCode,
        trace_id: input.traceId,
        idempotency_key: input.idempotencyKey || reservation.idempotency_key,
      } });
      if (charge > 0n) {
        await tx.aiWalletTransaction.create({ data: {
          organization_id: input.organizationId,
          type: 'USAGE_DEBIT',
          amount_minor: -charge,
          usage_event_id: usage.id,
          idempotency_key: `usage:${reservation.id}`,
        } });
        await tx.aiWallet.update({
          where: { organization_id: input.organizationId },
          data: { balance_minor: { decrement: charge }, version: { increment: 1 } },
        });
      }
      await tx.aiBalanceReservation.update({
        where: { id: reservation.id },
        data: { status: 'SETTLED', settled_at: new Date(), usage_event_id: usage.id },
      });
      return serializeBigInts(usage);
    });
  }

  async releaseAiReservation(input: { organizationId: string; reservationId: string }) {
    return this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT organization_id FROM ai_wallets WHERE organization_id = ${input.organizationId}::uuid FOR UPDATE`;
      const reservation = await tx.aiBalanceReservation.findFirst({ where: { id: input.reservationId, organization_id: input.organizationId } });
      if (!reservation) throw new PlatformDomainError('AI_RESERVATION_NOT_FOUND', 'La reserva IA no existe.', 404);
      if (reservation.status === 'RELEASED') return serializeBigInts(reservation);
      if (!['RESERVED', 'PROCESSING'].includes(reservation.status)) throw new PlatformDomainError('AI_RESERVATION_NOT_ACTIVE', 'La reserva IA ya no está activa.');
      return serializeBigInts(await tx.aiBalanceReservation.update({ where: { id: reservation.id }, data: { status: 'RELEASED', settled_at: new Date() } }));
    });
  }

  async applyTopup(input: { organizationId: string; amountMinor: bigint | number | string; idempotencyKey: string; paymentRef: string }) {
    const amount = positiveMinor(input.amountMinor);
    return this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT organization_id FROM ai_wallets WHERE organization_id = ${input.organizationId}::uuid FOR UPDATE`;
      const existing = await tx.aiWalletTransaction.findUnique({
        where: { organization_id_idempotency_key: { organization_id: input.organizationId, idempotency_key: input.idempotencyKey } },
      });
      if (existing) return serializeBigInts(existing);
      const transaction = await tx.aiWalletTransaction.create({ data: {
        organization_id: input.organizationId, type: 'PAID_TOPUP', amount_minor: amount,
        payment_ref: input.paymentRef, idempotency_key: input.idempotencyKey,
      } });
      await tx.aiWallet.update({ where: { organization_id: input.organizationId }, data: { balance_minor: { increment: amount }, version: { increment: 1 } } });
      return serializeBigInts(transaction);
    });
  }
}

export const aiWalletService = new AiWalletService();
