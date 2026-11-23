import { describe, expect, it } from 'vitest';
import { partyTransferRole } from './partyTransferRole';
describe('participaciones de roles canónicos y personalizados', () => {
  it.each(['Vendedor', 'VENDEDORA', 'Parte vendedora', 'Transmitente'])('reconoce el rol personalizado exacto %s', nombre => {
    expect(partyTransferRole({ clave: 'CUSTOM_opaque', nombre })).toBe('TRANSMITTER');
  });
  it.each(['Comprador', 'COMPRADORA', 'Parte compradora', 'Adquirente'])('reconoce el rol personalizado exacto %s', nombre => {
    expect(partyTransferRole({ clave: 'CUSTOM_opaque', nombre })).toBe('ACQUIRER');
  });
  it('no convierte representantes ni nombres ambiguos en propietarios', () => {
    expect(partyTransferRole({ clave: 'CUSTOM_opaque', nombre: 'Apoderado del vendedor' })).toBeNull();
    expect(partyTransferRole({ clave: 'REPRESENTANTE', nombre: 'Vendedor' })).toBeNull();
    expect(partyTransferRole({ clave: 'COMPRADOR', nombre: 'Vendedor' })).toBe('ACQUIRER');
  });
});
