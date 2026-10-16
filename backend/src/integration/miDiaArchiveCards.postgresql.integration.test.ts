import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { ArchivoService } from '../services/archivo.service';
import { MiDiaArchiveCardsService } from '../services/miDiaArchiveCards.service';

const target = process.env.DATABASE_URL || '';
const parsed = new URL(target || 'postgresql://invalid.invalid/blocked');
if (process.env.MIDIA_QA === '1' && (process.env.NODE_ENV !== 'test'
  || target !== process.env.DIRECT_URL || parsed.hostname !== '127.0.0.1'
  || parsed.port !== '55510' || parsed.pathname !== '/pravia_qa'
  || parsed.searchParams.get('schema') !== 'pravia_os')) {
  throw new Error('Mi Día Archivo integration requires isolated local PostgreSQL.');
}
const db = new PrismaClient({ datasources: { db: { url: target } } });
type Actor = NonNullable<Request['user']>;
afterAll(async () => db.$disconnect());

describe.runIf(process.env.MIDIA_QA === '1')('Mi Día Archivo cards · physical PostgreSQL', () => {
  it('matches Archivo next numbers and never reads another notaría, then rolls back', async () => {
    const ids = { org: randomUUID(), foreignOrg: randomUUID(), owner: randomUUID(), peer: randomUUID(), foreign: randomUUID(),
      ownCase: randomUUID(), peerCase: randomUUID(), oldCase: randomUUID(), foreignCase: randomUUID(),
      ownRecord: randomUUID(), peerRecord: randomUUID(), oldRecord: randomUUID(), foreignRecord: randomUUID() };
    const actor: Actor = { id: ids.owner, email: 'archivo-qa@example.test', nombre: 'Archivo', apellido: 'QA',
      rol: 'DIRECCION', scope: 'GLOBAL', organizationId: ids.org, membershipId: randomUUID(),
      sessionId: randomUUID(), permissions: ['expedientes.read'], requiresPasswordChange: false };
    const rollback = new Error('MI_DIA_ARCHIVO_ROLLBACK');
    try {
      await db.$transaction(async (tx) => {
        await tx.organization.createMany({ data: [{ id: ids.org, name: 'Mi Día Archivo QA' },
          { id: ids.foreignOrg, name: 'Mi Día Archivo ajeno QA' }] });
        await tx.user.createMany({ data: [ids.owner, ids.peer, ids.foreign].map((id) => ({ id, nombre: 'Archivo',
          apellido: 'QA', email: `archivo-${id}@example.test`, password_hash: 'synthetic-only', rol: 'DIRECCION' })) });
        await tx.organizationMembership.createMany({ data: [
          { organization_id: ids.org, user_id: ids.owner, rol: 'DIRECCION' },
          { organization_id: ids.org, user_id: ids.peer, rol: 'ABOGADO' },
          { organization_id: ids.foreignOrg, user_id: ids.foreign, rol: 'DIRECCION' },
        ] });
        await tx.expediente.createMany({ data: [
          { id: ids.ownCase, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.ownCase}`,
            abogado_id: ids.owner, creador_id: ids.owner },
          { id: ids.peerCase, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.peerCase}`,
            abogado_id: ids.peer, creador_id: ids.peer },
          { id: ids.oldCase, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.oldCase}`,
            abogado_id: ids.owner, creador_id: ids.owner },
          { id: ids.foreignCase, organization_id: ids.foreignOrg, numero_pravia: `EXP-QA-${ids.foreignCase}`,
            abogado_id: ids.foreign, creador_id: ids.foreign },
        ] });
        await tx.archivoRegistro.createMany({ data: [
          { id: ids.ownRecord, organization_id: ids.org, expediente_id: ids.ownCase, clase: 'INSTRUMENTO',
            numero_escritura: 100n, folio_inicio: 195n, folio_fin: 200n,
            fecha_instrumento: new Date('2026-10-13T00:00:00.000Z'), created_at: new Date('2026-10-14T08:30:00.000Z'),
            created_by_id: ids.owner, updated_by_id: ids.owner },
          { id: ids.peerRecord, organization_id: ids.org, expediente_id: ids.peerCase, clase: 'INSTRUMENTO',
            numero_escritura: 101n, folio_inicio: 201n, folio_fin: 205n,
            fecha_instrumento: new Date('2026-10-13T00:00:00.000Z'), created_at: new Date('2026-10-14T09:30:00.000Z'),
            created_by_id: ids.peer, updated_by_id: ids.peer },
          { id: ids.oldRecord, organization_id: ids.org, expediente_id: ids.oldCase, clase: 'INSTRUMENTO',
            numero_escritura: 102n, folio_inicio: 206n, folio_fin: 210n,
            fecha_instrumento: new Date('2026-10-13T00:00:00.000Z'), created_at: new Date('2026-10-13T09:30:00.000Z'),
            created_by_id: ids.owner, updated_by_id: ids.owner },
          { id: ids.foreignRecord, organization_id: ids.foreignOrg, expediente_id: ids.foreignCase, clase: 'INSTRUMENTO',
            numero_escritura: 900n, folio_inicio: 995n, folio_fin: 999n,
            fecha_instrumento: new Date('2026-10-13T00:00:00.000Z'), created_at: new Date('2026-10-14T08:30:00.000Z'),
            created_by_id: ids.foreign, updated_by_id: ids.foreign },
        ] });
        const archivo = new ArchivoService(tx as unknown as PrismaClient);
        const source = new MiDiaArchiveCardsService(archivo);
        const overview = await archivo.overview(actor);
        const cards = await source.readVisible(actor, ['NEXT_DEED', 'NEXT_FOLIO']);
        expect(cards.NEXT_DEED?.value).toBe(overview.next_numero_escritura);
        expect(cards.NEXT_FOLIO?.value).toBe(overview.next_folio);
        expect(cards.NEXT_DEED?.value).toBe('103');
        expect(cards.NEXT_FOLIO?.value).toBe('211');
        const today = await source.readVisible(actor, ['DEEDS_TODAY'], {
          timezone: 'America/Mexico_City', now: new Date('2026-10-14T12:00:00.000Z'), limit: 1,
        });
        expect(today.DEEDS_TODAY?.value).toBe('2');
        expect(today.DEEDS_TODAY?.items).toHaveLength(1);
        expect(today.DEEDS_TODAY?.items?.[0].href).toBe(`/expedientes/${ids.peerCase}#archivo`);
        const lawyer = await source.readVisible({ ...actor, rol: 'ABOGADO' }, ['DEEDS_TODAY'], {
          timezone: 'America/Mexico_City', now: new Date('2026-10-14T12:00:00.000Z'), limit: 5,
        });
        expect(lawyer.DEEDS_TODAY?.value).toBe('1');
        expect(lawyer.DEEDS_TODAY?.items?.[0].href).toBe(`/expedientes/${ids.ownCase}#archivo`);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    expect(await db.archivoRegistro.count({ where: { id: ids.ownRecord } })).toBe(0);
  });
});
