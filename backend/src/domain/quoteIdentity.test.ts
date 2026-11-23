import { describe, expect, it } from 'vitest';
import { quoteActName, quoteClientName } from './quoteIdentity';
describe('Identidad canónica de Cotización con o sin Prospecto', () => {
  it('prioriza cliente y actos estructurados sobre el texto histórico', () => {
    const q = { solicitante_formal: { nombre_busqueda: 'CLIENTE REAL QA' }, actos: [{ tipo_acto: { nombre: 'ACTO QA' } }], prospecto: { nombre: 'HISTÓRICO', tipo_acto: 'ACTO ANTIGUO' } };
    expect(quoteClientName(q)).toBe('CLIENTE REAL QA'); expect(quoteActName(q)).toBe('ACTO QA');
  });
  it('conserva lectura histórica y no inventa cliente ni acto cuando faltan', () => {
    expect(quoteClientName({ prospecto: { nombre: 'HISTÓRICO' } })).toBe('HISTÓRICO');
    expect(quoteActName({ prospecto: { tipo_acto: 'ACTO HISTÓRICO' } })).toBe('ACTO HISTÓRICO');
    expect(quoteClientName({})).toBe(''); expect(quoteActName({})).toBe('');
  });
});
