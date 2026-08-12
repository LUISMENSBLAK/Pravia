import { describe, expect, it, vi } from 'vitest';
import { reserveExpedienteFolio } from './expedienteFolio.service';

describe('reserva concurrente de folio de expediente', () => {
  it('toma el advisory lock anual antes de leer la secuencia', async () => {
    const order: string[] = [];
    const tx = {
      $executeRaw: vi.fn(async () => { order.push('lock'); return 1; }),
      expediente: { findMany: vi.fn(async () => { order.push('read'); return [{ numero_pravia: 'EXP-2026-0009' }, { numero_pravia: 'EXP-2026-0012' }, { numero_pravia: 'EXP-2026-INVALIDO' }]; }) },
    } as any;
    await expect(reserveExpedienteFolio(tx, new Date('2026-08-12T12:00:00'))).resolves.toBe('EXP-2026-0013');
    expect(order).toEqual(['lock', 'read']);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.expediente.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { numero_pravia: { startsWith: 'EXP-2026-' } } }));
  });

  it('mantiene una secuencia independiente por año dentro de la transacción', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1), expediente: { findMany: vi.fn().mockResolvedValue([]) } } as any;
    await expect(reserveExpedienteFolio(tx, new Date('2027-01-01T12:00:00'))).resolves.toBe('EXP-2027-0001');
  });
});
