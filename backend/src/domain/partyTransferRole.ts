const transmitters = new Set(['TRANSMITENTE', 'VENDEDOR', 'VENDEDORA', 'PARTE_VENDEDORA', 'DONANTE', 'CEDENTE', 'FIDEICOMITENTE']);
const acquirers = new Set(['ADQUIRENTE', 'COMPRADOR', 'COMPRADORA', 'PARTE_COMPRADORA', 'DONATARIO', 'DONATARIA', 'CESIONARIO', 'CESIONARIA', 'FIDEICOMISARIO']);
const key = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').trim().toUpperCase().replace(/[\s-]+/g, '_');

/** Tenant-custom roles have opaque CUSTOM_ keys. Recognize exact role names,
 * never substrings such as "representante del vendedor" or a person's name. */
export function partyTransferRole(character: { clave?: string | null; nombre?: string | null }): 'TRANSMITTER' | 'ACQUIRER' | null {
  const code = key(character.clave || '');
  if (transmitters.has(code)) return 'TRANSMITTER';
  if (acquirers.has(code)) return 'ACQUIRER';
  if (code && !code.startsWith('CUSTOM_')) return null;
  const label = key(character.nombre || '');
  if (transmitters.has(label)) return 'TRANSMITTER';
  if (acquirers.has(label)) return 'ACQUIRER';
  return null;
}
