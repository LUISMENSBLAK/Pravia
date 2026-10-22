import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PlatformPricingService } from './pricing.service';

describe('AI commercial margin floor', () => {
  const pricing = new PlatformPricingService({} as never);

  it('rounds the real-cost floor once so a sub-cent provider cost can be charged correctly', () => {
    expect(pricing.validateMargin({ salePriceMinor: 1n, worstCaseCostMinor: new Prisma.Decimal('0.09') }))
      .toMatchObject({ salePriceMinor: '1', floorMinor: '1' });
  });

  it('rejects a configured price below twice the actual provider cost without an audited override', () => {
    expect(() => pricing.validateMargin({ salePriceMinor: 1n, worstCaseCostMinor: new Prisma.Decimal('18') }))
      .toThrowError(expect.objectContaining({ code: 'MARGIN_FLOOR_VIOLATION' }));
    expect(pricing.validateMargin({ salePriceMinor: 1n, worstCaseCostMinor: new Prisma.Decimal('18'),
      overrideApproved: true })).toMatchObject({ overrideRequired: true, floorMinor: '36' });
  });
});
