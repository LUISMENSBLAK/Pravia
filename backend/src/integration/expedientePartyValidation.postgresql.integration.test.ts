import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { runWithActorContext } from '../auth/actorContext';
import { ComparecienteService } from '../services/compareciente.service';
import { ExpedientePartiesService } from '../services/expedienteParties.service';

const target = process.env.DATABASE_URL || '';
const parsed = new URL(target || 'postgresql://invalid.invalid/blocked');
if (process.env.MIDIA_QA === '1' && (process.env.NODE_ENV !== 'test'
  || target !== process.env.DIRECT_URL || parsed.hostname !== '127.0.0.1'
  || parsed.port !== '55510' || parsed.pathname !== '/pravia_qa'
  || parsed.searchParams.get('schema') !== 'pravia_os')) {
  throw new Error('X08 integration requires isolated local PostgreSQL.');
}

const db = new PrismaClient({ datasources: { db: { url: target } } });
type Actor = NonNullable<Request['user']>;
afterAll(async () => db.$disconnect());

describe.runIf(process.env.MIDIA_QA === '1')('X08 · human compareciente validation · physical PostgreSQL', () => {
  it('persists an authorized human validation, is idempotent, denies unauthorized/foreign actors and invalidates after material master changes', async () => {
    const ids = {
      org: randomUUID(), foreignOrg: randomUUID(), user: randomUUID(), foreignUser: randomUUID(), membership: randomUUID(),
      type: randomUUID(), character: randomUUID(), case: randomUUID(), act: randomUUID(), party: randomUUID(), relation: randomUUID(),
    };
    const actor: Actor = {
      id: ids.user, email: `x08-${ids.user}@example.test`, nombre: 'Revisor', apellido: 'X08', rol: 'DIRECCION',
      scope: 'GLOBAL', organizationId: ids.org, membershipId: ids.membership, sessionId: randomUUID(),
      permissions: ['expedientes.read', 'expedientes.write', 'comparecientes.read', 'comparecientes.write'], requiresPasswordChange: false,
    };
    const context = { userId: actor.id, organizationId: actor.organizationId, membershipId: actor.membershipId,
      role: actor.rol, permissions: actor.permissions, scope: actor.scope, sessionId: actor.sessionId };
    const rollback = new Error('X08_ROLLBACK');
    try {
      await db.$transaction(async (tx) => {
        await tx.organization.createMany({ data: [{ id: ids.org, name: 'X08 QA' }, { id: ids.foreignOrg, name: 'X08 Foreign QA' }] });
        await tx.user.createMany({ data: [
          { id: ids.user, email: actor.email, nombre: actor.nombre, apellido: actor.apellido, password_hash: 'synthetic-only', rol: 'DIRECCION' },
          { id: ids.foreignUser, email: `x08-foreign-${ids.foreignUser}@example.test`, nombre: 'Foreign', apellido: 'X08', password_hash: 'synthetic-only', rol: 'DIRECCION' },
        ] });
        await tx.organizationMembership.create({ data: { id: ids.membership, organization_id: ids.org, user_id: ids.user, rol: 'DIRECCION' } });
        await tx.tipoActo.create({ data: { id: ids.type, codigo_catalogo: `X08-${ids.type}`, nombre: 'Acto sintético X08' } });
        await tx.caracterCompareciente.create({ data: { id: ids.character, clave: `X08_${ids.character.replaceAll('-', '')}`, nombre: 'Compareciente sintético' } });
        await tx.expediente.create({ data: { id: ids.case, organization_id: ids.org, numero_pravia: `EXP-X08-${ids.case}`, abogado_id: ids.user, creador_id: ids.user, tipo_acto_id: ids.type } });
        await tx.expedienteActo.create({ data: { id: ids.act, organization_id: ids.org, expediente_id: ids.case, tipo_acto_id: ids.type, origen: 'ADICIONAL', created_by: ids.user } });
        await tx.compareciente.create({ data: { id: ids.party, organization_id: ids.org, tipo_persona: 'FISICA', nombre_busqueda: 'PERSONA X08', creado_por_id: ids.user } });
        await tx.personaFisica.create({ data: { organization_id: ids.org, compareciente_id: ids.party, nombre: 'PERSONA', apellido_paterno: 'X08', nombre_completo_calculado: 'PERSONA X08' } });
        await tx.expedienteCompareciente.create({ data: { id: ids.relation, organization_id: ids.org, expediente_id: ids.case, expediente_acto_id: ids.act, compareciente_id: ids.party, caracter_id: ids.character, creado_por_id: ids.user } });

        const adapter = { $transaction: async (callback: (client: Prisma.TransactionClient) => Promise<unknown>) => callback(tx) } as unknown as PrismaClient;
        const service = new ExpedientePartiesService(adapter);
        const key = `x08-${randomUUID()}`;
        const validated = await service.validateData(actor, ids.case, ids.relation, { confirm: true, idempotency_key: key });
        expect(validated).toMatchObject({ idempotent: false, relation: { id: ids.relation, datos_validados: true, validado_por_id: ids.user } });
        expect(validated.relation.validado_at).toBeInstanceOf(Date);
        expect((await service.validateData(actor, ids.case, ids.relation, { confirm: true, idempotency_key: key })).idempotent).toBe(true);
        expect(await tx.auditLog.count({ where: { organization_id: ids.org, accion: 'VALIDATE_EXPEDIENTE_PARTY_DATA', entidad_id: ids.relation } })).toBe(1);
        expect(await tx.expedienteActividad.count({ where: { organization_id: ids.org, expediente_id: ids.case, entidad_relacionada_id: ids.relation } })).toBe(1);

        await expect(service.validateData({ ...actor, permissions: ['expedientes.write'] }, ids.case, ids.relation, { confirm: true, idempotency_key: randomUUID() }))
          .rejects.toMatchObject({ status: 403, code: 'EXPEDIENTE_PARTY_VALIDATION_PERMISSION_DENIED' });
        await expect(service.validateData({ ...actor, id: ids.foreignUser, organizationId: ids.foreignOrg, membershipId: randomUUID() }, ids.case, ids.relation, { confirm: true, idempotency_key: randomUUID() }))
          .rejects.toMatchObject({ status: 403, code: 'EXPEDIENTE_ACCESS_DENIED' });

        const comparecienteService = new ComparecienteService(adapter);
        await runWithActorContext(context, () => comparecienteService.actualizarMaster(ids.party, { telefono: '5551002000' }, ids.user));
        const invalidated = await tx.expedienteCompareciente.findUniqueOrThrow({ where: { id: ids.relation } });
        expect(invalidated).toMatchObject({ datos_validados: false, validado_por_id: null, validado_at: null });
        expect(await tx.auditLog.count({ where: { organization_id: ids.org, accion: 'INVALIDATE_EXPEDIENTE_PARTY_DATA_VALIDATION', entidad_id: ids.party } })).toBe(1);
        throw rollback;
      }, { timeout: 30_000 });
    } catch (error) { if (error !== rollback) throw error; }
    expect(await db.expedienteCompareciente.count({ where: { id: ids.relation } })).toBe(0);
  }, 40_000);
});
