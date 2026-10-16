import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { miDiaDashboardScope } from '../services/miDiaDashboardScope';
import { MiDiaCaseCardsService } from '../services/miDiaCaseCards.service';
import { MiDiaSignatureCardsService } from '../services/miDiaSignatureCards.service';

const target = process.env.DATABASE_URL || '';
const parsed = new URL(target || 'postgresql://invalid.invalid/blocked');
if (process.env.MIDIA_QA === '1' && (process.env.NODE_ENV !== 'test'
  || target !== process.env.DIRECT_URL || parsed.hostname !== '127.0.0.1'
  || parsed.port !== '55510' || parsed.pathname !== '/pravia_qa'
  || parsed.searchParams.get('schema') !== 'pravia_os')) {
  throw new Error('Mi Día PostgreSQL requires the explicit isolated local pravia_qa target.');
}

const db = new PrismaClient({ datasources: { db: { url: target } } });
type Actor = NonNullable<Request['user']>;
const ids = {
  org: randomUUID(), foreignOrg: randomUUID(), admin: randomUUID(), attorney: randomUUID(), peer: randomUUID(), foreignUser: randomUUID(),
  caseA: randomUUID(), casePeer: randomUUID(), caseForeign: randomUUID(),
  quoteA: randomUUID(), quotePeer: randomUUID(), quoteForeign: randomUUID(),
  taskA: randomUUID(), taskPeer: randomUUID(), taskForeign: randomUUID(),
  privateA: randomUUID(), privatePeer: randomUUID(), publicEvent: randomUUID(), foreignEvent: randomUUID(),
  signingA: randomUUID(), signingPeer: randomUUID(), signingForeign: randomUUID(),
};
const actor = (id: string, rol: Actor['rol'], scope: Actor['scope'], organizationId = ids.org): Actor => ({
  id, rol, scope, organizationId, membershipId: randomUUID(), sessionId: randomUUID(),
  nombre: 'Mi Día', apellido: 'QA', email: `midia-${id}@example.test`,
  permissions: ['mi_dia.read', 'expedientes.read', 'agenda.read', 'cotizaciones.read', 'finanzas.read'], requiresPasswordChange: false,
});

afterAll(async () => db.$disconnect());

