import { afterEach, describe, expect, it, vi } from 'vitest';
import { settleMiDiaSource } from './miDiaSourceSettlement';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Mi Día · aislamiento de fuentes', () => {
  it('un 500 de una fuente no altera el resultado de otra ni se convierte en cero', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const [failed, healthy] = await Promise.all([
      settleMiDiaSource(Promise.reject(new Error('QA_SOURCE_500'))),
      settleMiDiaSource(Promise.resolve({ count: 3, amount: '125.00' })),
    ]);
    expect(failed).toEqual({ ok: false });
    expect(healthy).toEqual({ ok: true, value: { count: 3, amount: '125.00' } });
  });

  it('una fuente que no responde vence su plazo y deja disponibles las demás', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pending = settleMiDiaSource(new Promise<never>(() => undefined), 100);
    const healthy = settleMiDiaSource(Promise.resolve({ count: 1 }), 100);
    await vi.advanceTimersByTimeAsync(101);
    expect(await pending).toEqual({ ok: false });
    expect(await healthy).toEqual({ ok: true, value: { count: 1 } });
  });
});
