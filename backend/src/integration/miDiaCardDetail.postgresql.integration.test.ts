import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { MiDiaCardDetailError, MiDiaCardDetailService } from '../services/miDiaCardDetail.service';

const target = process.env.DATABASE_URL || '';
const parsed = new URL(target || 'postgresql://invalid.invalid/blocked');
if (process.env.MIDIA_QA === '1' && (process.env.NODE_ENV !== 'test'
  || target !== process.env.DIRECT_URL || parsed.hostname !== '127.0.0.1'
  || parsed.port !== '55510' || parsed.pathname !== '/pravia_qa'
  || parsed.searchParams.get('schema') !== 'pravia_os')) {
  throw new Error('Mi Día detail integration requires isolated local PostgreSQL.');
}

const db = new PrismaClient({ datasources: { db: { url: target } } });
type Actor = NonNullable<Request['user']>;
afterAll(async () => db.$disconnect());

describe.runIf(process.env.MIDIA_QA === '1')('Mi Día MD124 · physical PostgreSQL', () => {
  it('reconciles every page and amount while clamping OWN and isolating tenants', async () => {
    const ids = { org: randomUUID(), otherOrg: randomUUID(), owner: randomUUID(), peer: randomUUID(), foreign: randomUUID(),
      own1: randomUUID(), own2: randomUUID(), own3: randomUUID(), peerMovement: randomUUID(), foreignMovement: randomUUID() };
    const membership = randomUUID();
    const actor: Actor = { id: ids.owner, email: 'md124-owner@example.test', nombre: 'MD124', apellido: 'Owner',
      rol: 'DIRECCION', scope: 'GLOBAL', organizationId: ids.org, membershipId: membership, sessionId: randomUUID(),
      permissions: ['mi_dia.read', 'finanzas.read'], requiresPasswordChange: false };
    const foreignActor: Actor = { ...actor, id: ids.foreign, organizationId: ids.otherOrg,
      membershipId: randomUUID(), email: 'md124-foreign@example.test' };
    const now = new Date('2026-10-14T12:00:00.000Z');
    const rollback = new Error('MI_DIA_MD124_ROLLBACK');
    try {
      await db.$transaction(async (tx) => {
        await tx.organization.createMany({ data: [{ id: ids.org, name: 'MD124 QA' }, { id: ids.otherOrg, name: 'MD124 other QA' }] });
        await tx.user.createMany({ data: [ids.owner, ids.peer, ids.foreign].map((id) => ({ id, nombre: 'MD124', apellido: 'QA',
          email: `md124-${id}@example.test`, password_hash: 'synthetic-only', rol: 'DIRECCION' })) });
        await tx.organizationMembership.createMany({ data: [
          { id: membership, organization_id: ids.org, user_id: ids.owner, rol: 'DIRECCION' },
          { organization_id: ids.org, user_id: ids.peer, rol: 'ABOGADO' },
          { id: foreignActor.membershipId, organization_id: ids.otherOrg, user_id: ids.foreign, rol: 'DIRECCION' },
        ] });
        for (const organizationId of [ids.org, ids.otherOrg]) await tx.miDiaTenantConfig.create({ data: {
          organization_id: organizationId, enabled_cards: ['INCOME_COLLECTED'], recommended_cards: [],
          default_layout: [{ key: 'INCOME_COLLECTED', size: 'S', scope: 'OWN', parameters: { period: 'MONTH' } }],
        } });
        const movement = (id: string, organizationId: string, userId: string, amount: number) => ({
          id, organization_id: organizationId, capturado_por_id: userId, responsable_id: userId,
          naturaleza: 'INGRESO' as const, tipo_movimiento: 'ABONO' as const, categoria: 'QA',
          concepto: `Ingreso ${amount}`, monto: new Prisma.Decimal(amount), estatus: 'APLICADO' as const,
          fecha_movimiento: now,
        });
        await tx.movimientoFinanciero.createMany({ data: [
          movement(ids.own1, ids.org, ids.owner, 100.11), movement(ids.own2, ids.org, ids.owner, 200.22),
          movement(ids.own3, ids.org, ids.owner, 300.33), movement(ids.peerMovement, ids.org, ids.peer, 900.99),
          movement(ids.foreignMovement, ids.otherOrg, ids.foreign, 7000.77),
        ] });
        const service = new MiDiaCardDetailService(tx as unknown as PrismaClient);
        const first = await service.read(actor, 'INCOME_COLLECTED', { page: 1, pageSize: 2,
          requestedUserId: ids.peer, now });
        const second = await service.read(actor, 'INCOME_COLLECTED', { page: 2, pageSize: 2,
          requestedUserId: ids.peer, now });
        expect(first).toMatchObject({ totalCount: 3, totalAmount: '600.66', page: 1, pageSize: 2, totalPages: 2, scope: 'OWN' });
        expect(first.items).toHaveLength(2);
        expect(second.items).toHaveLength(1);
        const idsAcrossPages = [...first.items, ...second.items].map((item: any) => item.id);
        expect(new Set(idsAcrossPages)).toEqual(new Set([ids.own1, ids.own2, ids.own3]));
        const cents = [...first.items, ...second.items].reduce((sum, item: any) => sum + BigInt(item.amount.replace('.', '')), 0n);
        expect(cents).toBe(60066n);
        expect(idsAcrossPages).not.toContain(ids.peerMovement);
        expect(idsAcrossPages).not.toContain(ids.foreignMovement);

        const foreign = await service.read(foreignActor, 'INCOME_COLLECTED', { page: 1, pageSize: 20, now });
        expect(foreign).toMatchObject({ totalCount: 1, totalAmount: '7000.77', scope: 'OWN' });
        expect((foreign.items[0] as any).id).toBe(ids.foreignMovement);

        await expect(service.read({ ...actor, permissions: ['mi_dia.read'] }, 'INCOME_COLLECTED', { now }))
          .rejects.toMatchObject<Partial<MiDiaCardDetailError>>({ status: 404, code: 'MIDIA_DETAIL_NOT_AVAILABLE' });
        throw rollback;
      }, { timeout: 30_000 });
    } catch (error) { if (error !== rollback) throw error; }
    expect(await db.movimientoFinanciero.count({ where: { id: ids.own1 } })).toBe(0);
  }, 40_000);
});
