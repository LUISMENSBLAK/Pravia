import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { MiDiaProcessCardsService } from './miDiaProcessCards.service';

type Actor = NonNullable<Request['user']>;
const actor = (permissions = ['expedientes.read']): Actor => ({
  id: '11111111-1111-4111-8111-111111111111', email: 'qa@pravia.test', nombre: 'QA', apellido: 'Local',
  rol: 'DIRECCION', scope: 'GLOBAL', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sessionId: 'local',
  permissions: permissions as Actor['permissions'], requiresPasswordChange: false,
});
const process = (id: string, start: string, duration: number, state = 'EN_PROCESO') => ({
  id, expediente_id: 'case-1', actividad_nombre_snapshot: `Proceso ${id}`, estado: state,
  responsable_id: actor().id, primera_fecha_inicio: new Date(start), duracion_estimada: duration,
  excepcion_operativa: null, fecha_objetivo_proyectada: null,
});

describe('Mi Día process cards: canonical EXP-005 source', () => {
  const now = new Date('2026-10-13T12:00:00.000Z');
  const cases = [{ id: 'case-1', numero_pravia: 'EXP-0001-2026' }];
  const activities = [
    process('overdue', '2026-10-08T00:00:00.000Z', 1),
    process('today', '2026-10-12T00:00:00.000Z', 1),
    process('upcoming', '2026-10-13T00:00:00.000Z', 2),
    process('blocked', '2026-10-08T00:00:00.000Z', 1, 'BLOQUEADO'),
  ];
  const makeService = () => {
    const caseFind = vi.fn().mockResolvedValue(cases);
    const activityFind = vi.fn().mockImplementation(async (args: any) => args.where.id ? [{ id: 'dependency', estado: 'NO_INICIADO' }] : activities);
    const dependencyFind = vi.fn().mockResolvedValue([{ actividad_id: 'blocked', depende_actividad_id: 'dependency' }]);
    const prisma = { expediente: { findMany: caseFind }, expedienteSeguimientoActividad: { findMany: activityFind },
      expedienteSeguimientoDependencia: { findMany: dependencyFind } } as unknown as PrismaClient;
    return { service: new MiDiaProcessCardsService(prisma), caseFind, activityFind, dependencyFind };
  };

  it('uses exact full-set counts and canonical business-day due dates without counting blocked as overdue', async () => {
    const { service } = makeService();
    const pending = await service.read(actor(), 'MY_PENDING', { scope: 'OWN', now, limit: 2 });
    const overdue = await service.read(actor(), 'OVERDUE_PROCESSES', { scope: 'OWN', now });
    const today = await service.read(actor(), 'DUE_TODAY', { scope: 'OWN', now });
    const upcoming = await service.read(actor(), 'UPCOMING_DUE', { scope: 'OWN', now, window: 7 });
    expect(pending.count).toBe(4);
    expect(pending.items).toHaveLength(2);
    expect(overdue.items.map((item) => item.id)).toEqual(['overdue']);
    expect(today.items.map((item) => item.id)).toEqual(['today']);
    expect(upcoming.items.map((item) => item.id)).toEqual(['upcoming']);
    expect(today.items[0].href).toBe('/expedientes/case-1?process_id=today#seguimiento');
  });

  it('offers only unblocked, active EXP-005 transitions when both write and AI-work permissions exist', async () => {
    const { service } = makeService();
    const editor = actor(['expedientes.read', 'expedientes.write', 'ai.work.read']);
    const result = await service.read(editor, 'CAN_ADVANCE_TODAY', { scope: 'OWN', now, limit: 2 });
    expect(result.count).toBe(3);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.id)).not.toContain('blocked');
    await expect(service.read(actor(['expedientes.read', 'ai.work.read']), 'CAN_ADVANCE_TODAY',
      { scope: 'OWN', now })).rejects.toThrow('MIDIA_PROCESS_ACTION_READ_DENIED');
  });

  it('enforces organization, object boundary, process owner and does not use a forged user filter for OWN', async () => {
    const { service, caseFind, activityFind, dependencyFind } = makeService();
    await service.read(actor(), 'MY_PENDING', { scope: 'OWN', requestedUserId: 'forged', now });
    expect(caseFind).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organization_id: actor().organizationId }) }));
    expect(activityFind.mock.calls[0][0].where).toMatchObject({ organization_id: actor().organizationId, responsable_id: actor().id });
    expect(dependencyFind.mock.calls[0][0].where.organization_id).toBe(actor().organizationId);
    await service.read(actor([]), 'MY_PENDING', { scope: 'ORGANIZATION', now });
    expect(caseFind).toHaveBeenCalledTimes(1);
  });

  it('uses canonical master-concept codes for Catastro, RPP and testimony without text matching', async () => {
    const { service, caseFind, activityFind } = makeService();
    for (const [key, codes] of [
      ['CATASTRO_PENDING', ['SOLVENCIA_INGRESO', 'SOLVENCIA_OBTENCION']],
      ['RPP_PENDING', ['RPP_INGRESO', 'RPP_OBTENCION']],
      ['TESTIMONIES_PENDING', ['ARMADO_TESTIMONIO']],
    ] as const) {
      const previousCalls = activityFind.mock.calls.length;
      await service.read(actor(), key, { scope: 'ORGANIZATION', now });
      expect(activityFind.mock.calls[previousCalls][0].where).toMatchObject({
        organization_id: actor().organizationId, en_alcance: true, fecha_completada_actual: null,
        concepto_maestro: { is: { organization_id: actor().organizationId, codigo: { in: [...codes] } } },
      });
    }
    expect(caseFind.mock.lastCall?.[0].where).toMatchObject({ AND: [
      expect.objectContaining({ organization_id: actor().organizationId }),
      { estatus: { notIn: ['ENTREGADO', 'CANCELADO'] }, fecha_entrega_cliente: null },
    ] });
  });
});
