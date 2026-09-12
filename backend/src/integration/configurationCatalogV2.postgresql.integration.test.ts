import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithActorContext } from '../auth/actorContext';
import prisma from '../config/prisma';
import { actsAndTimesService } from '../services/configurationCatalog.service';
import { configurationCatalogV2Service } from '../services/configurationCatalogV2.service';
import { ExpedienteSeguimientoService } from '../services/expedienteSeguimiento.service';

const explicitUrl = process.env.CFG001_DATABASE_URL || '';
const url = new URL(explicitUrl || 'postgresql://invalid.invalid/blocked');
if (process.env.CFG001_RUN_ISOLATED === '1' && (url.hostname !== '127.0.0.1' || url.port !== '55481' || url.pathname !== '/pravia_cfg001_qa')) {
  throw new Error('CFG-001 PostgreSQL tests only accept the explicit isolated local database.');
}
const db = new PrismaClient({ datasources: { db: { url: explicitUrl } } });
type Actor = NonNullable<Request['user']>;
const actor = (suffix: '1' | '2'): Actor => ({
  id: randomUUID(),
  organizationId: randomUUID(),
  membershipId: randomUUID(),
  sessionId: randomUUID(), rol: 'ADMINISTRACION', nombre: 'CFG', apellido: suffix,
  email: `cfg001-${suffix}-${randomUUID()}@example.test`, scope: 'GLOBAL', requiresPasswordChange: false,
  permissions: ['configuracion.catalogos.read', 'configuracion.actos_tiempos.manage', 'expedientes.read', 'expedientes.write'],
});
const primary = actor('1'); const foreign = actor('2');
const run = <T>(who: Actor, callback: () => T) => runWithActorContext({
  userId: who.id, organizationId: who.organizationId, membershipId: who.membershipId,
  sessionId: who.sessionId, role: who.rol, permissions: who.permissions, scope: who.scope,
}, callback);

const requiredActs = [
  'Compraventa', 'Donación', 'Adjudicación', 'Permuta', 'Dación en pago', 'Compraventa con reserva de dominio',
  'Cancelación de hipoteca', 'Compraventa con crédito y garantía hipotecaria', 'Compraventa con crédito sin garantía hipotecaria',
  'Constitución de fideicomiso', 'Cesión de derechos fideicomisarios', 'Reversión de fideicomiso',
  'Extinción / ejecución de fines de fideicomiso', 'Transmisión en ejecución de fideicomiso',
  'Transmisión en ejecución de fideicomiso + constitución de nuevo fideicomiso', 'Protocolización de subdivisión',
  'Protocolización de fusión', 'Protocolización de homologación', 'Protocolización de documentos cuando corresponda',
  'Rectificación de escritura de medidas', 'Rectificación de escritura de otros datos', 'Poder sin registro', 'Testamento',
  'Ratificación de firmas', 'Testimonial', 'Poder para actos de dominio limitado', 'Poder para actos de dominio',
  'Poder de persona moral', 'Protocolización del acta de asamblea no vulnerable', 'Protocolización del acta de asamblea vulnerable',
];

