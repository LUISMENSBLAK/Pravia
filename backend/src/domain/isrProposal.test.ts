import { describe, expect, it } from 'vitest';
import { applyISRProposal, normalizeISRExtractionFields } from './isrProposal';
import type { ISRV3Input } from './isrV3Engine';

const input = (): ISRV3Input => ({ schemaVersion: 3, taxYear: 2026, operationDate: '', act: { name: '', fiscalClassification: 'OTRO' }, property: { type: 'TERRENO', sameAcquisitionDate: true }, values: { operation: '', appraisal: '', cadastral: '', landSale: '500', constructionSale: '0' }, calculateIVA: false, parties: [
  { id: 'seller', name: 'Persona QA', role: 'ENAJENANTE', subjectType: 'PF', nationalityCode: 'MX', fiscalResidence: 'POR_DETERMINAR', percentage: '100' },
  { id: 'buyer', name: 'Otra QA', role: 'ADQUIRENTE', subjectType: 'PF', nationalityCode: 'MX', fiscalResidence: 'POR_DETERMINAR', percentage: '100' },
], deductions: [] });

describe('ISR · confirmación humana y mapping cerrado de propuestas', () => {
  it('aplica un importe real sólo a su campo, sin inventar distribución o mutar el input', () => {
    const original = input(); const result = applyISRProposal(original, 'precio_enajenacion', '746130');
    expect(result).toMatchObject({ path: 'values.operation', previous: '', value: '746130.00', input: { values: { operation: '746130.00', landSale: '500', constructionSale: '0' } } });
    expect(original.values.operation).toBe('');
  });
  it('no atribuye identidad a la primera persona; exige destino y preserva la otra', () => {
    expect(() => applyISRProposal(input(), 'rfc', 'AAAA800101AA1')).toThrow('Selecciona expresamente');
    const result = applyISRProposal(input(), 'rfc', 'aaaa800101aa1', { partyId: 'buyer' });
    expect((result.input as ISRV3Input).parties[1].rfc).toBe('AAAA800101AA1');
    expect((result.input as ISRV3Input).parties[0].rfc).toBeUndefined();
    expect(() => applyISRProposal(input(), 'nombre_completo', 'Persona ajena', { partyId: 'unknown' })).toThrow('Selecciona expresamente');
  });
  it.each(['__proto__.polluted', 'taxYear', 'parties.0.verified', 'adjustedLandCost', 'costo_adquisicion'])('rechaza ruta no mapeada %s en vez de fingir aplicación', (field) => {
    expect(() => applyISRProposal(input(), field, '100')).toThrow('captura manual');
  });
  it.each(['1,234', '$1234', '-10', 'NaN', '1.0001'])('no adivina el formato monetario %s', (value) => {
    expect(() => applyISRProposal(input(), 'valor_operacion', value)).toThrow('decimal');
  });
  it('fecha confirmada tiene validez y ejercicio exactos', () => {
    expect(applyISRProposal(input(), 'fecha_enajenacion', '2026-11-11').path).toBe('operationDate');
    expect(() => applyISRProposal(input(), 'fecha_enajenacion', '2026-02-30')).toThrow('fecha válida');
    expect(() => applyISRProposal(input(), 'fecha_enajenacion', '2025-01-01')).toThrow('ejercicio');
  });
  it('compone nombre completo sólo de componentes inequívocos del mismo documento', () => {
    const fields = [
      { campo: 'nombre', valor: 'MARIANA', documento_id: 'a', confianza: 'LECTURA_CLARA' },
      { campo: 'apellido_paterno', valor: 'SINTÉTICA', documento_id: 'a', confianza: 'LECTURA_DUDOSA' },
      { campo: 'apellido_materno', valor: 'QA', documento_id: 'a', confianza: 'LECTURA_CLARA' },
      { campo: 'apellido_materno', valor: 'OTRA PERSONA', documento_id: 'b', confianza: 'LECTURA_CLARA' },
    ];
    expect(normalizeISRExtractionFields(fields)).toEqual([
      fields[3], expect.objectContaining({ campo: 'nombre_completo', valor: 'MARIANA SINTÉTICA QA', documento_id: 'a', confianza: 'LECTURA_DUDOSA' }),
    ]);
    expect(fields).toHaveLength(4);
  });
  it('un componente contradictorio no se convierte en un nombre completo aparentemente cierto', () => {
    const fields = [{ campo: 'nombre', valor: 'MARIANA', documento_id: 'a' }, { campo: 'apellido_paterno', valor: 'UNO', documento_id: 'a' }, { campo: 'apellido_paterno', valor: 'DOS', documento_id: 'a' }];
    expect(normalizeISRExtractionFields(fields)).toEqual(fields);
  });
  it('la parte interpretada exige elección humana y no confirma residencia, título fiscal o adquisición', () => {
    const value = JSON.stringify({ name: 'NUEVA PERSONA QA', role: 'ENAJENANTE', percentage: '50', acquisitionDate: '2025-05-26', historicalLandCost: '2034.65', historicalConstructionCost: null });
    expect(() => applyISRProposal(input(), 'party', value)).toThrow('Selecciona la persona');
    const result = applyISRProposal(input(), 'party', value, { partyId: 'NEW_PARTY' }); const party = (result.input as ISRV3Input).parties[2];
    expect(party).toMatchObject({ name: 'NUEVA PERSONA QA', percentage: '50', subjectType: 'OTRO', fiscalResidence: 'POR_DETERMINAR', acquisitionLayers: [{ verified: false, acquisitionAct: 'OTRO', historical: { land: '2034.65', construction: '' } }] });
    expect((result.input as ISRV3Input).parties[0]).toEqual(input().parties[0]);
  });
  it('una propuesta de parte no inyecta IDs o campos verificados ni sobreescribe adquisiciones', () => {
    const fact = { name: 'PERSONA QA', role: 'ENAJENANTE', percentage: '100', acquisitionDate: '2025-05-26', historicalLandCost: '100', historicalConstructionCost: null };
    expect(() => applyISRProposal(input(), 'party', JSON.stringify({ ...fact, verified: true }), { partyId: 'NEW_PARTY' })).toThrow('no permitidos');
    expect(() => applyISRProposal(input(), 'party', JSON.stringify({ ...fact, role: 'ADMIN' }), { partyId: 'NEW_PARTY' })).toThrow('no permitidos');
    const existing = input(); existing.parties[0].acquisitionLayers = [{ id: 'old', percentage: '100', legalDate: '', fiscalDate: '', acquisitionAct: 'ONEROSA', adjustedLandCost: '', adjustedConstructionCost: '', source: 'Escritura', verified: false }];
    expect(() => applyISRProposal(existing, 'party', JSON.stringify(fact), { partyId: 'seller' })).toThrow('no se sobrescribieron');
  });
  it('keys heredadas de Object no son variables de cálculo', () => {
    expect(() => applyISRProposal(input(), 'toString', '100')).toThrow('captura manual');
  });
  it('porcentaje con unidad explícita se normaliza, sin confundirlo con importe monetario', () => {
    const fact = { name: 'PERSONA QA', role: 'ADQUIRENTE', percentage: '100%', acquisitionDate: null, historicalLandCost: null, historicalConstructionCost: null };
    const result = applyISRProposal(input(), 'party', JSON.stringify(fact), { partyId: 'NEW_PARTY' });
    expect((result.input as ISRV3Input).parties[2].percentage).toBe('100');
    expect(() => applyISRProposal(input(), 'party', JSON.stringify({ ...fact, percentage: '1,00%' }), { partyId: 'NEW_PARTY' })).toThrow('sin separadores');
    expect(() => applyISRProposal(input(), 'values.operation', '100%')).toThrow('decimal');
  });
});
