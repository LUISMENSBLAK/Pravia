import { describe, expect, it, vi } from 'vitest';
import { reserveExpedienteFolio } from './expedienteFolio.service';

describe('reserva concurrente de folio de expediente', () => {
  it('toma el advisory lock anual y considera formatos históricos y nuevos', async () => {
    const order: string[] = [];
const tx = {
      $executeRaw: vi.fn(async () => { order.push('lock'); return 1; }),
      $queryRaw: vi.fn(async () => { order.push('read'); return [{ folio: 'EXP-2026-0009' }, { folio: 'EXP-0012-2026' }, { folio: 'EXP-2026-INVALIDO' }]; }),
      folioCounter: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({ last_value: 13 }) },
    } as any;
    await expect(reserveExpedienteFolio(tx, '10000000-0000-4000-8000-000000000001', new Date('2026-08-12T12:00:00'))).resolves.toBe('EXP-0013-2026');
    expect(order).toEqual(['lock', 'read']);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('mantiene una secuencia independiente por año dentro de la transacción', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1), $queryRaw: vi.fn().mockResolvedValue([]), folioCounter: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({ last_value: 1 }) } } as any;
    await expect(reserveExpedienteFolio(tx, '10000000-0000-4000-8000-000000000001', new Date('2027-01-01T12:00:00'))).resolves.toBe('EXP-0001-2027');
  });

  it('no interpreta ni modifica un folio ambiguo', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1), $queryRaw: vi.fn().mockResolvedValue([{ folio: 'EXP/2026/0099' }]), folioCounter: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({ last_value: 1 }) } } as any;
    await expect(reserveExpedienteFolio(tx, '10000000-0000-4000-8000-000000000001', new Date('2026-01-01T12:00:00'))).resolves.toBe('EXP-0001-2026');
  });
});
