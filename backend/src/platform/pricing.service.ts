import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { PlatformDomainError, serializeBigInts } from './platform.errors';

export const MINIMUM_MARKUP_MULTIPLIER = 2;

export class PlatformPricingService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async activeCommercialSku(sku: string, at = new Date()) {
    const version = await this.db.commercialSkuVersion.findFirst({
      where: {
        sku,
        active: true,
        effective_from: { lte: at },
        OR: [{ effective_to: null }, { effective_to: { gt: at } }],
      },
      orderBy: { version: 'desc' },
    });
    if (!version) {
      throw new PlatformDomainError('COMMERCIAL_PRICE_NOT_CONFIGURED', 'La tarifa comercial todavía no está configurada.', 503);
    }
    return version;
  }

  validateMargin(input: { salePriceMinor: bigint; worstCaseCostMinor: bigint | Prisma.Decimal; overrideApproved?: boolean }) {
    const cost = new Prisma.Decimal(String(input.worstCaseCostMinor));
    if (cost.isNegative() || input.salePriceMinor < 0n) {
      throw new PlatformDomainError('INVALID_PRICE', 'El precio y el costo deben ser no negativos.', 400);
    }
    const floor = BigInt(cost.mul(MINIMUM_MARKUP_MULTIPLIER).ceil().toFixed(0));
    if (input.salePriceMinor < floor && !input.overrideApproved) {
      throw new PlatformDomainError('MARGIN_FLOOR_VIOLATION', 'El precio es inferior al piso de margen configurado.', 409, {
        salePriceMinor: input.salePriceMinor.toString(), floorMinor: floor.toString(),
      });
    }
    return serializeBigInts({ salePriceMinor: input.salePriceMinor, floorMinor: floor, overrideRequired: input.salePriceMinor < floor });
  }

  async hasAuditedMarginOverride(input: {
    skuVersionId: string;
    organizationId: string;
    priceMinor: bigint;
    providerCostMinor: bigint;
  }): Promise<boolean> {
    const override = await this.db.pricingOverride.findFirst({ where: {
      sku_version_id: input.skuVersionId, organization_id: input.organizationId,
      new_price_minor: input.priceMinor, calculated_cost_minor: input.providerCostMinor,
    }, orderBy: { created_at: 'desc' } });
    if (!override?.reason.trim()) return false;
    const approver = await this.db.platformAdministrator.findFirst({ where: {
      id: override.approved_by_platform_id, status: 'ACTIVE', revoked_at: null,
    } });
    if (!approver || !Array.isArray(approver.permissions)
      || !approver.permissions.includes('platform.pricing.override')) return false;
    const audit = await this.db.platformAuditEvent.findFirst({ where: {
      platform_actor_id: approver.id, organization_id: input.organizationId,
      action: 'AI_MARGIN_OVERRIDE_APPROVED', target_type: 'PricingOverride', target_id: override.id,
    } });
    return Boolean(audit?.reason?.trim());
  }
}

export const platformPricingService = new PlatformPricingService();
