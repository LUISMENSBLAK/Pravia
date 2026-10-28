import { describe, expect, it } from 'vitest';
import { cotizacionObjectWhere, cotizacionReadWhere, comparecienteObjectWhere,
  predioObjectWhere, prospectoObjectWhere, prospectoReadWhere } from './objectAccess.service';

const actor = (rol: string) => ({ id: 'member-a', organizationId: 'notary-a', rol }) as any;

describe('colaboración por notaría: lectura separada de escritura', () => {
  it('expone Prospectos y Cotizaciones de la misma organización a un abogado autorizado', () => {
    expect(prospectoReadWhere(actor('ABOGADO'))).toEqual({ organization_id: 'notary-a' });
    expect(cotizacionReadWhere(actor('ABOGADO'))).toEqual({ organization_id: 'notary-a' });
    const assigned = { organization_id: 'notary-a', OR: [
      { user_id: 'member-a' },
      { collaborators: { some: { organization_id: 'notary-a', user_id: 'member-a', active: true } } },
    ] };
    expect(prospectoObjectWhere(actor('ABOGADO'))).toEqual(assigned);
    expect(cotizacionObjectWhere(actor('ABOGADO'))).toEqual(assigned);
  });

  it('no filtra catálogos maestros por creador ni por expediente asignado', () => {
    expect(comparecienteObjectWhere(actor('ABOGADO'))).toEqual({});
    expect(predioObjectWhere(actor('ABOGADO'))).toEqual({});
  });

  it('Recepción y Consulta no obtienen edición global por poder leer el catálogo', () => {
    expect(prospectoObjectWhere(actor('RECEPCION'))).toHaveProperty('OR');
    expect(cotizacionObjectWhere(actor('RECEPCION'))).toHaveProperty('OR');
    expect(prospectoObjectWhere(actor('CONSULTA'))).toHaveProperty('OR');
    expect(cotizacionObjectWhere(actor('CONSULTA'))).toHaveProperty('OR');
    expect(prospectoObjectWhere(actor('DIRECCION'))).not.toHaveProperty('OR');
  });
});
