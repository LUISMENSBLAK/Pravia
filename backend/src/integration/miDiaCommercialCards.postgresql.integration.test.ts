import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { MiDiaCommercialCardsService } from '../services/miDiaCommercialCards.service';

const target = process.env.DATABASE_URL || '';
const parsed = new URL(target || 'postgresql://invalid.invalid/blocked');
if (process.env.MIDIA_QA === '1' && (process.env.NODE_ENV !== 'test'
  || target !== process.env.DIRECT_URL || parsed.hostname !== '127.0.0.1'
  || parsed.port !== '55510' || parsed.pathname !== '/pravia_qa'
  || parsed.searchParams.get('schema') !== 'pravia_os')) {
  throw new Error('Mi Día commercial integration requires isolated local PostgreSQL.');
}
const db = new PrismaClient({ datasources: { db: { url: target } } });
type Actor = NonNullable<Request['user']>;
afterAll(async () => db.$disconnect());

describe.runIf(process.env.MIDIA_QA === '1')('Mi Día commercial cards · physical PostgreSQL', () => {
  it('counts nine persisted prospect/quote conditions with tenant, OWN, period and rollback', async () => {
    const ids = { org: randomUUID(), foreignOrg: randomUUID(), owner: randomUUID(), peer: randomUUID(),
      foreign: randomUUID(), prospectNew: randomUUID(), prospectStale: randomUUID(), prospectReady: randomUUID(),
      prospectForeign: randomUUID(), quoteToSend: randomUUID(), quoteDraft: randomUUID(), quoteNoResponse: randomUUID(),
      quoteFollowup: randomUUID(), quoteAccepted: randomUUID(), quoteConverted: randomUUID(),
      caseConverted: randomUUID(), quoteForeign: randomUUID() };
    const now = new Date('2026-10-13T12:00:00.000Z');
    const actor: Actor = { id: ids.owner, email: 'commercial-qa@example.test', nombre: 'QA', apellido: 'Local',
      rol: 'ABOGADO', scope: 'ASSIGNED_OBJECTS', organizationId: ids.org, membershipId: randomUUID(),
      sessionId: randomUUID(), permissions: ['prospectos.read', 'cotizaciones.read'], requiresPasswordChange: false };
    const director: Actor = { ...actor, rol: 'DIRECCION', scope: 'GLOBAL' };
    const rollback = new Error('MI_DIA_COMMERCIAL_ROLLBACK');
    try {
      await db.$transaction(async (tx) => {
        await tx.organization.createMany({ data: [{ id: ids.org, name: 'Mi Día commercial QA' },
          { id: ids.foreignOrg, name: 'Mi Día commercial foreign QA' }] });
        await tx.user.createMany({ data: [ids.owner, ids.peer, ids.foreign].map((id) => ({ id,
          nombre: 'Comercial', apellido: 'QA', email: `commercial-${id}@example.test`,
          password_hash: 'synthetic-only', rol: 'ABOGADO' })) });
        await tx.organizationMembership.createMany({ data: [
          { organization_id: ids.org, user_id: ids.owner, rol: 'ABOGADO' },
          { organization_id: ids.org, user_id: ids.peer, rol: 'ABOGADO' },
          { organization_id: ids.foreignOrg, user_id: ids.foreign, rol: 'ABOGADO' },
        ] });
        await tx.prospecto.createMany({ data: [
          { id: ids.prospectNew, organization_id: ids.org, user_id: ids.owner, nombre: 'Nuevo QA',
            folio: `PRO-QA-${ids.prospectNew}`, created_at: new Date('2026-10-13T10:00:00.000Z') },
          { id: ids.prospectStale, organization_id: ids.org, user_id: ids.owner, nombre: 'Sin seguimiento QA',
            folio: `PRO-QA-${ids.prospectStale}`, created_at: new Date('2026-10-01T10:00:00.000Z') },
          { id: ids.prospectReady, organization_id: ids.org, user_id: ids.peer, nombre: 'Listo QA',
            folio: `PRO-QA-${ids.prospectReady}`, created_at: new Date('2026-10-01T10:00:00.000Z') },
          { id: ids.prospectForeign, organization_id: ids.foreignOrg, user_id: ids.foreign, nombre: 'Externo QA',
            folio: `PRO-QA-${ids.prospectForeign}`, created_at: new Date('2026-10-13T10:00:00.000Z') },
        ] });
        for (const [prospectId, organizationId, userId, stage, createdAt] of [
          [ids.prospectNew, ids.org, ids.owner, 'NUEVO', '2026-10-13T10:00:00.000Z'],
          [ids.prospectStale, ids.org, ids.owner, 'EN_INTEGRACION', '2026-10-01T10:00:00.000Z'],
          [ids.prospectReady, ids.org, ids.peer, 'LISTO_PARA_COTIZAR', '2026-10-01T10:00:00.000Z'],
          [ids.prospectForeign, ids.foreignOrg, ids.foreign, 'LISTO_PARA_COTIZAR', '2026-10-13T10:00:00.000Z'],
        ] as const) {
          const effectiveAt = new Date(createdAt);
          const transition = await tx.prospectoTransicion.create({ data: {
            organization_id: organizationId, prospecto_id: prospectId, actor_id: userId,
            etapa_anterior: null, etapa_nueva: stage, effective_at: effectiveAt, recorded_at: effectiveAt,
            accion: 'CREAR', procedencia: 'CONFIRMACION_HUMANA', evidencia: {}, version: 1,
            idempotency_key: `midia-commercial-prospect-${prospectId}`, payload_hash: 'a'.repeat(64),
          } });
          await tx.prospecto.update({ where: { id: prospectId }, data: {
            etapa_contractual: stage, version_operativa: 1, transicion_actual_id: transition.id,
          } });
        }
        await tx.cotizacion.createMany({ data: [
          { id: ids.quoteToSend, organization_id: ids.org, user_id: ids.owner,
            numero_cotizacion: `COT-QA-${ids.quoteToSend}`, prospecto_id: ids.prospectNew, total_cliente: 100 },
          { id: ids.quoteDraft, organization_id: ids.org, user_id: ids.owner, version_actual: 2,
            numero_cotizacion: `COT-QA-${ids.quoteDraft}`, total_cliente: 110 },
          { id: ids.quoteNoResponse, organization_id: ids.org, user_id: ids.owner,
            numero_cotizacion: `COT-QA-${ids.quoteNoResponse}`, total_cliente: 200,
            fecha_enviada_cliente: new Date('2026-10-01T10:00:00.000Z') },
          { id: ids.quoteFollowup, organization_id: ids.org, user_id: ids.peer,
            numero_cotizacion: `COT-QA-${ids.quoteFollowup}`, total_cliente: 300 },
          { id: ids.quoteAccepted, organization_id: ids.org, user_id: ids.peer,
            numero_cotizacion: `COT-QA-${ids.quoteAccepted}`, total_cliente: 400,
            fecha_enviada_cliente: new Date('2026-10-01T10:00:00.000Z'),
            fecha_aceptacion_cliente: new Date('2026-10-13T10:00:00.000Z') },
          { id: ids.quoteConverted, organization_id: ids.org, user_id: ids.peer,
            numero_cotizacion: `COT-QA-${ids.quoteConverted}`, total_cliente: 500,
            fecha_enviada_cliente: new Date('2026-10-01T10:00:00.000Z'),
            fecha_aceptacion_cliente: new Date('2026-10-13T10:00:00.000Z') },
          { id: ids.quoteForeign, organization_id: ids.foreignOrg, user_id: ids.foreign,
            numero_cotizacion: `COT-QA-${ids.quoteForeign}`, total_cliente: 999,
            fecha_enviada_cliente: new Date('2026-10-01T10:00:00.000Z'),
            fecha_aceptacion_cliente: new Date('2026-10-13T10:00:00.000Z') },
        ] });
        for (const [quoteId, organizationId, userId, stages] of [
          [ids.quoteToSend, ids.org, ids.owner, ['BORRADOR', 'EN_ELABORACION']],
          [ids.quoteDraft, ids.org, ids.owner, ['BORRADOR', 'EN_ELABORACION']],
          [ids.quoteNoResponse, ids.org, ids.owner, ['BORRADOR', 'ENVIADA_CLIENTE']],
          [ids.quoteFollowup, ids.org, ids.peer, ['BORRADOR', 'ENVIADA_CLIENTE', 'EN_SEGUIMIENTO']],
          [ids.quoteAccepted, ids.org, ids.peer, ['BORRADOR', 'ENVIADA_CLIENTE', 'ACEPTADA']],
          [ids.quoteConverted, ids.org, ids.peer, ['BORRADOR', 'ENVIADA_CLIENTE', 'ACEPTADA', 'CONVERTIDA_EXPEDIENTE']],
          [ids.quoteForeign, ids.foreignOrg, ids.foreign, ['BORRADOR', 'ENVIADA_CLIENTE', 'ACEPTADA']],
        ] as const) {
          for (const [index, stage] of stages.entries()) {
            const previous = index ? stages[index - 1] : null;
            const action = stage === 'BORRADOR' ? 'CREAR' : stage === 'EN_ELABORACION'
              ? 'COMENZAR_ELABORACION' : stage === 'ENVIADA_CLIENTE' ? 'ENVIAR_CLIENTE'
                : stage === 'EN_SEGUIMIENTO' ? 'INICIAR_SEGUIMIENTO' : stage === 'CONVERTIDA_EXPEDIENTE' ? 'CONVERTIR' : 'ACEPTAR';
            const effectiveAt = stage === 'ACEPTADA' || stage === 'CONVERTIDA_EXPEDIENTE'
              ? now : new Date('2026-10-01T10:00:00.000Z');
            const transition = await tx.cotizacionTransicion.create({ data: {
              organization_id: organizationId, cotizacion_id: quoteId, actor_id: userId,
              etapa_anterior: previous, etapa_nueva: stage, effective_at: effectiveAt, recorded_at: effectiveAt,
              accion: action, procedencia: 'CONFIRMACION_HUMANA', evidencia: {}, version: index + 1,
              canal: action === 'ENVIAR_CLIENTE' ? 'EMAIL' : null,
              destinatario: action === 'ENVIAR_CLIENTE' ? 'qa@example.test' : null,
              idempotency_key: `midia-commercial-quote-${quoteId}-${index}`, payload_hash: 'b'.repeat(64), cambia_etapa: true,
            } });
            await tx.cotizacion.update({ where: { id: quoteId }, data: {
              etapa_contractual: stage, version_operativa: index + 1, transicion_actual_id: transition.id,
            } });
          }
        }
        await tx.expediente.create({ data: { id: ids.caseConverted, organization_id: ids.org,
          numero_pravia: `EXP-QA-${ids.caseConverted}`, abogado_id: ids.peer, creador_id: ids.peer,
          cotizacion_id: ids.quoteConverted } });
        await tx.cotizacion.update({ where: { id: ids.quoteConverted }, data: { fecha_conversion_expediente: now } });
        await tx.cotizacionVersion.create({ data: { organization_id: ids.org, cotizacion_id: ids.quoteToSend,
          version: 1, aprobada: true, total_cliente: 100, total_notaria: 50, honorarios_pravia: 50 } });
        await tx.cotizacionVersion.createMany({ data: [
          { organization_id: ids.org, cotizacion_id: ids.quoteDraft,
            version: 1, aprobada: true, total_cliente: 100, total_notaria: 50, honorarios_pravia: 50 },
          { organization_id: ids.org, cotizacion_id: ids.quoteDraft,
            version: 2, aprobada: false, total_cliente: 110, total_notaria: 55, honorarios_pravia: 55 },
        ] });
        // The normal pre-send flow has a structured editable budget; its
        // approved immutable snapshot is not created until ENVIAR_CLIENTE.
        await tx.cotizacionConcepto.create({ data: { organization_id: ids.org,
          cotizacion_id: ids.quoteToSend, concepto: 'Honorarios QA', categoria: 'HONORARIOS',
          importe: 100, orden: 0, origen: 'MANUAL' } });
        const source = new MiDiaCommercialCardsService(tx as unknown as PrismaClient);
        const options = { scope: 'OWN' as const, now, timezone: 'America/Mexico_City' };
        expect((await source.read(actor, 'PROSPECTS_ACTIVE', options)).count).toBe(2);
        expect((await source.read(director, 'PROSPECTS_ACTIVE', { ...options, scope: 'ORGANIZATION' })).count).toBe(3);
        expect((await source.read(actor, 'PROSPECTS_NEW', { ...options, period: 'TODAY' })).items.map((row) => row.id)).toEqual([ids.prospectNew]);
        expect((await source.read(actor, 'PROSPECTS_STALE', { ...options, window: 7 })).items.map((row) => row.id)).toEqual([ids.prospectStale]);
        expect((await source.read(director, 'PROSPECTS_READY', { ...options, scope: 'ORGANIZATION' })).items.map((row) => row.id)).toEqual([ids.prospectReady]);
        expect((await source.read(actor, 'QUOTES_ACTIVE', options)).count).toBe(3);
        expect((await source.read(director, 'QUOTES_ACTIVE', { ...options, scope: 'ORGANIZATION' })).count).toBe(4);
        expect((await source.read(actor, 'QUOTES_TO_SEND', options)).items.map((row) => row.id)).toEqual([ids.quoteToSend]);
        expect((await source.read(actor, 'QUOTES_NO_RESPONSE', { ...options, window: 7 })).items.map((row) => row.id)).toEqual([ids.quoteNoResponse]);
        expect((await source.read(director, 'QUOTES_FOLLOWUP', { ...options, scope: 'ORGANIZATION' })).items.map((row) => row.id)).toEqual([ids.quoteFollowup]);
        expect((await source.read(director, 'QUOTES_ACCEPTED', { ...options, scope: 'ORGANIZATION', period: 'TODAY' })).items.map((row) => row.id)).toEqual([ids.quoteAccepted]);
        expect(await source.read(actor, 'QUOTES_ACTIVE_VALUE', options)).toMatchObject({ count: 3, amount: '410.00' });
        expect(await source.read(director, 'QUOTES_ACTIVE_VALUE', { ...options, scope: 'ORGANIZATION', limit: 1 }))
          .toMatchObject({ count: 4, amount: '710.00', items: [{ id: expect.any(String) }] });
        expect(await source.read(director, 'QUOTES_ACCEPTED_VALUE', { ...options, scope: 'ORGANIZATION', period: 'TODAY' }))
          .toMatchObject({ count: 1, amount: '400.00', items: [{ id: ids.quoteAccepted }] });
        expect(await source.read(actor, 'QUOTES_ACCEPTED_VALUE', { ...options, period: 'TODAY' }))
          .toMatchObject({ count: 0, amount: null, items: [] });
        expect(await source.read(actor, 'QUOTES_CONVERSION', { ...options, period: 'MONTH' })).toMatchObject({ count: 0, denominator: 1, rate: 0 });
        expect(await source.read(director, 'QUOTES_CONVERSION', { ...options, scope: 'ORGANIZATION', period: 'MONTH' }))
          .toMatchObject({ count: 2, denominator: 3, rate: 66.7 });
        const caseConversion = await source.read(director, 'CASES_CONVERSION', { ...options, scope: 'ORGANIZATION', period: 'TODAY' });
        expect(caseConversion).toMatchObject({ count: 1, denominator: 2, rate: 50 });
        expect(caseConversion.items[0]).toMatchObject({ id: ids.caseConverted, href: `/expedientes/${ids.caseConverted}` });
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    expect(await db.prospecto.count({ where: { id: ids.prospectNew } })).toBe(0);
    expect(await db.cotizacion.count({ where: { id: ids.quoteToSend } })).toBe(0);
  });
});
