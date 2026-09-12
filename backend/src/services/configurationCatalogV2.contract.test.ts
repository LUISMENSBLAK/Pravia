import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateCriticalPath, standardActInheritance, standardConcepts, standardFlowSpecs } from './configurationCatalogV2.service';
import { resolveInheritedActivity, validateDeclarativeCondition } from './configurationCatalogV2.domain';

const root = resolve(process.cwd(), '..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');
const tracking = source('backend/src/services/expedienteSeguimiento.service.ts');
const migration = source('backend/prisma/migrations/20260910010000_cfg001_v2_master_inheritance/migration.sql');
const ui = source('frontend/src/features/settings/catalogs/ActsTimesCatalog.tsx');
const flow = (name: string) => standardFlowSpecs[name].map((step) => step.concept);
const rule = (name: string) => standardActInheritance.find((item) => item.act === name);

describe('CFG-001 v2 · pruebas contractuales A–R', () => {
  it('A — una edición maestra se propaga sólo a atributos heredados', () => {
    const activity = { duracion_estimada: 7, margen_seguridad: 2, atributos_heredados: ['duracion_estimada'] };
    expect(resolveInheritedActivity(activity, { duracion_estimada: 12, margen_seguridad: 9 }).duracion_estimada).toBe(12);
    expect(resolveInheritedActivity(activity, { duracion_estimada: 12, margen_seguridad: 9 }).margen_seguridad).toBe(2);
    expect(migration).toContain('atributos_heredados');
  });
  it('B — Donación hereda Compraventa sin copia desconectada', () => expect(rule('Donación')).toMatchObject({ base: 'Compraventa', exclusions: [] }));
  it('C — Fideicomiso agrega SRE/banco y conserva paralelismo documental', () => {
    expect(flow('Constitución de fideicomiso')).toEqual(expect.arrayContaining(['SRE_SOLICITUD', 'SRE_OBTENCION', 'REVISION_BANCO', 'VOBO_BANCO', 'FIRMA', 'FIRMA_BANCO']));
    expect(standardFlowSpecs['Constitución de fideicomiso'].filter((step) => step.parallel === 'DOCUMENTOS_EXTERNOS')).toHaveLength(2);
    expect(standardFlowSpecs['Constitución de fideicomiso'].find((step) => step.concept === 'FIRMA')?.dependsOn).toContain('VOBO_BANCO');
    expect(standardFlowSpecs['Constitución de fideicomiso'].find((step) => step.concept === 'FIRMA_BANCO')?.dependsOn).toEqual(['FIRMA']);
  });
  it('D — Reversión excluye solicitud y obtención SRE', () => expect(rule('Reversión de fideicomiso')?.exclusions).toEqual(expect.arrayContaining(['SRE_SOLICITUD', 'SRE_OBTENCION'])));
  it('E — Compraventa con crédito incluye acreedor y general 15 hábiles', () => {
    expect(flow('Compraventa con crédito y garantía hipotecaria')).toEqual(expect.arrayContaining(['ENVIO_ACREEDOR', 'VOBO_ACREEDOR', 'FIRMA']));
    expect(standardFlowSpecs['Compraventa con crédito y garantía hipotecaria'].find((step) => step.concept === 'FIRMA')?.dependsOn).toContain('VOBO_ACREEDOR');
    expect(standardConcepts.find((item) => item.code === 'VOBO_ACREEDOR')).toMatchObject({ duration: 15, source: 'INSTITUCION' });
  });
  it('F — Cancelación excluye avalúo, solvencia y UIF', () => expect(rule('Cancelación de hipoteca')?.exclusions).toEqual(expect.arrayContaining(['SOLICITUD_AVALUO', 'OBTENCION_AVALUO', 'SOLVENCIA_INGRESO', 'SOLVENCIA_OBTENCION', 'UIF'])));
  it('G — Protocolización usa revisión 5, solvencia 90 y RPP 50', () => {
    const items = standardFlowSpecs['Protocolización inmobiliaria'];
    expect(items.find((item) => item.concept === 'REVISION_INICIAL')?.durationOverride).toBe(5);
    expect(items.find((item) => item.concept === 'SOLVENCIA_OBTENCION')?.durationOverride).toBe(90);
    expect(items.find((item) => item.concept === 'RPP_OBTENCION')?.durationOverride).toBe(50);
  });
  it('H — Rectificación de otros datos excluye CLG y solvencia', () => expect(rule('Rectificación de escritura de otros datos')?.exclusions).toEqual(expect.arrayContaining(['SOLICITUD_CLG', 'OBTENCION_CLG', 'SOLVENCIA_OBTENCION'])));
  it('I — Poder/Testamento: revisión 2, proyección 1, firma 3 y cierre paralelo', () => {
    const items = standardFlowSpecs['Poder sin registro'];
    expect(items.find((item) => item.concept === 'REVISION_INICIAL')?.durationOverride).toBe(2);
    expect(items.find((item) => item.concept === 'FIRMA')?.durationOverride).toBe(3);
    expect(items.filter((item) => item.parallel === 'CIERRE_CORTO').map((item) => item.concept)).toEqual(['AVISO_DIRECCION', 'ARMADO_TESTIMONIO']);
    expect(items.find((item) => item.concept === 'ENTREGA_CLIENTE')?.dependsOn).toEqual(['ARMADO_TESTIMONIO']);
    expect(items.find((item) => item.concept === 'ARCHIVO')?.dependsOn).toEqual(['ARMADO_TESTIMONIO']);
  });
  it('J — Ratificación/Testimonial excluyen aviso Dirección', () => {
    expect(rule('Ratificación de firmas')?.exclusions).toContain('AVISO_DIRECCION'); expect(rule('Testimonial')?.exclusions).toContain('AVISO_DIRECCION');
  });
  it('K — Poder dominio limitado parte del flujo corto y admite aviso/registro', () => expect(rule('Poder para actos de dominio limitado')).toMatchObject({ base: 'Poder sin registro', exclusions: [] }));
  it('L — Poder dominio conserva aviso sin heredar Registro Público', () => {
    expect(rule('Poder para actos de dominio')).toMatchObject({ base: 'Poder sin registro', exclusions: [] });
    expect(flow('Poder para actos de dominio')).toContain('AVISO_DOMINIO');
    expect(flow('Poder para actos de dominio')).not.toEqual(expect.arrayContaining(['RPP_INGRESO', 'RPP_OBTENCION']));
  });
  it('M — Poder persona moral excluye aviso dominio y conserva registro', () => expect(rule('Poder de persona moral')?.exclusions).toEqual(['AVISO_DOMINIO']));
  it('N — Asamblea vulnerable hereda la no vulnerable y Cumplimiento es la fuente jurídica', () => {
    expect(rule('Protocolización del acta de asamblea vulnerable')?.base).toBe('Protocolización del acta de asamblea no vulnerable');
    expect(tracking).toContain('Cumplimiento remains the sole source of legal obligations'); expect(tracking).toContain("fuente_tiempo_snapshot: 'REGLA_JURIDICA'");
  });
  it('O — espera externa no se autocumple ni desbloquea downstream', () => {
    expect(tracking).not.toMatch(/naturaleza_snapshot[^\n]{0,80}ESPERA_EXTERNA[^\n]{0,200}COMPLETADO/);
    expect(tracking).toContain("estado: { notIn: ['COMPLETADO', 'NO_APLICA'] }");
  });
  it('P — seguimiento permite ajustes y extraordinarias sin mutar maestro', () => {
    expect(tracking).toContain('createExtraordinary'); expect(tracking).toContain('setOperationalDependencies'); expect(tracking).toContain('cfg001_unchanged: true');
    expect(ui).toContain('Volver a duración heredada');
  });
  it('Q — ramas multi-acto/multi-inmueble usan MAX y no suma', () => {
    const projection = calculateCriticalPath([{ id: 'a', duration: 10, dependencyIds: [], scopeKey: 'ACT:a' }, { id: 'b', duration: 15, dependencyIds: [], scopeKey: 'ACT:b' }]);
    expect(projection.total).toBe(15); expect(projection.parallel_semantics).toBe('MAX');
    expect(migration).toContain('alcance_referencia_id');
  });
  it('R — dos bancos resuelven tiempos por institución sin duplicar concepto', () => {
    expect(standardConcepts.filter((item) => item.code === 'VOBO_ACREEDOR')).toHaveLength(1);
    expect(tracking).toContain('catalogoInstitucionTipoRespuesta.findMany'); expect(migration).toContain('uq_cfg_inst_respuesta_org_inst_codigo');
  });
  it('rechaza condiciones con campos u operadores no declarativos', () => {
    expect(() => validateDeclarativeCondition({ op: 'exec', field: 'process.env', value: 'x' })).toThrow();
    expect(validateDeclarativeCondition({ op: 'eq', field: 'institucion.tipo', value: 'BANCO' })).toBeTruthy();
  });
  it('rechaza ciclos en ruta crítica', () => expect(() => calculateCriticalPath([{ id: 'a', duration: 1, dependencyIds: ['b'] }, { id: 'b', duration: 1, dependencyIds: ['a'] }])).toThrow(/ciclo/i));
});
