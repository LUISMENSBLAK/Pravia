import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { MiDiaUserLoadService } from './miDiaUserLoad.service';

type Actor = NonNullable<Request['user']>;
const actor: Actor = { id: '11111111-1111-4111-8111-111111111111', email: 'qa@example.test',
  nombre: 'QA', apellido: 'Local', rol: 'DIRECCION', scope: 'GLOBAL',
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sessionId: 'local', permissions: ['reportes.read', 'expedientes.read'], requiresPasswordChange: false };

describe('Mi Día USER_LOAD', () => {
  it('shows separate real case/process counts and keeps the organization boundary', async () => {
    const members = vi.fn().mockResolvedValueOnce([{ user_id: 'user-a', user: { nombre: 'Ana', apellido: 'Ruiz' } },
      { user_id: 'user-b', user: { nombre: 'Luis', apellido: 'Paz' } }])
      .mockResolvedValueOnce([{ user_id: 'user-b', user: { nombre: 'Luis', apellido: 'Paz' } }]);
    const cases = vi.fn().mockResolvedValue([{ id: 'case-a', abogado_id: 'user-a' },
      { id: 'case-b', abogado_id: 'user-a' }, { id: 'case-c', abogado_id: 'user-b' }]);
    const processes = vi.fn().mockResolvedValue([{ responsable_id: 'user-a', _count: { id: 3 } }]);
    const source = new MiDiaUserLoadService({ organizationMembership: { findMany: members },
      expediente: { findMany: cases }, expedienteSeguimientoActividad: { groupBy: processes } } as unknown as PrismaClient);
    expect(await source.read(actor, { limit: 1 })).toEqual({ count: 2,
      items: [{ id: 'user-a', nombre: 'Ana Ruiz', expedientes: 2, procesos: 3,
        href: '/reportes?view=abogados&abogado_id=user-a' }] });
    expect(members.mock.calls[0][0].where).toMatchObject({ organization_id: actor.organizationId,
      status: 'ACTIVE', user: { activo: true } });
    expect(cases.mock.calls[0][0].where).toMatchObject({ organization_id: actor.organizationId,
      archived_at: null });
    expect(processes.mock.calls[0][0].where).toMatchObject({ organization_id: actor.organizationId,
      en_alcance: true, expediente_id: { in: ['case-a', 'case-b', 'case-c'] } });
    expect((await source.read(actor, { requestedUserId: 'user-b' })).items).toEqual([
      { id: 'user-b', nombre: 'Luis Paz', expedientes: 1, procesos: 0,
        href: '/reportes?view=abogados&abogado_id=user-b' },
    ]);
    expect(members.mock.calls[1][0].where.user_id).toBe('user-b');
  });

  it('denies non-global and missing source permissions before any query', async () => {
    const members = vi.fn();
    const source = new MiDiaUserLoadService({ organizationMembership: { findMany: members } } as unknown as PrismaClient);
    await expect(source.read({ ...actor, scope: 'ASSIGNED_OBJECTS' }, {})).rejects.toThrow('MIDIA_USER_LOAD_READ_DENIED');
    await expect(source.read({ ...actor, permissions: ['reportes.read'] }, {})).rejects.toThrow('MIDIA_USER_LOAD_READ_DENIED');
    expect(members).not.toHaveBeenCalled();
  });
});
