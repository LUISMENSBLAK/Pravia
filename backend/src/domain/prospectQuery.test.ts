import { describe, expect, it } from 'vitest';
import { parseProspectListQuery } from './prospectQuery';

describe('parseProspectListQuery', () => {
  it('conserva defaults seguros y modo legacy sin paginación', () => {
    expect(parseProspectListQuery({})).toMatchObject({ paginated: false, page: 1, pageSize: 20, skip: 0, sortBy: 'created_at', sortOrder: 'desc' });
  });

  it('limita pageSize, ordenación y enums a valores soportados', () => {
    expect(parseProspectListQuery({ page: '3', pageSize: '5000', sortBy: 'password', sortOrder: 'up', estado: 'NUEVO,INVALIDO,ACEPTADO', prioridad: 'ALTA,NOPE' })).toMatchObject({
      paginated: true, page: 3, pageSize: 100, skip: 200, sortBy: 'created_at', sortOrder: 'desc', substatuses: ['NUEVO', 'ACEPTADO'], priorities: ['ALTA'],
    });
  });

  it('admite filtros compatibles, alias search y búsqueda exacta por UUID', () => {
    const id = '7afecfa0-8678-4e95-a2a6-9bd4bd852810';
    expect(parseProspectListQuery({ search: id, servicio: 'Compraventa', origen: 'Referido', sort: 'nombre:asc' })).toMatchObject({
      search: id, exactId: id, serviceCode: 'Compraventa', source: 'Referido', sortBy: 'nombre', sortOrder: 'asc',
    });
  });

  it('permite solicitar únicamente prospectos sin cotización', () => {
    expect(parseProspectListQuery({ page: '1', sinCotizacion: 'true' }).withoutQuote).toBe(true);
  });

  it('separa etapa documental y permite omitir el resumen en paginación por lane', () => {
    expect(parseProspectListQuery({ etapa: 'PROSPECTO_RECIBIDO', summary: 'false' })).toMatchObject({
      operationalStageCode: 'PROSPECTO_RECIBIDO', includeSummary: false,
    });
  });
});
