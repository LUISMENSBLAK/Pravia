import { describe, expect, it } from 'vitest';
import { NotConfiguredScreeningProvider } from './complianceScreening';

describe('adaptador de screening UIF', () => {
  it('nunca simula un resultado negativo cuando no hay integración oficial', async () => {
    const provider = new NotConfiguredScreeningProvider();
    const result = await provider.screen({ reviewId: 'r1', comparecienteId: 'p1', name: 'Persona de prueba' });
    expect(provider.configured).toBe(false);
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.matches).toEqual([]);
    expect(result.evidence).toEqual({ message: 'Consulta oficial PEP no configurada' });
  });
});
