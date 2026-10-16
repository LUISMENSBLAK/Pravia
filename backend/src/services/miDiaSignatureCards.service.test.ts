import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { ComplianceH6Service } from './complianceH6.service';
import { MiDiaSignatureCardsService } from './miDiaSignatureCards.service';

type Actor = NonNullable<Request['user']>;
const actor: Actor = { id: '11111111-1111-4111-8111-111111111111', email: 'qa@example.test',
  nombre: 'QA', apellido: 'Local', rol: 'DIRECCION', scope: 'GLOBAL',
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sessionId: 'local', permissions: ['expedientes.read'], requiresPasswordChange: false };
afterEach(() => vi.restoreAllMocks());

describe('Mi Día signature cards: H6 canonical preflight', () => {
  const candidates = [
    { id: 'case-ready', numero_pravia: 'EXP-0001-2026', cliente_alias: 'Cliente A', estatus: 'FIRMA_PROGRAMADA', version: 2, fecha_estimada_firma: new Date('2026-10-15T12:00:00.000Z') },
    { id: 'case-pending', numero_pravia: 'EXP-0002-2026', cliente_alias: 'Cliente B', estatus: 'FIRMA_PROGRAMADA', version: 3, fecha_estimada_firma: new Date('2026-10-16T12:00:00.000Z') },
  ];
  it('separates ready from not-ready without treating an H6 error as zero', async () => {
    const findMany = vi.fn().mockResolvedValue(candidates);
    const preflight = vi.spyOn(ComplianceH6Service, 'firPreflightTx').mockImplementation(async (_db, org, id) => {
      expect(org).toBe(actor.organizationId);
      return { ready: id === 'case-ready', missing: [], count: id === 'case-ready' ? 0 : 1,
        hash: 'qa', ready_label: 'QA' };
    });
    const service = new MiDiaSignatureCardsService({ expediente: { findMany } } as unknown as PrismaClient);
    const ready = await service.read(actor, 'READY_TO_SIGN', { scope: 'OWN', now: new Date('2026-10-13T12:00:00.000Z') });
    const pending = await service.read(actor, 'NOT_READY_TO_SIGN', { scope: 'OWN', window: 7, now: new Date('2026-10-13T12:00:00.000Z') });
    expect(ready.items.map((item) => item.id)).toEqual(['case-ready']);
    expect(pending.items.map((item) => item.id)).toEqual(['case-pending']);
    expect(preflight).toHaveBeenCalledTimes(4);
    expect(findMany.mock.calls[0][0].where.AND[0]).toMatchObject({ organization_id: actor.organizationId });
    expect(findMany.mock.calls[1][0].where.AND[1]).toMatchObject({
      estatus: 'FIRMA_PROGRAMADA', fecha_real_firma: null,
      fecha_estimada_firma: { gte: new Date('2026-10-13T12:00:00.000Z'), lte: new Date('2026-10-20T12:00:00.000Z') },
    });
    preflight.mockRejectedValueOnce(new Error('H6 unavailable'));
    await expect(service.read(actor, 'READY_TO_SIGN', { scope: 'OWN' })).rejects.toThrow('H6 unavailable');
  });
  it('counts signed cases from persisted signing date and requested period, not status alone', async () => {
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([{ id: 'signed-case', numero_pravia: 'EXP-0003-2026',
      cliente_alias: 'Cliente C', estatus: 'FIRMADO', fecha_real_firma: new Date('2026-10-13T10:00:00.000Z') }]);
    const preflight = vi.spyOn(ComplianceH6Service, 'firPreflightTx');
    const service = new MiDiaSignatureCardsService({ expediente: { count, findMany } } as unknown as PrismaClient);
    const now = new Date('2026-10-13T12:00:00.000Z');
    const today = await service.read(actor, 'SIGNED_TODAY', { scope: 'OWN', now });
    const month = await service.read(actor, 'SIGNED_PERIOD', { scope: 'OWN', period: 'MONTH', now });
    const performance = await service.read(actor, 'SIGNED_CASES', { scope: 'OWN', period: 'MONTH', now });
    expect(today.count).toBe(1);
    expect(today.items[0].href).toBe('/expedientes/signed-case#seguimiento');
    expect(count.mock.calls[0][0].where.AND[1].fecha_real_firma).toEqual({
      gte: new Date('2026-10-13T06:00:00.000Z'), lt: new Date('2026-10-14T06:00:00.000Z'),
    });
    expect(month.count).toBe(1);
    expect(count.mock.calls[1][0].where.AND[1].fecha_real_firma.gte).toEqual(new Date('2026-10-01T06:00:00.000Z'));
    expect(performance).toEqual(month);
    expect(count.mock.calls[2][0].where).toEqual(count.mock.calls[1][0].where);
    expect(preflight).not.toHaveBeenCalled();
  });
});
