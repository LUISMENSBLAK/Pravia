import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { MiDiaSignatureCardsService } from '../services/miDiaSignatureCards.service';

const target = process.env.DATABASE_URL || '';
const parsed = new URL(target || 'postgresql://invalid.invalid/blocked');
if (process.env.MIDIA_QA === '1' && (process.env.NODE_ENV !== 'test'
  || target !== process.env.DIRECT_URL || parsed.hostname !== '127.0.0.1'
  || parsed.port !== '55510' || parsed.pathname !== '/pravia_qa'
  || parsed.searchParams.get('schema') !== 'pravia_os')) {
  throw new Error('Mi Día signed periods require isolated local PostgreSQL.');
}
const db = new PrismaClient({ datasources: { db: { url: target } } });
type Actor = NonNullable<Request['user']>;
afterAll(async () => db.$disconnect());

describe.runIf(process.env.MIDIA_QA === '1')('Mi Día signed periods · physical PostgreSQL', () => {
  it('counts real signatures at local boundaries for TODAY/WEEK/MONTH/QUARTER/YEAR with tenant and object scope', async () => {
    const org = randomUUID();
    const foreignOrg = randomUUID();
    const owner = randomUUID();
    const peer = randomUUID();
    const foreign = randomUUID();
    const actor = { id: owner, organizationId: org, rol: 'ABOGADO', scope: 'ASSIGNED_OBJECTS',
      permissions: ['expedientes.read'] } as Actor;
    const director = { ...actor, rol: 'DIRECCION', scope: 'GLOBAL' } as Actor;
    const rollback = new Error('MIDIA_SIGNED_PERIOD_ROLLBACK');
    const now = new Date('2026-10-14T18:00:00.000Z');
    const signed = [
      '2026-01-01T05:59:59.999Z', '2026-01-01T06:00:00.000Z',
      '2026-10-01T05:59:59.999Z', '2026-10-01T06:00:00.000Z',
      '2026-10-12T05:59:59.999Z', '2026-10-12T06:00:00.000Z',
      '2026-10-14T05:59:59.999Z', '2026-10-14T06:00:00.000Z',
      '2026-10-15T05:59:59.999Z', '2026-10-15T06:00:00.000Z',
    ];
    try {
      await db.$transaction(async (tx) => {
        await tx.organization.createMany({ data: [
          { id: org, name: 'Signed period local QA' },
          { id: foreignOrg, name: 'Signed period foreign QA' },
        ] });
        await tx.user.createMany({ data: [owner, peer, foreign].map((id) => ({ id,
          nombre: 'Firma', apellido: 'QA', email: `signed-${id}@example.test`,
          password_hash: 'synthetic-only', rol: 'ABOGADO' })) });
        await tx.organizationMembership.createMany({ data: [
          { organization_id: org, user_id: owner, rol: 'ABOGADO' },
          { organization_id: org, user_id: peer, rol: 'ABOGADO' },
          { organization_id: foreignOrg, user_id: foreign, rol: 'ABOGADO' },
        ] });
        await tx.expediente.createMany({ data: [
          ...signed.map((date, index) => { const id = randomUUID(); return {
            id, organization_id: org, numero_pravia: `EXP-QA-${id}`, abogado_id: owner, creador_id: owner,
            estatus: 'FIRMADO' as const, fecha_real_firma: new Date(date),
          }; }),
          ...[peer, foreign].map((userId) => { const id = randomUUID(); return {
            id, organization_id: userId === peer ? org : foreignOrg, numero_pravia: `EXP-QA-${id}`,
            abogado_id: userId, creador_id: userId, estatus: 'FIRMADO' as const,
            fecha_real_firma: new Date('2026-10-14T18:00:00.000Z'),
          }; }),
        ] });
        const service = new MiDiaSignatureCardsService(tx as unknown as PrismaClient);
        const options = { scope: 'OWN' as const, now, timezone: 'America/Mexico_City', limit: 20 };
        const expectations = { TODAY: 2, WEEK: 5, MONTH: 7, QUARTER: 7, YEAR: 9 } as const;
        for (const [period, count] of Object.entries(expectations)) {
          const result = await service.read(actor, 'SIGNED_PERIOD', { ...options,
            period: period as keyof typeof expectations });
          expect(result.count).toBe(count);
          expect(result.items).toHaveLength(count);
          expect(result.items.every((item) => item.href === `/expedientes/${item.id}#seguimiento`)).toBe(true);
        }
        expect((await service.read(actor, 'SIGNED_TODAY', options)).count).toBe(2);
        expect((await service.read(director, 'SIGNED_PERIOD', { ...options, scope: 'ORGANIZATION', period: 'TODAY' })).count).toBe(3);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    expect(await db.organization.count({ where: { id: org } })).toBe(0);
  });
});
