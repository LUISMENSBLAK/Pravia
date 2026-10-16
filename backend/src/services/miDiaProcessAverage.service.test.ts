import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { MiDiaProcessAverageService } from './miDiaProcessAverage.service';

type Actor = NonNullable<Request['user']>;
const actor: Actor = { id: '11111111-1111-4111-8111-111111111111', email: 'qa@example.test',
  nombre: 'QA', apellido: 'Local', rol: 'DIRECCION', scope: 'GLOBAL',
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sessionId: 'local', permissions: ['expedientes.read'], requiresPasswordChange: false };

describe('Mi Día AVERAGE_PROCESS', () => {
  it('averages only dated completed facts and never mixes business and calendar days', async () => {
    const rows = [
      { id: 'a', expediente_id: 'case-a', proceso_clave: 'RPP', actividad_nombre_snapshot: 'Registro',
        tipo_dias: 'HABILES', excepcion_operativa: null,
        primera_fecha_inicio: new Date('2026-10-09T00:00:00Z'), fecha_completada_actual: new Date('2026-10-12T00:00:00Z') },
      { id: 'b', expediente_id: 'case-b', proceso_clave: 'RPP', actividad_nombre_snapshot: 'Registro',
        tipo_dias: 'HABILES', excepcion_operativa: null,
        primera_fecha_inicio: new Date('2026-10-08T00:00:00Z'), fecha_completada_actual: new Date('2026-10-12T00:00:00Z') },
      { id: 'c', expediente_id: 'case-c', proceso_clave: 'RPP', actividad_nombre_snapshot: 'Registro',
        tipo_dias: 'HABILES', excepcion_operativa: { tipo_dias: 'NATURALES' },
        primera_fecha_inicio: new Date('2026-10-09T00:00:00Z'), fecha_completada_actual: new Date('2026-10-12T00:00:00Z') },
      { id: 'invalid', expediente_id: 'case-d', proceso_clave: 'RPP', actividad_nombre_snapshot: 'Registro',
        tipo_dias: 'HABILES', excepcion_operativa: null,
        primera_fecha_inicio: new Date('2026-10-13T00:00:00Z'), fecha_completada_actual: new Date('2026-10-12T00:00:00Z') },
    ];
    const findMany = vi.fn().mockResolvedValue(rows);
    const caseFind = vi.fn().mockResolvedValue([{ id: 'case-a' }, { id: 'case-b' }, { id: 'case-c' }, { id: 'case-d' }]);
    const source = new MiDiaProcessAverageService({ expediente: { findMany: caseFind },
      expedienteSeguimientoActividad: { findMany } } as unknown as PrismaClient);
    const result = await source.read(actor, { scope: 'ORGANIZATION', period: 'MONTH',
      now: new Date('2026-10-14T12:00:00Z'), limit: 10 });
    expect(result).toEqual({ count: 3, items: [
      { key: 'RPP:HABILES', nombre: 'Registro', unidad: 'HABILES', promedio_dias: 1.5,
        procesos: 2, href: '/expedientes/case-a?process_id=a#seguimiento' },
      { key: 'RPP:NATURALES', nombre: 'Registro', unidad: 'NATURALES', promedio_dias: 3,
        procesos: 1, href: '/expedientes/case-c?process_id=c#seguimiento' },
    ] });
    expect(caseFind.mock.calls[0][0].where).toMatchObject({ organization_id: actor.organizationId, archived_at: null });
    expect(findMany.mock.calls[0][0].where).toMatchObject({ organization_id: actor.organizationId,
      expediente_id: { in: ['case-a', 'case-b', 'case-c', 'case-d'] },
      estado: 'COMPLETADO', en_alcance: true, primera_fecha_inicio: { not: null } });
  });

  it('restricts OWN to the process responsible and rejects a missing permission', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const source = new MiDiaProcessAverageService({ expediente: { findMany: vi.fn().mockResolvedValue([{ id: 'case-a' }]) },
      expedienteSeguimientoActividad: { findMany } } as unknown as PrismaClient);
    expect((await source.read(actor, { scope: 'OWN' })).count).toBe(0);
    expect(findMany.mock.calls[0][0].where.responsable_id).toBe(actor.id);
    await expect(source.read({ ...actor, permissions: [] }, { scope: 'ORGANIZATION' }))
      .rejects.toThrow('MIDIA_PROCESS_AVERAGE_READ_DENIED');
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