describe.runIf(process.env.CFG001_RUN_ISOLATED === '1')('CFG-001 v2 · PostgreSQL aislado', () => {
  beforeAll(async () => {
    const [database] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(database.name).toBe('pravia_cfg001_qa');
    for (const who of [primary, foreign]) {
      await db.organization.upsert({ where: { id: who.organizationId }, update: {}, create: { id: who.organizationId, name: `Tenant CFG ${who.apellido}` } });
      await db.user.upsert({ where: { id: who.id }, update: {}, create: { id: who.id, email: who.email, password_hash: 'synthetic-not-a-login', nombre: who.nombre, apellido: who.apellido, rol: who.rol, activo: true, requires_password_change: false } });
      await db.organizationMembership.upsert({ where: { organization_id_user_id: { organization_id: who.organizationId, user_id: who.id } }, update: {}, create: { id: who.membershipId, organization_id: who.organizationId, user_id: who.id, rol: who.rol, status: 'ACTIVE' } });
    }
  });
  afterAll(async () => { await Promise.all([db.$disconnect(), prisma.$disconnect()]); });

  it('bootstrap es tenant-safe, idempotente tres veces y no pisa personalizaciones', async () => {
    const first = await run(primary, () => configurationCatalogV2Service.bootstrap(primary));
    expect(first.concepts_created).toBeGreaterThan(0);
    expect((await run(primary, () => actsAndTimesService.list(primary))).data.map((item) => item.nombre)).toEqual(expect.arrayContaining(requiredActs));
    const revision = await db.configuracionConceptoActividad.findUniqueOrThrow({ where: { organization_id_codigo: { organization_id: primary.organizationId, codigo: 'REVISION_INICIAL' } } });
    await run(primary, () => configurationCatalogV2Service.updateConcept(primary, revision.id, { duracion_estimada: 4, expected_revision: revision.revision }));
    const second = await run(primary, () => configurationCatalogV2Service.bootstrap(primary));
    const third = await run(primary, () => configurationCatalogV2Service.bootstrap(primary));
    expect(second.idempotent).toBe(true); expect(third.idempotent).toBe(true);
    expect((await db.configuracionConceptoActividad.findUniqueOrThrow({ where: { id: revision.id } })).duracion_estimada).toBe(4);
    expect(await db.configuracionConceptoActividad.count({ where: { organization_id: primary.organizationId, codigo: 'REVISION_INICIAL' } })).toBe(1);
    expect(await db.tipoActo.count({ where: { organization_id: primary.organizationId, nombre: { in: requiredActs } } })).toBe(requiredActs.length);
  }, 30_000);

  it('crea un acto tenant-owned con código único y sus cinco etapas iniciales', async () => {
    const name = `Acto QA ${randomUUID()}`;
    const created = await run(primary, () => actsAndTimesService.create(primary, { nombre: name, descripcion: 'UAT local' }));
    expect(created).toMatchObject({ organization_id: primary.organizationId, nombre: name, activo: true });
    expect(created.codigo_catalogo).toMatch(/^ACTO_QA_[A-F0-9_-]+$/);
    expect(created.configuration.etapas.map((stage: any) => stage.nombre)).toEqual(['Prefirma', 'Firma', 'Postfirma', 'Registro', 'Cierre']);
    expect((await run(primary, () => actsAndTimesService.get(primary, created.id))).effective_stages.map((stage: any) => stage.nombre)).toEqual(['Prefirma', 'Firma', 'Postfirma', 'Registro', 'Cierre']);
    await run(primary, () => actsAndTimesService.update(primary, created.id, { descripcion: 'Descripción editada' }));
    expect((await run(primary, () => actsAndTimesService.get(primary, created.id))).descripcion).toBe('Descripción editada');
    const copied = await run(primary, () => configurationCatalogV2Service.duplicateAct(primary, created.id, { nombre: `${name} copia` }));
    expect((await run(primary, () => actsAndTimesService.get(primary, copied.id))).effective_stages.map((stage: any) => stage.nombre)).toEqual(['Prefirma', 'Firma', 'Postfirma', 'Registro', 'Cierre']);
    expect(await db.tipoActo.count({ where: { organization_id: primary.organizationId, nombre: name } })).toBe(1);
    await expect(run(foreign, () => actsAndTimesService.get(foreign, created.id))).rejects.toMatchObject({ status: 404 });
    await expect(db.auditLog.findFirstOrThrow({ where: { organization_id: primary.organizationId, accion: 'CFG_ACT_CREATED', entidad_id: created.id } })).resolves.toMatchObject({ user_id: primary.id });
  });

  it('propaga herencia, conserva override parcial y permite volver a heredar', async () => {
    const acts = (await run(primary, () => actsAndTimesService.list(primary))).data;
    const purchase = acts.find((item) => item.nombre === 'Compraventa')!; const donation = acts.find((item) => item.nombre === 'Donación')!;
    const donationBefore = await run(primary, () => actsAndTimesService.get(primary, donation.id));
    const inherited = donationBefore.effective_activities.find((item: any) => item.concepto_maestro?.codigo === 'REVISION_INICIAL');
    expect(inherited).toMatchObject({ duracion_estimada: 4, heredada_del_acto: true });
    const local = await run(primary, () => configurationCatalogV2Service.overrideInheritedApplication(primary, donation.id, inherited.id, { duracion_estimada: 7 }));
    const concept = await db.configuracionConceptoActividad.findUniqueOrThrow({ where: { organization_id_codigo: { organization_id: primary.organizationId, codigo: 'REVISION_INICIAL' } } });
    await run(primary, () => configurationCatalogV2Service.updateConcept(primary, concept.id, { duracion_estimada: 5, expected_revision: concept.revision }));
    expect((await run(primary, () => actsAndTimesService.get(primary, purchase.id))).effective_activities.find((item: any) => item.concepto_maestro?.codigo === 'REVISION_INICIAL').duracion_estimada).toBe(5);
    const donationOverridden = await run(primary, () => actsAndTimesService.get(primary, donation.id));
    expect(donationOverridden.effective_activities.find((item: any) => item.concepto_maestro?.codigo === 'REVISION_INICIAL')).toMatchObject({ duracion_estimada: 7, heredada_del_acto: false });
    await run(primary, () => configurationCatalogV2Service.revertAttribute(primary, local.id, 'duracion_estimada'));
    expect((await run(primary, () => actsAndTimesService.get(primary, donation.id))).effective_activities.find((item: any) => item.concepto_maestro?.codigo === 'REVISION_INICIAL').duracion_estimada).toBe(5);
  });

  it('quitar una aplicación no borra el concepto ni sus otros usos', async () => {
    const acts = (await run(primary, () => actsAndTimesService.list(primary))).data;
    const donation = acts.find((item) => item.nombre === 'Donación')!; const purchase = acts.find((item) => item.nombre === 'Compraventa')!;
    const detail = await run(primary, () => actsAndTimesService.get(primary, donation.id));
    const target = detail.effective_activities.find((item: any) => item.concepto_maestro?.codigo === 'SOLICITUD_AVALUO');
    await run(primary, () => configurationCatalogV2Service.removeConceptFromAct(primary, donation.id, target.id));
    expect((await run(primary, () => actsAndTimesService.get(primary, donation.id))).effective_activities.some((item: any) => item.concepto_maestro?.codigo === 'SOLICITUD_AVALUO')).toBe(false);
    expect((await run(primary, () => actsAndTimesService.get(primary, purchase.id))).effective_activities.some((item: any) => item.concepto_maestro?.codigo === 'SOLICITUD_AVALUO')).toBe(true);
    expect(await db.configuracionConceptoActividad.count({ where: { organization_id: primary.organizationId, codigo: 'SOLICITUD_AVALUO' } })).toBe(1);
  });

  it('duplicar crea snapshot del acto, pero mantiene referencias a conceptos maestros', async () => {
    const purchase = (await run(primary, () => actsAndTimesService.list(primary))).data.find((item) => item.nombre === 'Compraventa')!;
    const copied = await run(primary, () => configurationCatalogV2Service.duplicateAct(primary, purchase.id, { nombre: `Compraventa snapshot ${randomUUID()}` }));
    const sourceBefore = await run(primary, () => actsAndTimesService.get(primary, purchase.id));
    const sourceApplication = sourceBefore.effective_activities.find((item: any) => item.concepto_maestro?.codigo === 'ENTREGA_CLG');
    const copyBefore = await run(primary, () => actsAndTimesService.get(primary, copied.id));
    const copiedApplication = copyBefore.effective_activities.find((item: any) => item.concepto_maestro?.codigo === 'ENTREGA_CLG');
    expect(copyBefore.configuration.hereda_configuracion_id).toBeNull();
    expect(copiedApplication.concepto_maestro_id).toBe(sourceApplication.concepto_maestro_id);
    await run(primary, () => actsAndTimesService.updateActivity(primary, sourceApplication.id, { grupo_paralelo: 'SOURCE_ONLY' }));
    expect((await run(primary, () => actsAndTimesService.get(primary, copied.id))).effective_activities.find((item: any) => item.concepto_maestro?.codigo === 'ENTREGA_CLG').grupo_paralelo).not.toBe('SOURCE_ONLY');
  });

  it('tiempos institucionales usan override por tenant y fallback general', async () => {
    const bankA = await db.catalogoInstitucion.create({ data: { organization_id: primary.organizationId, nombre: `Banco A ${randomUUID()}`, tipo: 'BANCO' } });
    const bankB = await db.catalogoInstitucion.create({ data: { organization_id: primary.organizationId, nombre: `Banco B ${randomUUID()}`, tipo: 'BANCO' } });
    await run(primary, () => configurationCatalogV2Service.upsertInstitutionResponse(primary, bankA.id, { codigo: 'VOBO_ACREEDOR', nombre: 'Vo.Bo. acreedor', duracion: 10, tipo_dias: 'HABILES' }));
    await run(primary, () => configurationCatalogV2Service.upsertInstitutionResponse(primary, bankB.id, { codigo: 'VOBO_ACREEDOR', nombre: 'Vo.Bo. acreedor', duracion: 20, tipo_dias: 'HABILES' }));
    expect((await db.catalogoInstitucionTipoRespuesta.findUniqueOrThrow({ where: { organization_id_institucion_id_codigo: { organization_id: primary.organizationId, institucion_id: bankA.id, codigo: 'VOBO_ACREEDOR' } } })).duracion).toBe(10);
    expect((await db.catalogoInstitucionTipoRespuesta.findUniqueOrThrow({ where: { organization_id_institucion_id_codigo: { organization_id: primary.organizationId, institucion_id: bankB.id, codigo: 'VOBO_ACREEDOR' } } })).duracion).toBe(20);
    expect((await db.configuracionConceptoActividad.findUniqueOrThrow({ where: { organization_id_codigo: { organization_id: primary.organizationId, codigo: 'VOBO_ACREEDOR' } } })).duracion_estimada).toBe(15);
    const credit = (await run(primary, () => actsAndTimesService.list(primary))).data.find((item) => item.nombre === 'Compraventa con crédito y garantía hipotecaria')!;
    const creditDetail = await run(primary, () => actsAndTimesService.get(primary, credit.id));
    const chainIds: string[] = []; let currentId: string | null = creditDetail.configuration.id;
    while (currentId) {
      chainIds.push(currentId);
      currentId = (await db.configuracionActo.findUniqueOrThrow({ where: { id: currentId }, select: { hereda_configuracion_id: true } })).hereda_configuracion_id;
    }
    await db.configuracionActo.updateMany({ where: { id: { in: chainIds } }, data: { requiere_revision: false } });
    const materialize = async (label: string, institutionId?: string) => {
      const expediente = await db.expediente.create({ data: {
        organization_id: primary.organizationId,
        numero_pravia: `EXP-CFG001-INST-${label}-${randomUUID().slice(0, 8)}`,
        abogado_id: primary.id, creador_id: primary.id, tipo_acto_id: credit.id,
        datos_operacion: institutionId ? { banco_id: institutionId } : {},
      } });
      await db.expedienteActo.create({ data: { organization_id: primary.organizationId, expediente_id: expediente.id, tipo_acto_id: credit.id, origen: 'ADICIONAL', created_by: primary.id } });
      await run(primary, () => new ExpedienteSeguimientoService(prisma).materializeInTransaction(prisma as any, primary, expediente.id));
      return db.expedienteSeguimientoActividad.findFirstOrThrow({ where: {
        expediente_id: expediente.id,
        concepto_maestro: { codigo: 'VOBO_ACREEDOR' },
      } });
    };
    await expect(materialize('A', bankA.id)).resolves.toMatchObject({ duracion_estimada: 10, resolucion_fuente: 'INSTITUTION_RESPONSE', requiere_revision: false });
    await expect(materialize('B', bankB.id)).resolves.toMatchObject({ duracion_estimada: 20, resolucion_fuente: 'INSTITUTION_RESPONSE', requiere_revision: false });
    await expect(materialize('GENERAL')).resolves.toMatchObject({ duracion_estimada: 15, resolucion_fuente: 'GENERAL', requiere_revision: false });
    await expect(run(foreign, () => configurationCatalogV2Service.upsertInstitutionResponse(foreign, bankA.id, { codigo: 'VOBO_ACREEDOR', nombre: 'Ataque', duracion: 1 }))).rejects.toMatchObject({ status: 404 });
  });

  it('rechaza IDs cross-tenant y registra organization en auditoría', async () => {
    const concept = await db.configuracionConceptoActividad.findFirstOrThrow({ where: { organization_id: primary.organizationId } });
    await expect(run(foreign, () => configurationCatalogV2Service.updateConcept(foreign, concept.id, { nombre: 'Filtrado', expected_revision: concept.revision }))).rejects.toMatchObject({ status: 404 });
    const audit = await db.auditLog.findFirstOrThrow({ where: { organization_id: primary.organizationId, accion: 'CFG_V2_LIBRARY_BOOTSTRAPPED' }, orderBy: { created_at: 'desc' } });
    expect(audit).toMatchObject({ organization_id: primary.organizationId, user_id: primary.id });
    const foreignKnownId = (await db.tipoActo.findFirstOrThrow({ where: { organization_id: primary.organizationId } })).id;
    await expect(run(foreign, () => actsAndTimesService.get(foreign, foreignKnownId))).rejects.toMatchObject({ status: 404 });
  });

  it('materializa dos inmuebles, conserva snapshot histórico y aplica maestro nuevo sólo a expedientes nuevos', async () => {
    const purchase = (await run(primary, () => actsAndTimesService.list(primary))).data.find((item) => item.nombre === 'Compraventa')!;
    const detail = await run(primary, () => actsAndTimesService.get(primary, purchase.id));
    const propertyApplication = detail.effective_activities.find((item: any) => item.concepto_maestro?.codigo === 'SOLICITUD_AVALUO');
    await run(primary, () => actsAndTimesService.updateActivity(primary, propertyApplication.id, { alcance_instancia: 'INMUEBLE' }));
    await db.configuracionActo.updateMany({ where: { organization_id: primary.organizationId }, data: { requiere_revision: false } });
    const makeExpediente = async (suffix: string) => {
      const expediente = await db.expediente.create({ data: { organization_id: primary.organizationId, numero_pravia: `EXP-CFG001-${suffix}-${randomUUID().slice(0, 8)}`, abogado_id: primary.id, creador_id: primary.id, tipo_acto_id: purchase.id } });
      await db.expedienteActo.create({ data: { organization_id: primary.organizationId, expediente_id: expediente.id, tipo_acto_id: purchase.id, origen: 'ADICIONAL', created_by: primary.id } });
      for (const label of ['A', 'B']) {
        const property = await db.predio.create({ data: { organization_id: primary.organizationId, apodo: `Inmueble ${label}`, regimen: 'PROPIEDAD', created_by: primary.id, updated_by: primary.id } });
        await db.expedientePredio.create({ data: { organization_id: primary.organizationId, expediente_id: expediente.id, predio_id: property.id, created_by: primary.id } });
      }
      await run(primary, () => new ExpedienteSeguimientoService(prisma).materializeInTransaction(prisma as any, primary, expediente.id));
      return expediente;
    };
    const first = await makeExpediente('A');
    const firstRows = await db.expedienteSeguimientoActividad.findMany({ where: { expediente_id: first.id, concepto_maestro_id: propertyApplication.concepto_maestro_id } });
    expect(firstRows).toHaveLength(2); expect(new Set(firstRows.map((item) => item.alcance_referencia_id)).size).toBe(2);
    const concept = await db.configuracionConceptoActividad.findUniqueOrThrow({ where: { id: propertyApplication.concepto_maestro_id } });
    const oldDuration = firstRows[0].duracion_estimada;
    await run(primary, () => configurationCatalogV2Service.updateConcept(primary, concept.id, { duracion_estimada: oldDuration + 3, expected_revision: concept.revision }));
    expect((await db.expedienteSeguimientoActividad.findMany({ where: { expediente_id: first.id, concepto_maestro_id: concept.id } })).every((item) => item.duracion_estimada === oldDuration)).toBe(true);
    const second = await makeExpediente('B');
    expect((await db.expedienteSeguimientoActividad.findMany({ where: { expediente_id: second.id, concepto_maestro_id: concept.id } })).every((item) => item.duracion_estimada === oldDuration + 3)).toBe(true);
  }, 30_000);

  it('rechaza conflicto optimista y ciclos directos/indirectos', async () => {
    const concept = await db.configuracionConceptoActividad.findFirstOrThrow({ where: { organization_id: primary.organizationId } });
    await expect(run(primary, () => configurationCatalogV2Service.updateConcept(primary, concept.id, { nombre: 'Obsoleto', expected_revision: concept.revision - 1 }))).rejects.toMatchObject({ status: 409, code: 'CFG_CONCEPT_VERSION_CONFLICT' });
    const purchase = (await run(primary, () => actsAndTimesService.list(primary))).data.find((item) => item.nombre === 'Compraventa')!;
    const detail = await run(primary, () => actsAndTimesService.get(primary, purchase.id));
    const [a, b, c] = detail.effective_activities.slice(0, 3);
    await run(primary, () => actsAndTimesService.setDependencies(primary, b.id, { dependency_ids: [a.id] }));
    await run(primary, () => actsAndTimesService.setDependencies(primary, c.id, { dependency_ids: [b.id] }));
    await expect(run(primary, () => actsAndTimesService.setDependencies(primary, a.id, { dependency_ids: [c.id] }))).rejects.toMatchObject({ status: 409, code: 'DEPENDENCY_CYCLE' });
  });
});
