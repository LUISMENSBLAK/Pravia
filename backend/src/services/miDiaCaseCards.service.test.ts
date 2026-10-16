import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { MiDiaCaseCardsService } from './miDiaCaseCards.service';

type Actor = NonNullable<Request['user']>;
const actor: Actor = { id: '11111111-1111-4111-8111-111111111111', email: 'qa@example.test',
  nombre: 'QA', apellido: 'Local', rol: 'DIRECCION', scope: 'GLOBAL',
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sessionId: 'local', permissions: ['expedientes.read'], requiresPasswordChange: false };

describe('Mi Día case-card adapters', () => {
  it('uses activity timeline and exact count for inactive cases, preserving no-data as null', async () => {
    const count = vi.fn().mockResolvedValue(12);
    const findMany = vi.fn().mockResolvedValue([{ id: 'case-1', numero_pravia: 'EXP-0001-2026',
      cliente_alias: 'Cliente QA', estatus: 'EN_PROCESO', actividades: [], tareas_externas: [] }]);
    const source = new MiDiaCaseCardsService({ expediente: { count, findMany } } as unknown as PrismaClient);
    const result = await source.read(actor, 'CASES_INACTIVE', { scope: 'OWN', window: 7,
      now: new Date('2026-10-13T12:00:00.000Z'), limit: 5 });
    expect(result.count).toBe(12);
    expect(result.items[0]).toMatchObject({ folio: 'EXP-0001-2026', contexto: null,
      href: '/expedientes/case-1#actividad' });
    expect(count.mock.calls[0][0].where.AND[0]).toMatchObject({ organization_id: actor.organizationId,
      OR: expect.arrayContaining([{ abogado_id: actor.id }]) });
    expect(count.mock.calls[0][0].where.AND[1]).toMatchObject({
      actividades: { none: { organization_id: actor.organizationId,
        created_at: { gte: new Date('2026-10-06T12:00:00.000Z') } } },
    });
    expect(findMany.mock.calls[0][0].take).toBe(5);
  });

  it('preserves canonical blocked condition without overwriting OWN object scope', async () => {
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([{ id: 'case-2', numero_pravia: 'EXP-0002-2026',
      cliente_alias: null, estatus: 'SUSPENDIDO', actividades: [], tareas_externas: [{ descripcion: 'Pendiente externo' }] }]);
    const source = new MiDiaCaseCardsService({ expediente: { count, findMany } } as unknown as PrismaClient);
    const result = await source.read(actor, 'CASES_BLOCKED', { scope: 'OWN' });
    expect(result.items[0].contexto).toBe('Pendiente externo');
    const where = count.mock.calls[0][0].where;
    expect(where.AND[0].organization_id).toBe(actor.organizationId);
    expect(where.AND[1].OR).toEqual([{ estatus: 'SUSPENDIDO' }, { tareas_externas: { some: { estatus: 'BLOQUEADA' } } }]);
  });

  it('separates signed post-sign work from cases already ready for delivery', async () => {
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([{ id: 'case-3', numero_pravia: 'EXP-0003-2026',
      cliente_alias: null, estatus: 'POST_FIRMA', actividades: [], tareas_externas: [] }]);
    const pendingProcessFind = vi.fn().mockResolvedValue([{ expediente_id: 'case-3' }]);
    const source = new MiDiaCaseCardsService({ expediente: { count, findMany },
      expedienteSeguimientoActividad: { findMany: pendingProcessFind } } as unknown as PrismaClient);
    expect((await source.read(actor, 'POSTSIGN_PENDING', { scope: 'OWN' })).items[0].href)
      .toBe('/expedientes/case-3#seguimiento');
    expect(pendingProcessFind.mock.calls[0][0]).toMatchObject({ where: {
      organization_id: actor.organizationId, en_alcance: true, fecha_completada_actual: null,
      etapa_nombre_snapshot: { equals: 'Postfirma', mode: 'insensitive' },
    }, distinct: ['expediente_id'] });
    expect(count.mock.calls[0][0].where.AND[1]).toEqual({
      id: { in: ['case-3'] }, estatus: { in: ['FIRMADO', 'POST_FIRMA'] }, fecha_real_firma: { not: null },
    });
    await source.read(actor, 'DELIVERIES_PENDING', { scope: 'ORGANIZATION' });
    expect(count.mock.calls[1][0].where.AND[1]).toEqual({ estatus: 'LISTO_ENTREGA', fecha_entrega_cliente: null });
  });

  it('counts only active cases whose actual lawyer is the effective user, not all visible cases', async () => {
    const count = vi.fn().mockResolvedValue(9);
    const findMany = vi.fn().mockResolvedValue([{ id: 'case-owned', numero_pravia: 'EXP-0004-2026',
      cliente_alias: 'Cliente', estatus: 'POST_FIRMA', actividades: [], tareas_externas: [] }]);
    const source = new MiDiaCaseCardsService({ expediente: { count, findMany } } as unknown as PrismaClient);
    const result = await source.read(actor, 'MY_ACTIVE_CASES', {
      scope: 'OWN', requestedUserId: 'other-user', limit: 5,
    });
    expect(result).toMatchObject({ count: 9, items: [{ href: '/expedientes/case-owned' }] });
    expect(findMany.mock.calls[0][0].take).toBe(5);
    expect(count.mock.calls[0][0].where.AND[0]).toMatchObject({ organization_id: actor.organizationId });
    expect(count.mock.calls[0][0].where.AND[1]).toMatchObject({ abogado_id: actor.id,
      estatus: { in: expect.arrayContaining(['ABIERTO', 'FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA']) } });
    expect(count.mock.calls[0][0].where.AND[1].estatus.in).not.toContain('ENTREGADO');
    expect(count.mock.calls[0][0].where.AND[1].estatus.in).not.toContain('SUSPENDIDO');
    expect(count.mock.calls[0][0].where.AND[1].estatus.in).not.toContain('CANCELADO');
  });
});
