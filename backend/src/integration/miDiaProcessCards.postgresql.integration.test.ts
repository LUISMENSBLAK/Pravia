import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { MiDiaProcessCardsService } from '../services/miDiaProcessCards.service';
import { MiDiaCaseCardsService } from '../services/miDiaCaseCards.service';
import { MiDiaSignatureCardsService } from '../services/miDiaSignatureCards.service';
import { MiDiaUserLoadService } from '../services/miDiaUserLoad.service';
import { MiDiaProcessAverageService } from '../services/miDiaProcessAverage.service';
import { MiDiaSigningAverageService } from '../services/miDiaSigningAverage.service';

const target = process.env.DATABASE_URL || '';
const parsed = new URL(target || 'postgresql://invalid.invalid/blocked');
if (process.env.MIDIA_QA === '1' && (process.env.NODE_ENV !== 'test'
  || target !== process.env.DIRECT_URL || parsed.hostname !== '127.0.0.1'
  || parsed.port !== '55510' || parsed.pathname !== '/pravia_qa'
  || parsed.searchParams.get('schema') !== 'pravia_os')) {
  throw new Error('Mi Día process-card integration requires isolated local PostgreSQL.');
}
const db = new PrismaClient({ datasources: { db: { url: target } } });
type Actor = NonNullable<Request['user']>;
afterAll(async () => db.$disconnect());

