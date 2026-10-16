import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { MiDiaComplianceCardsService } from './miDiaComplianceCards.service';

type Actor = NonNullable<Request['user']>;
const actor: Actor = { id: '11111111-1111-4111-8111-111111111111', email: 'qa@example.test',
  nombre: 'QA', apellido: 'Local', rol: 'DIRECCION', scope: 'GLOBAL',
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sessionId: 'local', permissions: ['compliance.read', 'expedientes.read', 'ai.work.read'], requiresPasswordChange: false };

describe('Mi Día compliance cards: persisted H8 state', () => {
  it('counts the same incomplete states as Cumplimiento H8 without re-running legal rules', async () => {
    const count = vi.fn().mockResolvedValue(11);
    const findMany = vi.fn().mockResolvedValue([{ id: 'state-1', state: 'EN_PROCESO',
      expediente: { id: 'case-1', numero_pravia: 'EXP-0001-2026' } }]);
    const source = new MiDiaComplianceCardsService({ expedienteComplianceState: { count, findMany } } as unknown as PrismaClient);
    const result = await source.read(actor, 'PLD_INCOMPLETE', { scope: 'OWN', limit: 5 });
    expect(result).toEqual({ count: 11, items: [{ id: 'state-1', folio: 'EXP-0001-2026',
      nombre: 'Expediente PLD', estado: 'EN_PROCESO', href: '/expedientes/case-1#cumplimiento' }] });
    expect(count.mock.calls[0][0].where).toMatchObject({ organization_id: actor.organizationId,
      expediente: { is: { organization_id: actor.organizationId, OR: expect.any(Array) } },
      state: { in: ['PENDIENTE', 'EN_PROCESO', 'LISTO', 'VENCIDO'] },
    });
    expect(findMany.mock.calls[0][0].take).toBe(5);
  });

  it('does not read compliance state without both source and object permissions', async () => {
    const count = vi.fn();
    const source = new MiDiaComplianceCardsService({ expedienteComplianceState: { count } } as unknown as PrismaClient);
    await expect(source.read({ ...actor, permissions: ['compliance.read'] }, 'PLD_INCOMPLETE', { scope: 'ORGANIZATION' }))
      .rejects.toThrow('MIDIA_COMPLIANCE_READ_DENIED');
    await expect(source.read({ ...actor, permissions: ['expedientes.read'] }, 'PLD_INCOMPLETE', { scope: 'ORGANIZATION' }))
      .rejects.toThrow('MIDIA_COMPLIANCE_READ_DENIED');
    expect(count).not.toHaveBeenCalled();
  });

  it('reads only current persisted AVI obligations in the permitted case and current review', async () => {
    const states = vi.fn().mockResolvedValue([{ expediente_id: 'case-1', current_review_id: 'review-1',
      expediente: { numero_pravia: 'EXP-0001-2026' } }]);
    const count = vi.fn().mockResolvedValue(12);
    const findMany = vi.fn().mockResolvedValue([{ id: 'notice-1', expediente_id: 'case-1',
      avi_state: 'LISTO_PARA_PRESENTAR', due_at: new Date('2026-10-15T12:00:00.000Z') }]);
    const source = new MiDiaComplianceCardsService({ expedienteComplianceState: { findMany: states },
      complianceObligation: { count, findMany } } as unknown as PrismaClient);
    const result = await source.read(actor, 'NOTICES_UPCOMING', { scope: 'OWN', limit: 5,
      window: 3, timezone: 'America/Mexico_City', now: new Date('2026-10-13T23:00:00.000Z') });
    expect(result.count).toBe(12);
    expect(result.items).toMatchObject([{ id: 'notice-1', folio: 'EXP-0001-2026',
      href: '/expedientes/case-1#cumplimiento' }]);
    expect(count.mock.calls[0][0].where).toMatchObject({ organization_id: actor.organizationId,
      freshness: 'CURRENT', OR: [{ review_id: 'review-1', expediente_id: 'case-1' }],
      avi_state: { in: ['PENDIENTE', 'INFORMACION_INCOMPLETA', 'VALIDADO',
        'LISTO_PARA_PRESENTAR', 'PRESENTADO', 'ACUSE_CARGADO'] },
      due_at: { gte: new Date('2026-10-14T06:00:00.000Z'), lt: new Date('2026-10-17T06:00:00.000Z') },
    });
    expect(findMany.mock.calls[0][0].take).toBe(5);
    await source.read(actor, 'NOTICES_OVERDUE', { scope: 'OWN', now: new Date('2026-10-13T23:00:00.000Z'),
      timezone: 'America/Mexico_City' });
    expect(count.mock.calls[1][0].where.due_at).toEqual({ lt: new Date('2026-10-13T06:00:00.000Z') });
    await source.read(actor, 'NOTICES_PENDING', { scope: 'OWN' });
    expect(count.mock.calls[2][0].where.due_at).toBeUndefined();
  });

  it('returns zero without querying obligations when no accessible current review exists', async () => {
    const count = vi.fn();
    const source = new MiDiaComplianceCardsService({ expedienteComplianceState: { findMany: vi.fn().mockResolvedValue([]) },
      complianceObligation: { count } } as unknown as PrismaClient);
    await expect(source.read(actor, 'NOTICES_PENDING', { scope: 'OWN' })).resolves.toEqual({ count: 0, items: [] });
    expect(count).not.toHaveBeenCalled();
  });

  it('shows only open critical alerts from the current review of accessible cases', async () => {
    const states = vi.fn().mockResolvedValue([{ expediente_id: 'case-1', current_review_id: 'review-1',
      expediente: { numero_pravia: 'EXP-0001-2026' } }]);
    const count = vi.fn().mockResolvedValue(2);
    const findMany = vi.fn().mockResolvedValue([{ id: 'alert-1', expediente_id: 'case-1',
      message: 'Obligación vencida' }]);
    const source = new MiDiaComplianceCardsService({ expedienteComplianceState: { findMany: states },
      complianceAlert: { count, findMany } } as unknown as PrismaClient);
    const result = await source.read(actor, 'CRITICAL_ALERTS', { scope: 'OWN', limit: 5 });
    expect(result).toEqual({ count: 2, items: [{ id: 'alert-1', folio: 'EXP-0001-2026',
      nombre: 'Obligación vencida', estado: 'CRITICA', href: '/expedientes/case-1#cumplimiento' }] });
    expect(count.mock.calls[0][0].where).toMatchObject({ organization_id: actor.organizationId,
      status: 'ABIERTA', level: 'CRITICA', OR: [{ expediente_id: 'case-1', review_id: 'review-1' }] });
    expect(findMany.mock.calls[0][0].take).toBe(5);
    await expect(source.read({ ...actor, permissions: ['compliance.read', 'expedientes.read'] },
      'CRITICAL_ALERTS', { scope: 'OWN' })).rejects.toThrow('MIDIA_CRITICAL_ALERTS_READ_DENIED');
  });
});
