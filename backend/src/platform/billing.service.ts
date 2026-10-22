import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { PlatformDomainError, serializeBigInts } from './platform.errors';

export type BillingWebhookEvent = {
  eventId: string;
  type: 'AI_TOPUP_PAID' | 'STORAGE_ADDON_PAID' | 'SUBSCRIPTION_PAID' | 'PAYMENT_REFUNDED' | 'PAYMENT_CHARGEBACK';
  organizationId: string;
  reference: string;
  amountMinor: bigint;
  currency: 'MXN';
  occurredAt: Date;
  metadata?: { addonVersionId?: string; quantity?: number; periodStart?: string; periodEnd?: string; originalEventId?: string };
};

export interface BillingProvider {
  readonly code: string;
  createSubscription(input: { organizationId: string; planVersionId: string; idempotencyKey: string }): Promise<{ reference: string }>;
  updateSubscription(input: { reference: string; planVersionId: string; idempotencyKey: string }): Promise<void>;
  cancelSubscription(input: { reference: string; idempotencyKey: string }): Promise<void>;
  createOneTimePayment(input: { organizationId: string; sku: string; amountMinor: bigint; idempotencyKey: string }): Promise<{ reference: string }>;
  getPaymentStatus(reference: string): Promise<'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CHARGEBACK'>;
  refund(input: { reference: string; amountMinor: bigint; idempotencyKey: string }): Promise<{ reference: string }>;
  verifyWebhook(payload: Buffer, signature: string): Promise<BillingWebhookEvent>;
}

type ProcessingResult = { duplicate: boolean; eventId: string; status: string };

