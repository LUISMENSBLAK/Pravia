import { describe, expect, it } from 'vitest';
import {
  normalizeProspectName,
  PROSPECT_OPERATIONAL_STAGES,
  PROSPECT_SERVICES,
  prospectServiceByCode,
  prospectDocumentFlagsForType,
} from './prospectCatalog';

describe('catálogo canónico de Prospectos', () => {
  it('contiene exactamente las tres etapas documentales en el orden del Word', () => {
    expect(PROSPECT_OPERATIONAL_STAGES.map((item) => item.label)).toEqual([
      'Prospecto recibido',
      'Antecedentes solicitados',
      'Antecedentes recibidos',
    ]);
  });

  it('contiene exactamente los 38 servicios y conserva el orden de origen', () => {
    expect(PROSPECT_SERVICES).toHaveLength(38);
    expect(PROSPECT_SERVICES.map((item) => item.order)).toEqual(Array.from({ length: 38 }, (_, index) => index + 1));
    expect(PROSPECT_SERVICES[0].label).toBe('Compraventa');
    expect(PROSPECT_SERVICES[37].label).toBe('Adjudicación en rebeldía');
  });

  it('conserva Nayarit/Jalisco solo para los actos definidos por el Word', () => {
    expect(PROSPECT_SERVICES.filter((item) => item.states.length > 0)).toHaveLength(27);
    expect(PROSPECT_SERVICES.filter((item) => item.states.length === 0)).toHaveLength(11);
    expect(prospectServiceByCode('COMPRAVENTA')?.states).toEqual(['Nayarit', 'Jalisco']);
    expect(prospectServiceByCode('JUICIO_SUCESORIO_TESTAMENTARIO_PRIMERA_ETAPA')?.states).toEqual([]);
    expect(prospectServiceByCode('PROTOCOLIZACION_ACTA_ASAMBLEA')?.states).toEqual(['Nayarit', 'Jalisco']);
    expect(prospectServiceByCode('FE_HECHOS')?.states).toEqual([]);
  });

  it('limita tipo de persona a Poder y Revocación de poder', () => {
    const withPersonTypes = PROSPECT_SERVICES.filter((item) => item.personTypes.length > 0);
    expect(withPersonTypes.map((item) => item.code)).toEqual(['PODER', 'REVOCACION_PODER']);
    expect(withPersonTypes.every((item) => item.personTypes.join('|') === 'Persona física|Persona moral')).toBe(true);
  });

  it('normaliza nombres en español sin remover acentos', () => {
    expect(normalizeProspectName('  Francisco   Javier Tapia López ')).toBe('FRANCISCO JAVIER TAPIA LÓPEZ');
    expect(normalizeProspectName('josé ñuñez')).toBe('JOSÉ ÑUÑEZ');
  });

  it('deriva disponibilidad real al adjuntar Predial o Antecedente sin afectar otras categorías', () => {
    expect(prospectDocumentFlagsForType('Predial')).toEqual({ tiene_predial: true });
    expect(prospectDocumentFlagsForType('ANTECEDENTE')).toEqual({ tiene_antecedente: true });
    expect(prospectDocumentFlagsForType('OTRO')).toEqual({});
  });
});
