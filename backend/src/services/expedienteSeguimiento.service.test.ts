import { describe, expect, it } from 'vitest';
import { addOperationalDays, isDependencySatisfied, operationalCopyFingerprint, operationalDaysBetween } from './expedienteSeguimiento.service';
import { resolveOperationalActivityConfiguration } from './configurationCatalog.service';

const activity = (exceptions: any[] = []) => ({ duracion_estimada: 5, tipo_dias: 'HABILES', margen_seguridad: 2, excepciones: exceptions });
const exception = (overrides: any = {}) => ({ id: 'exception-1', activa: true, selector_tipo: 'NOTARIA', notaria_id: 'notary-1', duracion: 3, tipo_dias: 'NATURALES', margen_seguridad: 1, dependencias_adicionales: [], ...overrides });

describe('EXP-005 · resolver y calendario operacional', () => {
  it('resuelve valores generales cuando no coincide excepción', () => expect(resolveOperationalActivityConfiguration(activity(), {})).toMatchObject({ source: 'GENERAL', duration: 5, day_type: 'HABILES', safety_margin: 2 }));
  it('resuelve notaría sin precedencia inventada', () => expect(resolveOperationalActivityConfiguration(activity([exception()]), { notaryId: 'notary-1' })).toMatchObject({ status: 'RESOLVED', source: 'EXCEPTION', duration: 3 }));
  it('resuelve institución', () => expect(resolveOperationalActivityConfiguration(activity([exception({ selector_tipo: 'INSTITUCION', notaria_id: null, institucion_id: 'bank-1' })]), { institutionIds: ['bank-1'] })).toMatchObject({ source: 'EXCEPTION' }));
  it('resuelve jurisdicción ignorando acentos y mayúsculas', () => expect(resolveOperationalActivityConfiguration(activity([exception({ selector_tipo: 'JURISDICCION', notaria_id: null, jurisdiccion: 'Náyarit' })]), { jurisdictions: ['NAYARIT'] })).toMatchObject({ source: 'EXCEPTION' }));
  it('ignora excepción inactiva', () => expect(resolveOperationalActivityConfiguration(activity([exception({ activa: false })]), { notaryId: 'notary-1' })).toMatchObject({ source: 'GENERAL' }));
  it('acepta excepciones coincidentes equivalentes', () => expect(resolveOperationalActivityConfiguration(activity([exception(), exception({ id: 'exception-2', selector_tipo: 'JURISDICCION', notaria_id: null, jurisdiccion: 'Nayarit' })]), { notaryId: 'notary-1', jurisdictions: ['Nayarit'] })).toMatchObject({ source: 'EQUIVALENT_EXCEPTIONS' }));
  it('eleva colisión incompatible a revisión humana', () => expect(resolveOperationalActivityConfiguration(activity([exception(), exception({ id: 'exception-2', selector_tipo: 'JURISDICCION', notaria_id: null, jurisdiccion: 'Nayarit', duracion: 9 })]), { notaryId: 'notary-1', jurisdictions: ['Nayarit'] })).toMatchObject({ status: 'REVIEW_REQUIRED', source: 'COLLISION' }));
  it('suma días naturales', () => expect(addOperationalDays(new Date('2026-08-14T12:00:00Z'), 2, 'NATURALES').toISOString()).toBe('2026-08-16T12:00:00.000Z'));
  it('excluye fin de semana en días hábiles', () => expect(addOperationalDays(new Date('2026-08-14T12:00:00Z'), 2, 'HABILES').toISOString()).toBe('2026-08-18T12:00:00.000Z'));
  it('cuenta días naturales transcurridos', () => expect(operationalDaysBetween(new Date('2026-08-14T12:00:00Z'), new Date('2026-08-17T12:00:00Z'), 'NATURALES')).toBe(3));
  it('cuenta sólo hábiles transcurridos', () => expect(operationalDaysBetween(new Date('2026-08-14T12:00:00Z'), new Date('2026-08-18T12:00:00Z'), 'HABILES')).toBe(2));
  it('no produce días negativos', () => expect(operationalDaysBetween(new Date('2026-08-18T12:00:00Z'), new Date('2026-08-14T12:00:00Z'), 'HABILES')).toBe(0));
  it('identidad incluye instancia de acto', () => expect(operationalCopyFingerprint({ expediente_acto_id: 'act-1', actividad_maestra_id: 'master-1', configuracion_revision: 1 })).not.toBe(operationalCopyFingerprint({ expediente_acto_id: 'act-2', actividad_maestra_id: 'master-1', configuracion_revision: 1 })));
  it('una dependencia completada o no aplicable no bloquea downstream', () => {
    expect(isDependencySatisfied('COMPLETADO')).toBe(true);
    expect(isDependencySatisfied('NO_APLICA')).toBe(true);
    expect(isDependencySatisfied('EN_PROCESO')).toBe(false);
  });
});
