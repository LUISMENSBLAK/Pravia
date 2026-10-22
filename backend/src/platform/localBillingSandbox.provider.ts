import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { BillingProvider, BillingWebhookEvent } from './billing.service';
import { PlatformDomainError } from './platform.errors';

type PaymentState = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CHARGEBACK';

/** Deterministic local adapter. It never represents a real charge. */
export class LocalBillingSandboxProvider implements BillingProvider {
  readonly code = 'LOCAL_QA_BILLING';
  private readonly payments = new Map<string, PaymentState>();
  private readonly subscriptions = new Map<string, { planVersionId: string; status: 'PENDING' | 'ACTIVE' | 'CANCELLED' }>();
  private readonly idempotency = new Map<string, string>();

  constructor(private readonly signingSecret: string) {
    if (signingSecret.length < 32) throw new PlatformDomainError('BILLING_SANDBOX_SECRET_WEAK', 'El secreto sandbox debe tener al menos 32 caracteres.', 500);
  }

  async createSubscription(input: { planVersionId: string; idempotencyKey: string }) {
    const existing = this.idempotency.get(`subscription:${input.idempotencyKey}`);
    if (existing) return { reference: existing };
    const reference = `local-sub-${randomUUID()}`;
    this.idempotency.set(`subscription:${input.idempotencyKey}`, reference);
    this.subscriptions.set(reference, { planVersionId: input.planVersionId, status: 'PENDING' });
    return { reference };
  }

  async updateSubscription(input: { reference: string; planVersionId: string; idempotencyKey: string }) {
    const subscription = this.subscriptions.get(input.reference);
    if (!subscription || subscription.status === 'CANCELLED') throw new PlatformDomainError('BILLING_SUBSCRIPTION_NOT_FOUND', 'La suscripción sandbox no está activa.', 404);
    const key = `subscription-update:${input.idempotencyKey}`;
    const previous = this.idempotency.get(key);
    if (previous && previous !== `${input.reference}:${input.planVersionId}`) throw new PlatformDomainError('BILLING_IDEMPOTENCY_CONFLICT', 'La clave ya corresponde a otra actualización.', 409);
    this.idempotency.set(key, `${input.reference}:${input.planVersionId}`);
    subscription.planVersionId = input.planVersionId;
  }

  async cancelSubscription(input: { reference: string; idempotencyKey: string }) {
    const subscription = this.subscriptions.get(input.reference);
    if (!subscription) throw new PlatformDomainError('BILLING_SUBSCRIPTION_NOT_FOUND', 'La suscripción sandbox no existe.', 404);
    this.idempotency.set(`subscription-cancel:${input.idempotencyKey}`, input.reference);
    subscription.status = 'CANCELLED';
  }

  async createOneTimePayment(input: { amountMinor: bigint; idempotencyKey: string }) {
    if (input.amountMinor <= 0n) throw new PlatformDomainError('BILLING_AMOUNT_INVALID', 'El importe debe ser positivo.', 400);
    const existing = this.idempotency.get(`payment:${input.idempotencyKey}`);
    if (existing) return { reference: existing };
    const reference = `local-pay-${randomUUID()}`;
    this.idempotency.set(`payment:${input.idempotencyKey}`, reference);
    this.payments.set(reference, 'PENDING');
    return { reference };
  }

  async getPaymentStatus(reference: string) { return this.payments.get(reference) || 'FAILED' as const; }

  async refund(input: { reference: string; amountMinor: bigint; idempotencyKey: string }) {
    const existing = this.idempotency.get(`refund:${input.idempotencyKey}`);
    if (existing) return { reference: existing };
    if (this.payments.get(input.reference) !== 'PAID' || input.amountMinor <= 0n) {
      throw new PlatformDomainError('BILLING_REFUND_INVALID', 'Sólo un pago confirmado admite devolución.', 409);
    }
    const reference = `local-refund-${randomUUID()}`;
    this.idempotency.set(`refund:${input.idempotencyKey}`, reference);
    this.payments.set(input.reference, 'REFUNDED');
    return { reference };
  }

  /** Test-only confirmation; there is deliberately no public production route. */
  confirm(reference: string) {
    if (!this.payments.has(reference)) throw new PlatformDomainError('BILLING_PAYMENT_NOT_FOUND', 'El pago sandbox no existe.', 404);
    this.payments.set(reference, 'PAID');
  }

  /** Test-only terminal transitions; neither method is exposed by production routes. */
  fail(reference: string) {
    if (this.payments.get(reference) !== 'PENDING') throw new PlatformDomainError('BILLING_PAYMENT_STATE_INVALID', 'El pago sandbox no está pendiente.', 409);
    this.payments.set(reference, 'FAILED');
  }

  chargeback(reference: string) {
    if (this.payments.get(reference) !== 'PAID') throw new PlatformDomainError('BILLING_PAYMENT_STATE_INVALID', 'Sólo un pago confirmado admite contracargo.', 409);
    this.payments.set(reference, 'CHARGEBACK');
  }

  getSubscriptionState(reference: string) {
    const subscription = this.subscriptions.get(reference);
    return subscription ? { ...subscription } : null;
  }

  sign(payload: Buffer) { return createHmac('sha256', this.signingSecret).update(payload).digest('hex'); }

  async verifyWebhook(payload: Buffer, signature: string): Promise<BillingWebhookEvent> {
    const expected = Buffer.from(this.sign(payload), 'hex');
    let received: Buffer;
    try { received = Buffer.from(signature, 'hex'); } catch { throw new PlatformDomainError('BILLING_SIGNATURE_INVALID', 'La firma sandbox no es válida.', 401); }
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new PlatformDomainError('BILLING_SIGNATURE_INVALID', 'La firma sandbox no es válida.', 401);
    const event = JSON.parse(payload.toString('utf8')) as any;
    return { ...event, amountMinor: BigInt(event.amountMinor), occurredAt: new Date(event.occurredAt) } as BillingWebhookEvent;
  }
}
