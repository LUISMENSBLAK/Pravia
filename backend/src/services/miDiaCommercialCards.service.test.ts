import { describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { MiDiaCommercialCardsService, type CommercialCardKey } from './miDiaCommercialCards.service';

type Actor = NonNullable<Request['user']>;
const actor: Actor = { id: '11111111-1111-4111-8111-111111111111', email: 'qa@example.test',
  nombre: 'QA', apellido: 'Local', rol: 'DIRECCION', scope: 'GLOBAL',
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sessionId: 'local', permissions: ['prospectos.read', 'cotizaciones.read'], requiresPasswordChange: false };

describe('Mi Día commercial cards: canonical persisted stages', () => {
  const now = new Date('2026-10-14T03:30:00.000Z');
  const pCount = vi.fn().mockResolvedValue(23);
  const pFind = vi.fn().mockResolvedValue([{ id: 'prospect-1', folio: 'PRO-0001-2026', nombre: 'Cliente QA',
    etapa_contractual: 'EN_INTEGRACION', created_at: new Date('2026-10-13T10:00:00.000Z') }]);
  const qCount = vi.fn().mockResolvedValue(8);
  const qFind = vi.fn().mockResolvedValue([{ id: 'quote-1', numero_cotizacion: 'COT-0001-2026',
    etapa_contractual: 'EN_ELABORACION', prospecto: { nombre: 'Cliente QA' } }]);
  const source = new MiDiaCommercialCardsService({ prospecto: { count: pCount, findMany: pFind },
    cotizacion: { count: qCount, findMany: qFind } } as unknown as PrismaClient);

  it('keeps exact count separate from limited rows and preserves source object scope', async () => {
    const result = await source.read(actor, 'PROSPECTS_ACTIVE', { scope: 'OWN', limit: 5, now });
    expect(result.count).toBe(23);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].href).toBe('/prospectos/prospect-1');
    expect(pFind.mock.lastCall?.[0].take).toBe(5);
    expect(pCount.mock.lastCall?.[0].where.AND[0]).toMatchObject({
      organization_id: actor.organizationId, archived_at: null, user_id: actor.id,
    });
  });

  it('reads all four prospect predicates from current contractual data', async () => {
    for (const key of ['PROSPECTS_ACTIVE', 'PROSPECTS_NEW', 'PROSPECTS_STALE', 'PROSPECTS_READY'] as CommercialCardKey[]) {
      await source.read(actor, key, { scope: 'ORGANIZATION', period: 'TODAY', window: 7, now });
      const where = pCount.mock.lastCall?.[0].where.AND;
      expect(where[0].organization_id).toBe(actor.organizationId);
      if (key === 'PROSPECTS_NEW') expect(where[1].created_at).toEqual({
        gte: new Date('2026-10-13T06:00:00.000Z'), lt: new Date('2026-10-14T06:00:00.000Z'),
      });
      if (key === 'PROSPECTS_STALE') expect(where[1]).toMatchObject({
        transiciones: { none: { organization_id: actor.organizationId } },
        seguimientos: { none: { created_at: { gte: expect.any(Date) } } },
      });
      if (key === 'PROSPECTS_READY') expect(where[1].etapa_contractual).toBe('LISTO_PARA_COTIZAR');
    }
  });

  it('does not revive external-notary stages and uses real send/acceptance facts', async () => {
    for (const key of ['QUOTES_ACTIVE', 'QUOTES_NO_RESPONSE', 'QUOTES_FOLLOWUP', 'QUOTES_ACCEPTED'] as CommercialCardKey[]) {
      const result = await source.read(actor, key, { scope: 'OWN', period: 'TODAY', window: 7, now });
      expect(result.count).toBe(8);
      expect(result.items[0].href).toBe('/cotizaciones/quote-1');
      const where = qCount.mock.lastCall?.[0].where.AND;
      expect(where[0]).toMatchObject({ organization_id: actor.organizationId, user_id: actor.id });
      expect(JSON.stringify(where[1])).not.toMatch(/ENVIADA_NOTARIA|PRESUPUESTO_RECIBIDO/);
      if (key === 'QUOTES_NO_RESPONSE') expect(where[1].fecha_enviada_cliente).toBeTruthy();
      if (key === 'QUOTES_ACCEPTED') expect(where[1].fecha_aceptacion_cliente).toEqual({
        gte: new Date('2026-10-13T06:00:00.000Z'), lt: new Date('2026-10-14T06:00:00.000Z'),
      });
    }
  });

  it('lists elaborated unsent quotes from the structured current budget before the send snapshot exists', async () => {
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([{ id: 'ready', numero_cotizacion: 'COT-0002-2026',
      etapa_contractual: 'EN_ELABORACION', prospecto: { nombre: 'Cliente' } }]);
    const readySource = new MiDiaCommercialCardsService({ cotizacion: { count, findMany } } as unknown as PrismaClient);
    const result = await readySource.read(actor, 'QUOTES_TO_SEND', { scope: 'ORGANIZATION', limit: 5 });
    expect(result.count).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(['ready']);
    const where = count.mock.calls[0][0].where;
    expect(where.AND[0].organization_id).toBe(actor.organizationId);
    expect(where.AND[1]).toEqual({ etapa_contractual: 'EN_ELABORACION', total_cliente: { gt: 0 },
      conceptos: { some: { organization_id: actor.organizationId } } });
    expect(findMany.mock.calls[0][0]).toMatchObject({ where, take: 5 });
  });

  it('denies missing source permission without querying it', async () => {
    pCount.mockClear();
    await expect(source.read({ ...actor, permissions: [] }, 'PROSPECTS_READY', { scope: 'ORGANIZATION' }))
      .rejects.toThrow('MIDIA_COMMERCIAL_READ_DENIED');
    expect(pCount).not.toHaveBeenCalled();
  });

  it('defines sent→accepted and accepted→case rates by the same dated cohort without dividing by zero', async () => {
    const count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0)
      .mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'quote-2',
      numero_cotizacion: 'COT-0002-2026', etapa_contractual: 'CONVERTIDA_EXPEDIENTE',
      prospecto: { nombre: 'Cliente QA' }, expediente: { id: 'case-2', numero_pravia: 'EXP-0002-2026' } }]);
    const conversionSource = new MiDiaCommercialCardsService({ cotizacion: { count, findMany } } as unknown as PrismaClient);
    expect(await conversionSource.read(actor, 'QUOTES_CONVERSION', { scope: 'OWN', period: 'TODAY', now }))
      .toMatchObject({ count: 0, denominator: 0, rate: null });
    const cases = await conversionSource.read(actor, 'CASES_CONVERSION', { scope: 'OWN', period: 'TODAY', now });
    expect(cases).toMatchObject({ count: 2, denominator: 3, rate: 66.7 });
    expect(cases.items[0].href).toBe('/expedientes/case-2');
    expect(count.mock.calls[2][0].where.AND[1].fecha_aceptacion_cliente).toEqual({
      gte: new Date('2026-10-13T06:00:00.000Z'), lt: new Date('2026-10-14T06:00:00.000Z'),
    });
    expect(count.mock.calls[3][0].where.AND[1]).toMatchObject({
      expediente: { is: { organization_id: actor.organizationId } }, fecha_conversion_expediente: { not: null },
    });
  });

  it('reuses the quote-list total_cliente aggregate with exact scope and null for missing amounts', async () => {
    const count = vi.fn().mockResolvedValue(3);
    const aggregate = vi.fn().mockResolvedValueOnce({ _sum: { total_cliente: new Prisma.Decimal('410.25') } })
      .mockResolvedValueOnce({ _sum: { total_cliente: null } });
    const findMany = vi.fn().mockResolvedValue([{ id: 'quote-1', numero_cotizacion: 'COT-0001-2026',
      etapa_contractual: 'BORRADOR', prospecto: { nombre: 'Cliente' } }]);
    const valueSource = new MiDiaCommercialCardsService({ cotizacion: { count, aggregate, findMany } } as unknown as PrismaClient);
    const active = await valueSource.read(actor, 'QUOTES_ACTIVE_VALUE', { scope: 'OWN', limit: 1, now });
    expect(active).toMatchObject({ count: 3, amount: '410.25', items: [{ href: '/cotizaciones/quote-1' }] });
    expect(findMany.mock.calls[0][0].take).toBe(1);
    expect(aggregate.mock.calls[0][0].where).toEqual(count.mock.calls[0][0].where);
    expect(count.mock.calls[0][0].where.AND[0]).toMatchObject({ organization_id: actor.organizationId, user_id: actor.id });
    const accepted = await valueSource.read(actor, 'QUOTES_ACCEPTED_VALUE', { scope: 'ORGANIZATION', period: 'TODAY', now });
    expect(accepted.amount).toBeNull();
    expect(count.mock.calls[1][0].where.AND[1]).toEqual({ etapa_contractual: 'ACEPTADA',
      fecha_aceptacion_cliente: { gte: new Date('2026-10-13T06:00:00.000Z'), lt: new Date('2026-10-14T06:00:00.000Z') } });
  });
});
