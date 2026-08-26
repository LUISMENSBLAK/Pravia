import { describe, expect, it, vi } from 'vitest';
import { reserveExpedienteFolio } from './expedienteFolio.service';

describe('reserva concurrente de folio de expediente', () => {
  it('toma el advisory lock anual y considera formatos históricos y nuevos', async () => {
    const order: string[] = [];
    const tx = {
      $executeRaw: vi.fn(async () => { order.push('lock'); return 1; }),
      expediente: { findMany: vi.fn(async () => { order.push('read'); return [{ numero_pravia: 'EXP-2026-0009' }, { numero_pravia: 'EXP-0012-2026' }, { numero_pravia: 'EXP-2026-INVALIDO' }]; }) },
    } as any;
    await expect(reserveExpedienteFolio(tx, new Date('2026-08-12T12:00:00'))).resolves.toBe('EXP-0013-2026');
    expect(order).toEqual(['lock', 'read']);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.expediente.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: expect.any(Array) } }));
  });

  it('mantiene una secuencia independiente por año dentro de la transacción', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1), expediente: { findMany: vi.fn().mockResolvedValue([]) } } as any;
    await expect(reserveExpedienteFolio(tx, new Date('2027-01-01T12:00:00'))).resolves.toBe('EXP-0001-2027');
  });

  it('no interpreta ni modifica un folio ambiguo', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1), expediente: { findMany: vi.fn().mockResolvedValue([{ numero_pravia: 'EXP/2026/0099' }]) } } as any;
    await expect(reserveExpedienteFolio(tx, new Date('2026-01-01T12:00:00'))).resolves.toBe('EXP-0001-2026');
  });
});