export class BillingService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async receiveVerifiedWebhook(provider: BillingProvider, payload: Buffer, signature: string): Promise<ProcessingResult> {
    if (!signature) throw new PlatformDomainError('BILLING_SIGNATURE_REQUIRED', 'La firma del webhook es obligatoria.', 401);
    const event = await provider.verifyWebhook(payload, signature);
    if (!event.eventId || !event.organizationId || !event.reference || event.currency !== 'MXN' || event.amountMinor <= 0n) {
      throw new PlatformDomainError('BILLING_EVENT_INVALID', 'El evento de cobro no tiene los datos exigidos.', 400);
    }
    if (!(event.occurredAt instanceof Date) || Number.isNaN(event.occurredAt.getTime())) {
      throw new PlatformDomainError('BILLING_EVENT_INVALID', 'La fecha del evento de cobro no es válida.', 400);
    }
    const digest = createHash('sha256').update(payload).digest('hex');
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${event.organizationId}::uuid FOR UPDATE`;
          const existing = await tx.billingEvent.findUnique({
            where: { provider_code_provider_event_id: { provider_code: provider.code, provider_event_id: event.eventId } },
          });
          if (existing) {
            if (existing.organization_id !== event.organizationId || existing.payload_digest !== digest || existing.event_type !== event.type) {
              throw new PlatformDomainError('BILLING_EVENT_REPLAY_CONFLICT', 'El identificador del evento ya corresponde a otro contenido.', 409);
            }
            return { duplicate: true, eventId: existing.id, status: existing.status };
          }

          const bill = await tx.billingEvent.create({ data: {
            organization_id: event.organizationId,
            provider_code: provider.code,
            provider_event_id: event.eventId,
            event_type: event.type,
            status: 'PROCESSING',
            payload_digest: digest,
          } });
          if (event.type === 'AI_TOPUP_PAID') await this.creditTopup(tx, event);
          else if (event.type === 'STORAGE_ADDON_PAID') await this.activatePaidAddon(tx, event);
          else if (event.type === 'SUBSCRIPTION_PAID') await this.recordPaidCycle(tx, event);
          else await this.reverseWalletPayment(tx, event, provider.code);

          await tx.billingEvent.update({ where: { id: bill.id }, data: { status: 'APPLIED' } });
          return { duplicate: false, eventId: bill.id, status: 'APPLIED' };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        const sqlState = error instanceof Prisma.PrismaClientKnownRequestError
          ? String((error.meta as { code?: unknown } | undefined)?.code || '')
          : '';
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError
          && (error.code === 'P2034' || (error.code === 'P2010' && ['40001', '40P01'].includes(sqlState)));
        if (!retryable || attempt === 4) throw error;
      }
    }
    throw new PlatformDomainError('BILLING_CONCURRENCY_RETRY_EXHAUSTED', 'El evento de cobro requiere reintento.', 503);
  }

  private async creditTopup(tx: Prisma.TransactionClient, event: BillingWebhookEvent) {
    const wallet = await tx.aiWallet.findUnique({ where: { organization_id: event.organizationId } });
    if (!wallet || wallet.currency !== event.currency) throw new PlatformDomainError('AI_WALLET_UNAVAILABLE', 'El saldo IA no está disponible para acreditar.', 503);
    const key = `billing:${event.eventId}`;
    await tx.aiWalletTransaction.create({ data: {
      organization_id: event.organizationId,
      type: 'PAID_TOPUP',
      amount_minor: event.amountMinor,
      payment_ref: event.reference,
      idempotency_key: key,
    } });
    await tx.aiWallet.update({
      where: { organization_id: event.organizationId },
      data: { balance_minor: { increment: event.amountMinor }, version: { increment: 1 } },
    });
  }

  private async activatePaidAddon(tx: Prisma.TransactionClient, event: BillingWebhookEvent) {
    const addonVersionId = event.metadata?.addonVersionId;
    const quantity = event.metadata?.quantity;
    if (!addonVersionId || !Number.isInteger(quantity) || !quantity || quantity <= 0) {
      throw new PlatformDomainError('BILLING_ADDON_DETAILS_REQUIRED', 'El evento no identifica el add-on y su cantidad.', 400);
    }
    const version = await tx.storageAddonVersion.findFirst({
      where: {
        id: addonVersionId,
        active: true,
        effective_from: { lte: event.occurredAt },
        OR: [{ effective_to: null }, { effective_to: { gt: event.occurredAt } }],
      },
    });
    if (!version || version.monthly_price_minor === null || version.currency !== event.currency) {
      throw new PlatformDomainError('COMMERCIAL_PRICE_NOT_CONFIGURED', 'El add-on no tiene tarifa vigente para el evento.', 503);
    }
    if (version.monthly_price_minor * BigInt(quantity) !== event.amountMinor) {
      throw new PlatformDomainError('BILLING_AMOUNT_MISMATCH', 'El importe pagado no coincide con la tarifa vigente.', 409);
    }
    await tx.tenantStorageAddon.create({ data: {
      organization_id: event.organizationId,
      addon_version_id: version.id,
      quantity,
      status: 'ACTIVE',
      effective_from: event.occurredAt,
      price_snapshot_minor: event.amountMinor,
      currency: event.currency,
      idempotency_key: `billing:${event.eventId}`,
    } });
    const capacity = version.capacity_bytes * BigInt(quantity);
    await tx.tenantEntitlement.update({
      where: { organization_id: event.organizationId },
      data: {
        addon_storage_bytes: { increment: capacity },
        total_storage_capacity_bytes: { increment: capacity },
        version: { increment: 1 },
      },
    });
  }

  private async recordPaidCycle(tx: Prisma.TransactionClient, event: BillingWebhookEvent) {
    const start = event.metadata?.periodStart ? new Date(event.metadata.periodStart) : null;
    const end = event.metadata?.periodEnd ? new Date(event.metadata.periodEnd) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      throw new PlatformDomainError('BILLING_PERIOD_INVALID', 'El periodo de suscripción no es válido.', 400);
    }
    const subscription = await tx.tenantSubscription.findFirst({
      where: { organization_id: event.organizationId, status: { not: 'CANCELLED' } },
      orderBy: { created_at: 'desc' },
    });
    if (!subscription) throw new PlatformDomainError('SUBSCRIPTION_NOT_FOUND', 'La organización no tiene suscripción vigente.', 409);
    const plan = await tx.planVersion.findUniqueOrThrow({ where: { id: subscription.plan_version_id } });
    if (plan.monthly_price_minor === null || plan.currency !== event.currency || plan.monthly_price_minor !== event.amountMinor) {
      throw new PlatformDomainError('BILLING_AMOUNT_MISMATCH', 'El cobro no coincide con el precio versionado del plan.', 409);
    }
    await tx.billingCycle.create({ data: {
      organization_id: event.organizationId,
      period_start: start,
      period_end: end,
      subscription_amount: event.amountMinor,
      currency: event.currency,
      status: 'PAID',
      provider_invoice_ref: event.reference,
    } });
    await tx.tenantSubscription.update({
      where: { id: subscription.id },
      data: { status: 'ACTIVE', current_period_start: start, current_period_end: end },
    });
  }

  private async reverseWalletPayment(tx: Prisma.TransactionClient, event: BillingWebhookEvent, providerCode: string) {
    const originalEventId = event.metadata?.originalEventId;
    if (!originalEventId) throw new PlatformDomainError('BILLING_ORIGINAL_EVENT_REQUIRED', 'La reversa exige el evento original.', 400);
    const original = await tx.billingEvent.findUnique({
      where: { provider_code_provider_event_id: { provider_code: providerCode, provider_event_id: originalEventId } },
    });
    if (!original || original.organization_id !== event.organizationId || original.event_type !== 'AI_TOPUP_PAID' || original.status !== 'APPLIED') {
      throw new PlatformDomainError('BILLING_ORIGINAL_EVENT_INVALID', 'No existe una recarga válida para revertir.', 409);
    }
    const credited = await tx.aiWalletTransaction.findUnique({
      where: { organization_id_idempotency_key: { organization_id: event.organizationId, idempotency_key: `billing:${originalEventId}` } },
    });
    if (!credited || credited.amount_minor !== event.amountMinor) {
      throw new PlatformDomainError('BILLING_AMOUNT_MISMATCH', 'La reversa no coincide con la recarga original.', 409);
    }
    const wallet = await tx.aiWallet.findUniqueOrThrow({ where: { organization_id: event.organizationId } });
    if (wallet.balance_minor < event.amountMinor) {
      throw new PlatformDomainError('BILLING_REVERSAL_REVIEW_REQUIRED', 'La recarga ya fue consumida y requiere resolución manual.', 409);
    }
    await tx.aiWalletTransaction.create({ data: {
      organization_id: event.organizationId,
      type: event.type === 'PAYMENT_REFUNDED' ? 'REFUND' : 'CHARGEBACK',
      amount_minor: -event.amountMinor,
      payment_ref: event.reference,
      idempotency_key: `billing:${event.eventId}`,
    } });
    await tx.aiWallet.update({
      where: { organization_id: event.organizationId },
      data: { balance_minor: { decrement: event.amountMinor }, version: { increment: 1 } },
    });
  }
}

export const billingService = new BillingService();
