import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { cfdiIncomeBalance } from './cfdiIncomeBalance';

describe('canonical CFDI V2 income balance', () => {
  it('subtracts issued and reserved drafts without counting cancelled invoices', () => {
    const balance = cfdiIncomeBalance({ amount: new Prisma.Decimal('500.00'), facturaEstado: 'PENDIENTE',
      linked: [{ estado: 'TIMBRADO', total: new Prisma.Decimal('200.00') },
        { estado: 'PREFACTURA', total: new Prisma.Decimal('100.00') },
        { estado: 'CANCELADO', total: new Prisma.Decimal('50.00') }] });
    expect(balance.facturableAmount.toFixed(2)).toBe('500.00');
    expect(balance.invoicedAmount.toFixed(2)).toBe('200.00');
    expect(balance.reservedDraftAmount.toFixed(2)).toBe('100.00');
    expect(balance.remainingInvoiceableAmount.toFixed(2)).toBe('200.00');
  });

  it('preserves the external-loaded invoice fallback only if no issued CFDI is linked', () => {
    const loaded = cfdiIncomeBalance({ amount: new Prisma.Decimal('300.00'), facturaEstado: 'CARGADA', linked: [] });
    expect(loaded.remainingInvoiceableAmount.toFixed(2)).toBe('0.00');
    const issued = cfdiIncomeBalance({ amount: new Prisma.Decimal('300.00'), facturaEstado: 'CARGADA',
      linked: [{ estado: 'VIGENTE', total: new Prisma.Decimal('100.00') }] });
    expect(issued.remainingInvoiceableAmount.toFixed(2)).toBe('200.00');
  });
});