describe.runIf(process.env.MIDIA_QA === '1')('Mi Día · límites físicos PostgreSQL locales', () => {
  it('no mezcla tenant, objeto privado ni usuario forjado; no persiste fixtures', async () => {
    const rollback = new Error('MI_DIA_QA_ROLLBACK');
    try {
      await db.$transaction(async (tx) => {
        await tx.organization.createMany({ data: [
          { id: ids.org, name: `Mi Día QA ${ids.org}` }, { id: ids.foreignOrg, name: `Mi Día externo ${ids.foreignOrg}` },
        ] });
        await tx.user.createMany({ data: [
          { id: ids.admin, nombre: 'Admin', apellido: 'QA', email: `midia-${ids.admin}@example.test`, password_hash: 'synthetic-only', rol: 'DIRECCION' },
          { id: ids.attorney, nombre: 'Abogado', apellido: 'QA', email: `midia-${ids.attorney}@example.test`, password_hash: 'synthetic-only', rol: 'ABOGADO' },
          { id: ids.peer, nombre: 'Colega', apellido: 'QA', email: `midia-${ids.peer}@example.test`, password_hash: 'synthetic-only', rol: 'ABOGADO' },
          { id: ids.foreignUser, nombre: 'Externo', apellido: 'QA', email: `midia-${ids.foreignUser}@example.test`, password_hash: 'synthetic-only', rol: 'ABOGADO' },
        ] });
        await tx.organizationMembership.createMany({ data: [
          { organization_id: ids.org, user_id: ids.admin, rol: 'DIRECCION' },
          { organization_id: ids.org, user_id: ids.attorney, rol: 'ABOGADO' },
          { organization_id: ids.org, user_id: ids.peer, rol: 'ABOGADO' },
          { organization_id: ids.foreignOrg, user_id: ids.foreignUser, rol: 'ABOGADO' },
        ] });
        await tx.expediente.createMany({ data: [
          { id: ids.caseA, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.caseA}`, abogado_id: ids.attorney, creador_id: ids.attorney, fecha_estimada_firma: new Date(Date.now() + 2 * 86_400_000) },
          { id: ids.casePeer, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.casePeer}`, abogado_id: ids.peer, creador_id: ids.peer, fecha_estimada_firma: new Date(Date.now() + 2 * 86_400_000) },
          { id: ids.caseForeign, organization_id: ids.foreignOrg, numero_pravia: `EXP-QA-${ids.caseForeign}`, abogado_id: ids.foreignUser, creador_id: ids.foreignUser, fecha_estimada_firma: new Date(Date.now() + 2 * 86_400_000) },
        ] });
        await tx.tarea.createMany({ data: [
          { id: ids.taskA, organization_id: ids.org, expediente_id: ids.caseA, asignado_a_id: ids.attorney, creador_id: ids.admin, titulo: 'Mi tarea' },
          { id: ids.taskPeer, organization_id: ids.org, expediente_id: ids.casePeer, asignado_a_id: ids.peer, creador_id: ids.admin, titulo: 'Tarea colega' },
          { id: ids.taskForeign, organization_id: ids.foreignOrg, expediente_id: ids.caseForeign, asignado_a_id: ids.foreignUser, creador_id: ids.foreignUser, titulo: 'Tarea externa' },
        ] });
        await tx.eventoAgenda.createMany({ data: [
          { id: ids.privateA, organization_id: ids.org, user_id: ids.attorney, created_by_id: ids.attorney, titulo: 'Privado A', tipo: 'CITA', fecha_inicio: new Date(), visibilidad: 'PRIVATE' },
          { id: ids.privatePeer, organization_id: ids.org, user_id: ids.peer, created_by_id: ids.peer, titulo: 'Privado colega', tipo: 'CITA', fecha_inicio: new Date(), visibilidad: 'PRIVATE' },
          { id: ids.publicEvent, organization_id: ids.org, user_id: ids.peer, created_by_id: ids.peer, titulo: 'Público', tipo: 'CITA', fecha_inicio: new Date(), visibilidad: 'ORGANIZATION' },
          { id: ids.foreignEvent, organization_id: ids.foreignOrg, user_id: ids.foreignUser, created_by_id: ids.foreignUser, titulo: 'Evento externo', tipo: 'CITA', fecha_inicio: new Date(), visibilidad: 'ORGANIZATION' },
          { id: ids.signingA, organization_id: ids.org, user_id: ids.attorney, created_by_id: ids.attorney, expediente_id: ids.caseA, titulo: 'Firma privada A', tipo: 'FIRMA', fecha_inicio: new Date(), visibilidad: 'PRIVATE' },
          { id: ids.signingPeer, organization_id: ids.org, user_id: ids.peer, created_by_id: ids.peer, expediente_id: ids.casePeer, titulo: 'Firma pública', tipo: 'FIRMA', fecha_inicio: new Date(), visibilidad: 'ORGANIZATION' },
          { id: ids.signingForeign, organization_id: ids.foreignOrg, user_id: ids.foreignUser, created_by_id: ids.foreignUser, expediente_id: ids.caseForeign, titulo: 'Firma externa', tipo: 'FIRMA', fecha_inicio: new Date(), visibilidad: 'ORGANIZATION' },
        ] });
        await tx.cotizacion.createMany({ data: [
          { id: ids.quoteA, organization_id: ids.org, user_id: ids.attorney },
          { id: ids.quotePeer, organization_id: ids.org, user_id: ids.peer },
          { id: ids.quoteForeign, organization_id: ids.foreignOrg, user_id: ids.foreignUser },
        ] });
        for (const [quoteId, organizationId, userId] of [
          [ids.quoteA, ids.org, ids.attorney], [ids.quotePeer, ids.org, ids.peer], [ids.quoteForeign, ids.foreignOrg, ids.foreignUser],
        ]) {
          const effectiveAt = new Date();
          const created = await tx.cotizacionTransicion.create({ data: {
            organization_id: organizationId, cotizacion_id: quoteId, actor_id: userId,
            etapa_anterior: null, etapa_nueva: 'BORRADOR', effective_at: effectiveAt, recorded_at: effectiveAt,
            accion: 'CREAR', procedencia: 'CONFIRMACION_HUMANA', evidencia: {}, version: 1,
            idempotency_key: `midia-create-${quoteId}`, payload_hash: 'a'.repeat(64), cambia_etapa: true,
          } });
          await tx.cotizacion.update({ where: { id: quoteId }, data: {
            etapa_contractual: 'BORRADOR', version_operativa: 1, transicion_actual_id: created.id,
          } });
          const sent = await tx.cotizacionTransicion.create({ data: {
            organization_id: organizationId, cotizacion_id: quoteId, actor_id: userId,
            etapa_anterior: 'BORRADOR', etapa_nueva: 'ENVIADA_CLIENTE', effective_at: effectiveAt, recorded_at: effectiveAt,
            accion: 'ENVIAR_CLIENTE', procedencia: 'CONFIRMACION_HUMANA', canal: 'EMAIL', destinatario: 'qa@example.test',
            evidencia: {}, version: 2, idempotency_key: `midia-send-${quoteId}`, payload_hash: 'b'.repeat(64), cambia_etapa: true,
          } });
          await tx.cotizacion.update({ where: { id: quoteId }, data: {
            etapa_contractual: 'ENVIADA_CLIENTE', version_operativa: 2, transicion_actual_id: sent.id,
          } });
        }

        const admin = miDiaDashboardScope(actor(ids.admin, 'DIRECCION', 'GLOBAL'));
        const adminOwn = miDiaDashboardScope(actor(ids.admin, 'DIRECCION', 'GLOBAL'), ids.peer, 'OWN');
        const assigned = miDiaDashboardScope(actor(ids.attorney, 'ABOGADO', 'ASSIGNED_OBJECTS'), ids.peer);
        const financial = miDiaDashboardScope(actor(ids.admin, 'FINANCIERO', 'GLOBAL'));
        const cases = async (where: typeof admin.caseWhere) => (await tx.expediente.findMany({ where, select: { id: true } })).map((row) => row.id);
        const tasks = async (where: typeof admin.taskWhere) => (await tx.tarea.findMany({ where, select: { id: true } })).map((row) => row.id);
        const events = async (where: typeof admin.eventWhere) => (await tx.eventoAgenda.findMany({ where, select: { id: true } })).map((row) => row.id);
        const quotes = async (where: typeof admin.quoteWhere) => (await tx.cotizacion.findMany({ where, select: { id: true } })).map((row) => row.id);
        expect(await cases(admin.caseWhere)).toEqual(expect.arrayContaining([ids.caseA, ids.casePeer]));
        expect(await cases(admin.caseWhere)).not.toContain(ids.caseForeign);
        expect(await cases(adminOwn.caseWhere)).toEqual([]);
        expect(await tasks(admin.taskWhere)).toEqual(expect.arrayContaining([ids.taskA, ids.taskPeer]));
        expect(await tasks(admin.taskWhere)).not.toContain(ids.taskForeign);
        expect(await tasks(adminOwn.taskWhere)).toEqual([]);
        expect(await events(admin.eventWhere)).toContain(ids.publicEvent);
        expect(await events(admin.eventWhere)).not.toContain(ids.privatePeer);
        expect(await events(admin.eventWhere)).not.toContain(ids.foreignEvent);
        expect(await events(adminOwn.eventWhere)).toEqual([]);
        expect(await quotes(admin.quoteWhere)).toEqual(expect.arrayContaining([ids.quoteA, ids.quotePeer]));
        expect(await quotes(admin.quoteWhere)).not.toContain(ids.quoteForeign);
        expect(await quotes(adminOwn.quoteWhere)).toEqual([]);
        expect(await cases(assigned.caseWhere)).toEqual([ids.caseA]);
        const upcomingSignatureWindow = { gte: new Date(Date.now() - 60_000), lte: new Date(Date.now() + 7 * 86_400_000) };
        expect(await tx.expediente.count({ where: { ...assigned.caseWhere, fecha_real_firma: null, fecha_estimada_firma: upcomingSignatureWindow } })).toBe(1);
        expect(await tx.expediente.count({ where: { ...admin.caseWhere, fecha_real_firma: null, fecha_estimada_firma: upcomingSignatureWindow } })).toBe(2);
        expect(await tx.expediente.count({ where: { ...adminOwn.caseWhere, fecha_real_firma: null, fecha_estimada_firma: upcomingSignatureWindow } })).toBe(0);
        expect(await tasks(assigned.taskWhere)).toEqual([ids.taskA]);
        expect(await events(assigned.eventWhere)).toContain(ids.privateA);
        expect(await events(assigned.eventWhere)).not.toContain(ids.privatePeer);
        const appointmentWindow = { gte: new Date(Date.now() - 60_000), lte: new Date(Date.now() + 7 * 86_400_000) };
        expect(await tx.eventoAgenda.count({ where: { ...assigned.eventWhere, estatus: 'ACTIVO', tipo: 'CITA', fecha_inicio: appointmentWindow } })).toBe(1);
        expect(await tx.eventoAgenda.count({ where: { ...admin.eventWhere, estatus: 'ACTIVO', tipo: 'CITA', fecha_inicio: appointmentWindow } })).toBe(1);
        expect(await tx.eventoAgenda.count({ where: { ...assigned.eventWhere, estatus: 'ACTIVO', tipo: 'FIRMA', fecha_inicio: appointmentWindow } })).toBe(1);
        expect(await tx.eventoAgenda.count({ where: { ...admin.eventWhere, estatus: 'ACTIVO', tipo: 'FIRMA', fecha_inicio: appointmentWindow } })).toBe(1);
        expect(await quotes(assigned.quoteWhere)).toEqual([ids.quoteA]);
        expect(await cases(financial.caseWhere)).toEqual([]);
        expect(await cases(financial.financialCaseWhere)).toEqual(expect.arrayContaining([ids.caseA, ids.casePeer]));
        expect(await cases(financial.financialCaseWhere)).not.toContain(ids.caseForeign);
        await tx.expediente.update({ where: { id: ids.caseA }, data: { estatus: 'FIRMADO', fecha_real_firma: new Date() } });
        await tx.expediente.update({ where: { id: ids.casePeer }, data: { estatus: 'ENTREGADO' } });
        await tx.expediente.update({ where: { id: ids.caseForeign }, data: { estatus: 'FIRMADO', fecha_real_firma: new Date() } });
        const caseCards = new MiDiaCaseCardsService(tx as unknown as PrismaClient);
        const signatureCards = new MiDiaSignatureCardsService(tx as unknown as PrismaClient);
        const lawyer = actor(ids.attorney, 'ABOGADO', 'ASSIGNED_OBJECTS');
        const active = await caseCards.read(lawyer, 'MY_ACTIVE_CASES', { scope: 'OWN', limit: 1 });
        expect(active.count).toBe(1);
        expect(active.items.map((row) => row.id)).toEqual([ids.caseA]);
        expect((await caseCards.read(actor(ids.admin, 'DIRECCION', 'GLOBAL'), 'MY_ACTIVE_CASES',
          { scope: 'OWN', requestedUserId: ids.attorney })).count).toBe(0);
        const signedTenant = await signatureCards.read(actor(ids.admin, 'DIRECCION', 'GLOBAL'), 'SIGNED_CASES',
          { scope: 'ORGANIZATION', period: 'TODAY', timezone: 'America/Mexico_City', limit: 1 });
        expect(signedTenant.count).toBe(1);
        expect(signedTenant.items.map((row) => row.id)).toEqual([ids.caseA]);
        expect((await signatureCards.read(lawyer, 'SIGNED_CASES',
          { scope: 'OWN', period: 'TODAY', timezone: 'America/Mexico_City' })).count).toBe(1);
        expect((await signatureCards.read(actor(ids.admin, 'DIRECCION', 'GLOBAL'), 'SIGNED_CASES',
          { scope: 'OWN', period: 'TODAY', timezone: 'America/Mexico_City' })).count).toBe(0);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    expect(await db.organization.count({ where: { id: { in: [ids.org, ids.foreignOrg] } } })).toBe(0);
  });
});
