import { describe, expect, it } from 'vitest';
import { addOperationalDays, formatRemainingBusinessDays, operationalDaysBetween } from './expedienteSeguimiento.service';

const utc = (value: string) => new Date(`${value}T12:00:00.000Z`);

describe('Corrección 017 · días hábiles restantes', () => {
  it('no inicia el contador sin un desbloqueo real', () => {
    expect(formatRemainingBusinessDays(null, 5, utc('2026-09-26'))).toEqual({ value: null, due: null, label: '—', overdue: false });
  });

  it('muestra la duración completa en el instante de desbloqueo', () => {
    expect(formatRemainingBusinessDays(utc('2026-09-25'), 5, utc('2026-09-25'))).toMatchObject({ value: 5, label: '5 DÍAS', overdue: false });
  });

  it('un proceso de un día habilitado en viernes no consume plazo en sábado ni domingo', () => {
    const friday = utc('2026-09-25');
    expect(formatRemainingBusinessDays(friday, 1, utc('2026-09-26')).label).toBe('1 DÍA');
    expect(formatRemainingBusinessDays(friday, 1, utc('2026-09-27')).label).toBe('1 DÍA');
  });

  it('marca HOY el siguiente día hábil del proceso iniciado en viernes', () => {
    expect(formatRemainingBusinessDays(utc('2026-09-25'), 1, utc('2026-09-28'))).toMatchObject({ value: 0, label: 'HOY', overdue: false });
  });

  it('muestra un día vencido sólo al avanzar otro día hábil', () => {
    expect(formatRemainingBusinessDays(utc('2026-09-25'), 1, utc('2026-09-29'))).toMatchObject({ value: -1, label: '1 DÍA VENCIDO', overdue: true });
  });

  it('atraviesa varios fines de semana sin desfase de uno', () => {
    const start = utc('2026-09-18');
    expect(addOperationalDays(start, 6, 'HABILES')).toEqual(utc('2026-09-28'));
    expect(formatRemainingBusinessDays(start, 6, utc('2026-09-25'))).toMatchObject({ value: 1, label: '1 DÍA' });
    expect(formatRemainingBusinessDays(start, 6, utc('2026-09-28'))).toMatchObject({ value: 0, label: 'HOY' });
  });

  it('cuenta exclusivamente lunes a viernes en ambas direcciones del motor', () => {
    expect(operationalDaysBetween(utc('2026-09-25'), utc('2026-09-28'), 'HABILES')).toBe(1);
    expect(operationalDaysBetween(utc('2026-09-25'), utc('2026-09-28'), 'NATURALES')).toBe(3);
  });

  it('mantiene el vencimiento como alerta sin producir ningún estado de completado', () => {
    expect(formatRemainingBusinessDays(utc('2026-09-21'), 2, utc('2026-09-28'))).toEqual(expect.objectContaining({ value: -3, label: '3 DÍAS VENCIDO', overdue: true }));
  });
});