describe.runIf(process.env.MIDIA_QA === '1')('Mi Día process cards · physical PostgreSQL', () => {
  it('counts real EXP-005 rows by tenant, object, assignee and date, then rolls back fixtures', async () => {
    const ids = { org: randomUUID(), foreignOrg: randomUUID(), owner: randomUUID(), peer: randomUUID(),
      foreign: randomUUID(), ownCase: randomUUID(), peerCase: randomUUID(), pendingCase: randomUUID(), signedCase: randomUUID(),
      deliveryCase: randomUUID(), deliveredCase: randomUUID(), foreignCase: randomUUID(),
      type: randomUUID(), ownAct: randomUUID(), peerAct: randomUUID(), signedAct: randomUUID(), deliveredAct: randomUUID(), foreignAct: randomUUID(),
      ownProcess: randomUUID(), peerProcess: randomUUID(), signedProcess: randomUUID(), foreignProcess: randomUUID(), overdueProcess: randomUUID(),
      catConcept: randomUUID(), rppConcept: randomUUID(), testimonyConcept: randomUUID(), foreignRppConcept: randomUUID(),
      catProcess: randomUUID(), rppProcess: randomUUID(), testimonyProcess: randomUUID(), deliveredTestimony: randomUUID(),
      review: randomUUID(), state: randomUUID(), requirement: randomUUID() };
    const completed = { own: randomUUID(), peer: randomUUID(), foreign: randomUUID() };
    const now = new Date('2026-10-13T12:00:00.000Z');
    const actor: Actor = { id: ids.owner, email: 'process-qa@example.test', nombre: 'QA', apellido: 'Local',
      rol: 'ABOGADO', scope: 'ASSIGNED_OBJECTS', organizationId: ids.org, membershipId: randomUUID(),
      sessionId: randomUUID(), permissions: ['expedientes.read'], requiresPasswordChange: false };
    const director: Actor = { ...actor, rol: 'DIRECCION', scope: 'GLOBAL' };
    const rollback = new Error('MI_DIA_PROCESS_CARDS_ROLLBACK');
    try {
      await db.$transaction(async (tx) => {
        await tx.organization.createMany({ data: [{ id: ids.org, name: 'Mi Día process QA' },
          { id: ids.foreignOrg, name: 'Mi Día process foreign QA' }] });
        await tx.user.createMany({ data: [ids.owner, ids.peer, ids.foreign].map((id) => ({ id,
          nombre: 'Proceso', apellido: 'QA', email: `process-${id}@example.test`,
          password_hash: 'synthetic-only', rol: 'ABOGADO' })) });
        await tx.organizationMembership.createMany({ data: [
          { organization_id: ids.org, user_id: ids.owner, rol: 'ABOGADO' },
          { organization_id: ids.org, user_id: ids.peer, rol: 'ABOGADO' },
          { organization_id: ids.foreignOrg, user_id: ids.foreign, rol: 'ABOGADO' },
        ] });
        await tx.tipoActo.create({ data: { id: ids.type, nombre: 'Acto QA Seguimiento' } });
        await tx.expediente.createMany({ data: [
          { id: ids.ownCase, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.ownCase}`, abogado_id: ids.owner, creador_id: ids.owner,
            estatus: 'SUSPENDIDO', created_at: new Date('2026-10-01T00:00:00.000Z') },
          { id: ids.peerCase, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.peerCase}`, abogado_id: ids.peer, creador_id: ids.peer,
            estatus: 'FIRMA_PROGRAMADA', fecha_estimada_firma: new Date('2026-10-15T12:00:00.000Z') },
          { id: ids.pendingCase, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.pendingCase}`, abogado_id: ids.owner, creador_id: ids.owner,
            estatus: 'FIRMA_PROGRAMADA', fecha_estimada_firma: new Date('2026-10-15T12:00:00.000Z') },
          { id: ids.signedCase, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.signedCase}`, abogado_id: ids.owner, creador_id: ids.owner,
            estatus: 'FIRMADO', fecha_real_firma: new Date('2026-10-13T10:00:00.000Z') },
          { id: ids.deliveryCase, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.deliveryCase}`, abogado_id: ids.peer, creador_id: ids.peer,
            estatus: 'LISTO_ENTREGA', fecha_real_firma: new Date('2026-10-10T10:00:00.000Z') },
          { id: ids.deliveredCase, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.deliveredCase}`, abogado_id: ids.peer, creador_id: ids.peer,
            estatus: 'ENTREGADO', fecha_real_firma: new Date('2026-10-10T10:00:00.000Z'), fecha_entrega_cliente: new Date('2026-10-11T10:00:00.000Z') },
          { id: ids.foreignCase, organization_id: ids.foreignOrg, numero_pravia: `EXP-QA-${ids.foreignCase}`, abogado_id: ids.foreign, creador_id: ids.foreign,
            estatus: 'POST_FIRMA', fecha_real_firma: new Date('2026-10-13T10:00:00.000Z') },
        ] });
        await tx.expedienteActo.createMany({ data: [
          { id: ids.ownAct, organization_id: ids.org, expediente_id: ids.ownCase, tipo_acto_id: ids.type, origen: 'ADICIONAL', created_by: ids.owner },
          { id: ids.peerAct, organization_id: ids.org, expediente_id: ids.peerCase, tipo_acto_id: ids.type, origen: 'ADICIONAL', created_by: ids.peer },
          { id: ids.signedAct, organization_id: ids.org, expediente_id: ids.signedCase, tipo_acto_id: ids.type, origen: 'ADICIONAL', created_by: ids.owner },
          { id: ids.deliveredAct, organization_id: ids.org, expediente_id: ids.deliveredCase, tipo_acto_id: ids.type, origen: 'ADICIONAL', created_by: ids.peer },
          { id: ids.foreignAct, organization_id: ids.foreignOrg, expediente_id: ids.foreignCase, tipo_acto_id: ids.type, origen: 'ADICIONAL', created_by: ids.foreign },
        ] });
        await tx.configuracionConceptoActividad.createMany({ data: [
          { id: ids.catConcept, organization_id: ids.org, codigo: 'SOLVENCIA_INGRESO', nombre: 'Ingreso a Solvencia / Catastro' },
          { id: ids.rppConcept, organization_id: ids.org, codigo: 'RPP_INGRESO', nombre: 'Ingreso a Registro Público' },
          { id: ids.testimonyConcept, organization_id: ids.org, codigo: 'ARMADO_TESTIMONIO', nombre: 'Armado de testimonio' },
          { id: ids.foreignRppConcept, organization_id: ids.foreignOrg, codigo: 'RPP_INGRESO', nombre: 'Registro ajeno' },
        ] });
        await tx.complianceReview.create({ data: {
          id: ids.review, organization_id: ids.org, expediente_id: ids.pendingCase, tipo: 'QA_PRE_FIRMA',
          rule_version_snapshot: 'QA', cuestionario_json: {}, creado_por_id: ids.owner,
          rule_snapshot: {}, master_snapshot: {},
        } });
        await tx.expedienteComplianceState.create({ data: {
          id: ids.state, organization_id: ids.org, expediente_id: ids.pendingCase,
          current_review_id: ids.review, updated_by_id: ids.owner,
        } });
        await tx.complianceRequirement.create({ data: {
          id: ids.requirement, organization_id: ids.org, expediente_id: ids.pendingCase,
          state_id: ids.state, review_id: ids.review, provider: 'FIR', requirement_key: 'QA_MISSING',
          label: 'Documento previo a firma QA', status: 'PENDIENTE', phase: 'PRE_FIRMA', source_snapshot: {},
        } });
        await tx.expedienteSeguimientoActividad.createMany({ data: [
          [ids.ownProcess, ids.org, ids.ownCase, ids.ownAct, ids.owner],
          [ids.peerProcess, ids.org, ids.peerCase, ids.peerAct, ids.peer],
          [ids.foreignProcess, ids.foreignOrg, ids.foreignCase, ids.foreignAct, ids.foreign],
        ].map(([id, organization_id, expediente_id, expediente_acto_id, responsable_id]) => ({
          id, organization_id, expediente_id, expediente_acto_id, tipo_acto_id: ids.type,
          proceso_clave: `QA:${id}`, identidad_instancia: `QA:${id}`, etapa_nombre_snapshot: 'QA',
          etapa_orden_snapshot: 1, actividad_nombre_snapshot: 'Proceso de prueba',
          duracion_estimada: 1, tipo_dias: 'HABILES' as const, responsable_id,
          estado: 'EN_PROCESO' as const, primera_fecha_inicio: new Date('2026-10-12T00:00:00.000Z'),
        })) });
        await tx.expedienteSeguimientoActividad.create({ data: {
          id: ids.overdueProcess, organization_id: ids.org, expediente_id: ids.ownCase,
          expediente_acto_id: ids.ownAct, tipo_acto_id: ids.type,
          proceso_clave: `QA:${ids.overdueProcess}`, identidad_instancia: `QA:${ids.overdueProcess}`,
          etapa_nombre_snapshot: 'QA', etapa_orden_snapshot: 1,
          actividad_nombre_snapshot: 'Proceso vencido QA', duracion_estimada: 1, tipo_dias: 'HABILES',
          responsable_id: ids.owner, estado: 'EN_PROCESO',
          primera_fecha_inicio: new Date('2026-10-08T00:00:00.000Z'),
        } });
        const caseCards = new MiDiaCaseCardsService(tx as unknown as PrismaClient);
        expect((await caseCards.read(actor, 'POSTSIGN_PENDING', { scope: 'OWN', now })).count).toBe(0);
        await tx.expedienteSeguimientoActividad.create({ data: {
          id: ids.signedProcess, organization_id: ids.org, expediente_id: ids.signedCase,
          expediente_acto_id: ids.signedAct, tipo_acto_id: ids.type,
          proceso_clave: `QA:${ids.signedProcess}`, identidad_instancia: `QA:${ids.signedProcess}`,
          etapa_nombre_snapshot: 'Postfirma', etapa_orden_snapshot: 3,
          actividad_nombre_snapshot: 'Solvencia QA', duracion_estimada: 2, tipo_dias: 'HABILES',
          responsable_id: ids.owner, estado: 'NO_INICIADO',
        } });
        await tx.expedienteSeguimientoActividad.createMany({ data: [
          [ids.catProcess, ids.signedCase, ids.signedAct, ids.owner, ids.catConcept],
          [ids.rppProcess, ids.signedCase, ids.signedAct, ids.owner, ids.rppConcept],
          [ids.testimonyProcess, ids.signedCase, ids.signedAct, ids.owner, ids.testimonyConcept],
          [ids.deliveredTestimony, ids.deliveredCase, ids.deliveredAct, ids.peer, ids.testimonyConcept],
        ].map(([id, expediente_id, expediente_acto_id, responsable_id, concepto_maestro_id]) => ({
          id, organization_id: ids.org, expediente_id, expediente_acto_id, responsable_id,
          tipo_acto_id: ids.type, concepto_maestro_id,
          proceso_clave: `QA:${id}`, identidad_instancia: `QA:${id}`,
          etapa_nombre_snapshot: 'Cierre', etapa_orden_snapshot: 5,
          actividad_nombre_snapshot: 'Actividad canónica QA', duracion_estimada: 2, tipo_dias: 'HABILES' as const,
          estado: 'NO_INICIADO' as const,
        })) });
        await tx.expedienteSeguimientoActividad.update({ where: { id: ids.foreignProcess },
          data: { concepto_maestro_id: ids.foreignRppConcept } });
        const source = new MiDiaProcessCardsService(tx as unknown as PrismaClient);
        const own = await source.read(actor, 'DUE_TODAY', { scope: 'OWN', now });
        const tenant = await source.read(director, 'DUE_TODAY', { scope: 'ORGANIZATION', now });
        expect((await source.read(actor, 'CATASTRO_PENDING', { scope: 'OWN', now })).items.map((item) => item.id)).toEqual([ids.catProcess]);
        expect((await source.read(director, 'RPP_PENDING', { scope: 'ORGANIZATION', now })).items.map((item) => item.id)).toEqual([ids.rppProcess]);
        expect((await source.read(actor, 'TESTIMONIES_PENDING', { scope: 'OWN', now })).items.map((item) => item.id)).toEqual([ids.testimonyProcess]);
        expect((await source.read(director, 'TESTIMONIES_PENDING', { scope: 'ORGANIZATION', now })).count).toBe(1);
        expect((await source.read(actor, 'RPP_PENDING', { scope: 'OWN', now })).items[0].href)
          .toBe(`/expedientes/${ids.signedCase}?process_id=${ids.rppProcess}#seguimiento`);
        expect(own.items.map((item) => item.id)).toEqual([ids.ownProcess]);
        expect(tenant.count).toBe(2);
        expect(tenant.items.map((item) => item.id)).not.toContain(ids.foreignProcess);
        expect((await caseCards.read(actor, 'CASES_INACTIVE', { scope: 'OWN', now, window: 7 })).items.map((item) => item.id)).toEqual([ids.ownCase]);
        expect((await caseCards.read(actor, 'CASES_DELAYED', { scope: 'OWN', now })).items.map((item) => item.id)).toEqual([ids.ownCase]);
        expect((await caseCards.read(actor, 'CASES_BLOCKED', { scope: 'OWN', now })).items.map((item) => item.id)).toEqual([ids.ownCase]);
        expect((await caseCards.read(actor, 'POSTSIGN_PENDING', { scope: 'OWN', now })).items.map((item) => item.id)).toEqual([ids.signedCase]);
        expect((await caseCards.read(director, 'POSTSIGN_PENDING', { scope: 'ORGANIZATION', now })).count).toBe(1);
        expect((await caseCards.read(actor, 'DELIVERIES_PENDING', { scope: 'OWN', now })).count).toBe(0);
        expect((await caseCards.read(director, 'DELIVERIES_PENDING', { scope: 'ORGANIZATION', now })).items.map((item) => item.id)).toEqual([ids.deliveryCase]);
        const signatures = new MiDiaSignatureCardsService(tx as unknown as PrismaClient);
        expect((await signatures.read(director, 'READY_TO_SIGN', { scope: 'ORGANIZATION', now })).items.map((item) => item.id)).toEqual([ids.peerCase]);
        expect((await signatures.read(actor, 'READY_TO_SIGN', { scope: 'OWN', now })).count).toBe(0);
        expect((await signatures.read(actor, 'NOT_READY_TO_SIGN', { scope: 'OWN', now, window: 3 })).items.map((item) => item.id)).toEqual([ids.pendingCase]);
        expect((await signatures.read(director, 'NOT_READY_TO_SIGN', { scope: 'ORGANIZATION', now, window: 1 })).count).toBe(0);
        expect((await signatures.read(actor, 'SIGNED_TODAY', { scope: 'OWN', now })).items.map((item) => item.id)).toEqual([ids.signedCase]);
        expect((await signatures.read(director, 'SIGNED_PERIOD', { scope: 'ORGANIZATION', now, period: 'MONTH' })).items.map((item) => item.id))
          .toEqual(expect.arrayContaining([ids.signedCase, ids.deliveryCase]));
        const editor = { ...actor, permissions: ['expedientes.read', 'expedientes.write', 'ai.work.read'] };
        const advance = await source.read(editor, 'CAN_ADVANCE_TODAY', { scope: 'OWN', now, limit: 2 });
        expect(advance.count).toBe(6);
        expect(advance.items).toHaveLength(2);
        expect(advance.items.map((item) => item.id)).not.toContain(ids.peerProcess);
        expect((await source.read({ ...director, permissions: editor.permissions }, 'CAN_ADVANCE_TODAY',
          { scope: 'ORGANIZATION', now })).count).toBe(8);
        await expect(source.read(actor, 'CAN_ADVANCE_TODAY', { scope: 'OWN', now }))
          .rejects.toThrow('MIDIA_PROCESS_ACTION_READ_DENIED');
        const load = await new MiDiaUserLoadService(tx as unknown as PrismaClient).read({ ...director,
          permissions: ['reportes.read', 'expedientes.read'] }, {});
        expect(load.count).toBe(2);
        expect(load.items.find((item) => item.id === ids.owner)).toMatchObject({ expedientes: 2, procesos: 4 });
        expect(load.items.find((item) => item.id === ids.peer)).toMatchObject({ expedientes: 2, procesos: 1 });
        expect(load.items.map((item) => item.id)).not.toContain(ids.foreign);
        await tx.expedienteSeguimientoActividad.createMany({ data: [
          { id: completed.own, organization_id: ids.org, expediente_id: ids.signedCase,
            expediente_acto_id: ids.signedAct, tipo_acto_id: ids.type, proceso_clave: 'QA:AVERAGE',
            identidad_instancia: `QA:${completed.own}`, etapa_nombre_snapshot: 'QA', etapa_orden_snapshot: 1,
            actividad_nombre_snapshot: 'Registro QA', duracion_estimada: 2, tipo_dias: 'HABILES',
            responsable_id: ids.owner, estado: 'COMPLETADO',
            primera_fecha_inicio: new Date('2026-10-09T00:00:00Z'), fecha_completada_actual: new Date('2026-10-13T00:00:00Z') },
          { id: completed.peer, organization_id: ids.org, expediente_id: ids.peerCase,
            expediente_acto_id: ids.peerAct, tipo_acto_id: ids.type, proceso_clave: 'QA:AVERAGE',
            identidad_instancia: `QA:${completed.peer}`, etapa_nombre_snapshot: 'QA', etapa_orden_snapshot: 1,
            actividad_nombre_snapshot: 'Registro QA', duracion_estimada: 2, tipo_dias: 'HABILES',
            responsable_id: ids.peer, estado: 'COMPLETADO',
            primera_fecha_inicio: new Date('2026-10-12T00:00:00Z'), fecha_completada_actual: new Date('2026-10-13T00:00:00Z') },
          { id: completed.foreign, organization_id: ids.foreignOrg, expediente_id: ids.foreignCase,
            expediente_acto_id: ids.foreignAct, tipo_acto_id: ids.type, proceso_clave: 'QA:AVERAGE',
            identidad_instancia: `QA:${completed.foreign}`, etapa_nombre_snapshot: 'QA', etapa_orden_snapshot: 1,
            actividad_nombre_snapshot: 'Registro QA', duracion_estimada: 2, tipo_dias: 'HABILES',
            responsable_id: ids.foreign, estado: 'COMPLETADO',
            primera_fecha_inicio: new Date('2026-10-09T00:00:00Z'), fecha_completada_actual: new Date('2026-10-13T00:00:00Z') },
        ] });
        const average = new MiDiaProcessAverageService(tx as unknown as PrismaClient);
        const averageOrg = await average.read({ ...director, permissions: ['expedientes.read'] },
          { scope: 'ORGANIZATION', period: 'MONTH', now });
        expect(averageOrg.count).toBe(2);
        expect(averageOrg.items[0]).toMatchObject({ key: 'QA:AVERAGE:HABILES', promedio_dias: 1.5, procesos: 2 });
        expect((await average.read(actor, { scope: 'OWN', period: 'MONTH', now })).items[0])
          .toMatchObject({ promedio_dias: 2, procesos: 1 });
        await tx.expediente.update({ where: { id: ids.signedCase }, data: { fecha_apertura: new Date('2026-10-01T00:00:00Z') } });
        await tx.expediente.update({ where: { id: ids.deliveryCase }, data: { fecha_apertura: new Date('2026-10-03T00:00:00Z') } });
        await tx.expediente.update({ where: { id: ids.foreignCase }, data: { fecha_apertura: new Date('2026-10-01T00:00:00Z') } });
        const signingAverage = new MiDiaSigningAverageService(tx as unknown as PrismaClient);
        const signedOrg = await signingAverage.read({ ...director, permissions: ['expedientes.read'] },
          { scope: 'ORGANIZATION', period: 'MONTH', now });
        expect(signedOrg.count).toBe(2);
        expect(signedOrg.promedio_dias_naturales).toBe(9.9);
        expect(signedOrg.items.map((item) => item.id)).toEqual(expect.arrayContaining([ids.signedCase, ids.deliveryCase]));
        expect((await signingAverage.read(actor, { scope: 'OWN', period: 'MONTH', now })).items.map((item) => item.id))
          .toEqual([ids.signedCase]);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    expect(await db.expedienteSeguimientoActividad.count({ where: { id: { in: [ids.ownProcess, ids.peerProcess, ids.signedProcess, ids.foreignProcess, ids.overdueProcess,
      ids.catProcess, ids.rppProcess, ids.testimonyProcess, ids.deliveredTestimony, ...Object.values(completed)] } } })).toBe(0);
  });
});
