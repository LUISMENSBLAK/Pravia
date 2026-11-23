import { describe, expect, it } from 'vitest';
import { expedienteClientName } from './expedienteClient';
describe('Cliente explícito del Expediente', () => {
  const party = { compareciente: { nombre_busqueda: 'VENDEDOR NO ES CLIENTE' } };
  it('no convierte al primer compareciente ni al alias histórico en cliente canónico', () => {
    expect(expedienteClientName({ cliente_compareciente: { nombre_busqueda: 'CLIENTE CANÓNICO' }, cliente_alias: 'ALIAS ANTERIOR', comparecientes: [party] })).toBe('CLIENTE CANÓNICO');
  });
  it('preserva nombres históricos cuando no existe vínculo demostrado', () => {
    expect(expedienteClientName({ cliente_alias: 'HISTÓRICO', comparecientes: [party] })).toBe('HISTÓRICO');
    expect(expedienteClientName({ cotizacion: { solicitante_formal: { nombre_busqueda: 'CLIENTE DE ORIGEN' } }, comparecientes: [party] })).toBe('CLIENTE DE ORIGEN');
    expect(expedienteClientName({})).toBe('Sin cliente');
  });
});
