import { describe, expect, it } from 'vitest';
import { parseSepomexTxt } from './postalCodeCatalog.service';

describe('Catálogo postal SEPOMEX', () => {
  it('normaliza el TXT oficial y conserva los códigos de procedencia', () => {
    const data = Buffer.from([
      'El Catálogo Nacional de Códigos Postales es elaborado por Correos de México.',
      'd_codigo|d_asenta|d_tipo_asenta|D_mnpio|d_estado|d_ciudad|d_CP|c_estado|c_oficina|c_CP|c_tipo_asenta|c_mnpio|id_asenta_cpcons|d_zona|c_cve_ciudad',
      '63000|Tepic Centro|Colonia|Tepic|Nayarit|Tepic|63001|18|63001||09|017|0001|Urbano|01',
    ].join('\r\n'), 'latin1');
    expect(parseSepomexTxt(data)).toEqual([expect.objectContaining({ postal_code: '63000', settlement: 'Tepic Centro', municipality: 'Tepic', state: 'Nayarit', state_code: '18', office_code: '63001', administration_cp: '63001', settlement_type_code: '09', municipality_code: '017', settlement_code: '0001', city_code: '01', zone: 'Urbano' })]);
  });

  it('rechaza archivos que no tienen el contrato SEPOMEX', () => {
    expect(() => parseSepomexTxt(Buffer.from('cp|colonia\n63000|Centro'))).toThrow(/no contiene registros/);
  });
});
