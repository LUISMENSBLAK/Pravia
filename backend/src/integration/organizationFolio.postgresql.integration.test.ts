import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { reserveOrganizationFolio } from '../services/organizationFolio.service';

const url = process.env.COLLAB_FOLIO_DATABASE_URL || '';
const local = /^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/postgres\?schema=pravia_os$/.test(url);
const db = local ? new PrismaClient({ datasources: { db: { url } } }) : null;
const first = randomUUID();
const second = randomUUID();
const year = new Date('2026-11-01T12:00:00.000Z');

describe.runIf(local)('COL36–COL46 · folios por organización en PostgreSQL local', () => {
  beforeAll(async () => {
    await db!.organization.createMany({ data: [
      { id: first, name: 'QA colaboración A' }, { id: second, name: 'QA colaboración B' },
    ] });
  });
  afterAll(async () => {
    await db!.expedienteFolioSerie.deleteMany({ where: { organization_id: { in: [first, second] } } });
    await db!.folioCounter.deleteMany({ where: { organization_id: { in: [first, second] } } });
    await db!.organization.deleteMany({ where: { id: { in: [first, second] } } });
    await db!.$disconnect();
  });

  it('serializa 50 altas simultáneas entre usuarios de una notaría', async () => {
    const folios = await Promise.all(Array.from({ length: 50 }, () => db!.$transaction(
      (tx) => reserveOrganizationFolio(tx, first, 'EXP', year),
      { maxWait: 30_000, timeout: 30_000 },
    )));
    expect(new Set(folios).size).toBe(50);
    expect(folios.sort()).toEqual(Array.from({ length: 50 }, (_, i) => `EXP-${String(i + 1).padStart(4, '0')}-2026`));
  }, 60_000);

  it('mantiene dominios y tenants independientes, sin reciclar el contador', async () => {
    const [nextA, firstB, firstProspect, nextYear] = await Promise.all([
      db!.$transaction((tx) => reserveOrganizationFolio(tx, first, 'EXP', year)),
      db!.$transaction((tx) => reserveOrganizationFolio(tx, second, 'EXP', year)),
      db!.$transaction((tx) => reserveOrganizationFolio(tx, first, 'PRO', year)),
      db!.$transaction((tx) => reserveOrganizationFolio(tx, first, 'EXP', new Date('2027-11-01T12:00:00.000Z'))),
    ]);
    expect([nextA, firstB, firstProspect, nextYear]).toEqual([
      'EXP-0051-2026', 'EXP-0001-2026', 'PRO-0001-2026', 'EXP-0001-2027',
    ]);
  });

  it('reserva ESP independientemente de la serie ordinaria, del año y del tenant', async () => {
    const createdBy = randomUUID();
    await db!.expedienteFolioSerie.createMany({ data: [
      { organization_id: first, code: 'ESP', created_by_id: createdBy },
      { organization_id: second, code: 'ESP', created_by_id: createdBy },
    ] });
    const [firstEsp, firstOtherTenant] = await Promise.all([
      db!.$transaction((tx) => reserveOrganizationFolio(tx, first, 'EXP', year, 'ESP')),
      db!.$transaction((tx) => reserveOrganizationFolio(tx, second, 'EXP', year, 'ESP')),
    ]);
    expect(firstEsp).toBe('EXP-ESP-0001-2026');
    expect(firstOtherTenant).toBe('EXP-ESP-0001-2026');
    const simultaneous = await Promise.all(Array.from({ length: 10 }, () => db!.$transaction(
      (tx) => reserveOrganizationFolio(tx, first, 'EXP', year, 'ESP'), { maxWait: 30_000, timeout: 30_000 },
    )));
    expect(new Set(simultaneous).size).toBe(10);
    expect(simultaneous.sort()).toEqual(Array.from({ length: 10 }, (_, i) => `EXP-ESP-${String(i + 2).padStart(4, '0')}-2026`));
    expect(await db!.$transaction((tx) => reserveOrganizationFolio(tx, first, 'EXP', year))).toBe('EXP-0052-2026');
    await expect(db!.$transaction((tx) => reserveOrganizationFolio(tx, first, 'PRO', year, 'ESP'))).rejects.toThrow();
    await expect(db!.$transaction((tx) => reserveOrganizationFolio(tx, first, 'EXP', year, 'OTRA'))).rejects.toThrow();
  }, 60_000);

  it('continúa desde máximos históricos legacy sin renumerar IDs, folios ni relaciones', async () => {
    const orgId = randomUUID();
    const userId = randomUUID();
    await db!.organization.create({ data: { id: orgId, name: 'QA folios históricos aislados' } });
    try {
      await db!.user.create({ data: { id: userId, email: `folio-${orgId}@pravia.test`, nombre: 'Folio', apellido: 'QA', rol: 'DIRECCION', password_hash: 'qa-not-for-login' } });
      await db!.organizationMembership.create({ data: { organization_id: orgId, user_id: userId, rol: 'DIRECCION' } });
      const originalProspect = await db!.prospecto.create({ data: {
        organization_id: orgId, user_id: userId, nombre: 'Histórico sintético', folio: 'PRO-2026-0007',
      } });
      const originalQuote = await db!.cotizacion.create({ data: {
        organization_id: orgId, user_id: userId, prospecto_id: originalProspect.id, numero_cotizacion: 'COT-2026-0010',
      } });
      const originalCase = await db!.expediente.create({ data: {
        organization_id: orgId, abogado_id: userId, creador_id: userId, cotizacion_id: originalQuote.id, numero_pravia: 'EXP-2026-0005',
      } });
      await db!.expedienteFolioSerie.create({ data: { organization_id: orgId, code: 'ESP', created_by_id: userId } });
      const originalSpecial = await db!.expediente.create({ data: {
        organization_id: orgId, abogado_id: userId, creador_id: userId, numero_pravia: 'EXP-ESP-0009-2026',
      } });
      const historicalIds = [originalCase.id, originalSpecial.id];
      const snapshot = async () => ({
        prospects: await db!.prospecto.findMany({ where: { id: originalProspect.id }, select: { id: true, folio: true, organization_id: true } }),
        quotes: await db!.cotizacion.findMany({ where: { id: originalQuote.id }, select: { id: true, numero_cotizacion: true, prospecto_id: true, organization_id: true } }),
        cases: await db!.expediente.findMany({ where: { id: { in: historicalIds } }, orderBy: { id: 'asc' }, select: { id: true, numero_pravia: true, cotizacion_id: true, organization_id: true } }),
      });
      const before = await snapshot();
      const [nextProspect, nextQuote, nextCase, nextSpecial] = await Promise.all([
        db!.$transaction((tx) => reserveOrganizationFolio(tx, orgId, 'PRO', year)),
        db!.$transaction((tx) => reserveOrganizationFolio(tx, orgId, 'COT', year)),
        db!.$transaction((tx) => reserveOrganizationFolio(tx, orgId, 'EXP', year)),
        db!.$transaction((tx) => reserveOrganizationFolio(tx, orgId, 'EXP', year, 'ESP')),
      ]);
      expect([nextProspect, nextQuote, nextCase, nextSpecial]).toEqual([
        'PRO-0008-2026', 'COT-0011-2026', 'EXP-0006-2026', 'EXP-ESP-0010-2026',
      ]);
      const newProspect = await db!.prospecto.create({ data: { organization_id: orgId, user_id: userId, nombre: 'Nuevo sintético', folio: nextProspect } });
      const newQuote = await db!.cotizacion.create({ data: { organization_id: orgId, user_id: userId, prospecto_id: newProspect.id, numero_cotizacion: nextQuote } });
      await db!.expediente.createMany({ data: [
        { organization_id: orgId, abogado_id: userId, creador_id: userId, cotizacion_id: newQuote.id, numero_pravia: nextCase },
        { organization_id: orgId, abogado_id: userId, creador_id: userId, numero_pravia: nextSpecial },
      ] });
      // Simula un histórico incorporado después de inicializar el contador:
      // la siguiente reserva debe saltar al máximo sin tocar ninguna fila previa.
      await db!.prospecto.create({ data: { organization_id: orgId, user_id: userId, nombre: 'Importación histórica sintética', folio: 'PRO-2026-0099' } });
      expect(await db!.$transaction((tx) => reserveOrganizationFolio(tx, orgId, 'PRO', year))).toBe('PRO-0100-2026');
      expect(await snapshot()).toEqual(before);
      expect(await db!.expediente.count({ where: { organization_id: orgId } })).toBe(4);
      await expect(db!.expediente.create({ data: { organization_id: orgId, abogado_id: userId, creador_id: userId, numero_pravia: nextCase } }))
        .rejects.toMatchObject({ code: 'P2002' });
    } finally {
      await db!.expediente.deleteMany({ where: { organization_id: orgId } });
      await db!.cotizacion.deleteMany({ where: { organization_id: orgId } });
      await db!.prospecto.deleteMany({ where: { organization_id: orgId } });
      await db!.expedienteFolioSerie.deleteMany({ where: { organization_id: orgId } });
      await db!.folioCounter.deleteMany({ where: { organization_id: orgId } });
      await db!.organizationMembership.deleteMany({ where: { organization_id: orgId } });
      await db!.user.deleteMany({ where: { id: userId } });
      await db!.organization.deleteMany({ where: { id: orgId } });
    }
  }, 60_000);
});
