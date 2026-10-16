import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { MiDiaSigningAverageService } from './miDiaSigningAverage.service';

type Actor = NonNullable<Request['user']>;
const actor: Actor = { id: '11111111-1111-4111-8111-111111111111', email: 'qa@example.test',
  nombre: 'QA', apellido: 'Local', rol: 'DIRECCION', scope: 'GLOBAL',
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sessionId: 'local', permissions: ['expedientes.read'], requiresPasswordChange: false };

describe('Mi Día AVERAGE_TO_SIGN', () => {
  it('uses actual opening/signing dates and excludes impossible chronology', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'case-a', numero_pravia: 'EXP-0001-2026', fecha_apertura: new Date('2026-10-10T00:00:00Z'),
        fecha_real_firma: new Date('2026-10-12T00:00:00Z') },
      { id: 'case-b', numero_pravia: 'EXP-0002-2026', fecha_apertura: new Date('2026-10-09T00:00:00Z'),
        fecha_real_firma: new Date('2026-10-13T00:00:00Z') },
      { id: 'bad', numero_pravia: 'EXP-BAD', fecha_apertura: new Date('2026-10-14T00:00:00Z'),
        fecha_real_firma: new Date('2026-10-13T00:00:00Z') },
    ]);
    const source = new MiDiaSigningAverageService({ expediente: { findMany } } as unknown as PrismaClient);
    expect(await source.read(actor, { scope: 'ORGANIZATION', period: 'MONTH',
      now: new Date('2026-10-14T12:00:00Z'), limit: 1 })).toEqual({ count: 2,
      promedio_dias_naturales: 3,
      items: [{ id: 'case-a', folio: 'EXP-0001-2026', dias_naturales: 2,
        href: '/expedientes/case-a#seguimiento' }] });
    expect(findMany.mock.calls[0][0].where).toMatchObject({ AND: [
      { organization_id: actor.organizationId, archived_at: null },
      { fecha_real_firma: { gte: expect.any(Date), lt: expect.any(Date) } },
    ] });
  });

  it('does not query without the underlying object permission', async () => {
    const findMany = vi.fn();
    const source = new MiDiaSigningAverageService({ expediente: { findMany } } as unknown as PrismaClient);
    await expect(source.read({ ...actor, permissions: [] }, { scope: 'ORGANIZATION' }))
      .rejects.toThrow('MIDIA_SIGNING_AVERAGE_READ_DENIED');
    expect(findMany).not.toHaveBeenCalled();
  });
});
