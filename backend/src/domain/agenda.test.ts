import { describe, expect, it } from 'vitest';
import { agendaRangesOverlap, canAssignAgendaResponsibility, normalizeAgendaType, normalizeReminders, parseAgendaRange } from './agenda';

describe('reglas de agenda', () => {
  it('acepta todos los tipos operativos de PRAVIA', () => {
    expect(normalizeAgendaType('notaria')).toBe('NOTARIA');
    expect(normalizeAgendaType('seguimiento')).toBe('SEGUIMIENTO');
  });

  it('rechaza tipos libres', () => {
    expect(() => normalizeAgendaType('reunión inventada')).toThrow();
  });

  it('impide rangos cronológicos inválidos', () => {
    expect(() => parseAgendaRange({ fechaInicio: '2026-08-12T12:00:00-06:00', fechaFin: '2026-08-12T11:00:00-06:00' })).toThrow();
  });

  it('exige una zona horaria explícita para evitar fechas ambiguas', () => {
    expect(() => parseAgendaRange({ fechaInicio: '2026-08-12T12:00:00' })).toThrow(/zona horaria/i);
    expect(parseAgendaRange({ fechaInicio: '2026-08-12T12:00:00-06:00' }).start.toISOString()).toBe('2026-08-12T18:00:00.000Z');
  });

  it('detecta traslapes y aplica treinta minutos a eventos sin fin', () => {
    const base = new Date('2026-08-12T18:00:00.000Z');
    expect(agendaRangesOverlap({ start: base }, { start: new Date('2026-08-12T18:20:00.000Z'), end: new Date('2026-08-12T19:00:00.000Z') })).toBe(true);
    expect(agendaRangesOverlap({ start: base }, { start: new Date('2026-08-12T18:30:00.000Z') })).toBe(false);
  });

  it('normaliza y ordena recordatorios sin duplicados', () => {
    expect(normalizeReminders([60, 15, 60])).toEqual([15, 60]);
  });

  it('impide que un abogado asigne a la primera persona del catálogo', () => {
    const actor = { id: 'luis', rol: 'ABOGADO' };
    expect(canAssignAgendaResponsibility(actor, 'luis')).toBe(true);
    expect(canAssignAgendaResponsibility(actor, 'ana')).toBe(false);
  });

  it('permite que Dirección asigne explícitamente a un tercero', () => {
    expect(canAssignAgendaResponsibility({ id: 'direccion', rol: 'DIRECCION' }, 'pedro')).toBe(true);
  });
});
