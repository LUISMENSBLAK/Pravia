export type QuoteTerritory = {
  jurisdiction: string;
  state: string;
  municipality: string | null;
  confirmedById: string;
  confirmedAt: string;
};

export const territoryKey = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('es-MX');

// Only explicitly confirmed operation data is authoritative. Never infer it
// from the Notaría address, prospect free text, or a previously chosen tariff.
export function readQuoteTerritory(value: unknown): QuoteTerritory | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.jurisdiction !== 'string' || !row.jurisdiction.trim() ||
      typeof row.state !== 'string' || !row.state.trim() ||
      !(row.municipality === null || (typeof row.municipality === 'string' && row.municipality.trim())) ||
      typeof row.confirmedById !== 'string' || !row.confirmedById ||
      typeof row.confirmedAt !== 'string' || !Number.isFinite(Date.parse(row.confirmedAt))) return null;
  return row as QuoteTerritory;
}

export function territoryApplies(scope: Record<string, unknown>, territory: QuoteTerritory | null): boolean {
  if (!territory || typeof scope.jurisdiction !== 'string' || !scope.jurisdiction.trim()) return false;
  return (['jurisdiction', 'state', 'municipality'] as const).every((field) => {
    const expected = scope[field];
    if (expected == null || expected === '') return field !== 'jurisdiction';
    return typeof expected === 'string' && typeof territory[field] === 'string'
      && territoryKey(expected) === territoryKey(territory[field]!);
  });
}
