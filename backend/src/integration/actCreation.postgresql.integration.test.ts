import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithActorContext } from '../auth/actorContext';
import prisma from '../config/prisma';
import { actsAndTimesService } from '../services/configurationCatalog.service';

const qaUrl = process.env.ACT_CREATION_QA_DATABASE_URL || '';
const parsed = new URL(qaUrl || 'postgresql://invalid.invalid/blocked');
const runtime = new URL(process.env.DATABASE_URL || 'postgresql://invalid.invalid/blocked');
if (process.env.ACT_CREATION_QA === '1' && [parsed, runtime].some((url) =>
  url.hostname !== '127.0.0.1' || url.port !== '55510' || url.pathname !== '/pravia_qa' || url.searchParams.get('schema') !== 'pravia_os')) {
  throw new Error('Act creation integration test requires the isolated local pravia_qa database.');
}

const db = new PrismaClient({ datasources: { db: { url: qaUrl } } });
type Actor = NonNullable<Request['user']>;
function makeActor(): Actor {
  const id = randomUUID();
  return {
    id, organizationId: randomUUID(), membershipId: randomUUID(), sessionId: randomUUID(),
    rol: 'ADMINISTRACION', nombre: 'Act Creation', apellido: 'QA', email: `act-creation-${id}@example.test`,
    scope: 'GLOBAL', requiresPasswordChange: false,
    permissions: ['configuracion.catalogos.read', 'configuracion.actos_tiempos.manage'],
  };
}
const owner = makeActor();
const outsider = makeActor();
const run = <T>(actor: Actor, callback: () => T) => runWithActorContext({
  userId: actor.id, organizationId: actor.organizationId, membershipId: actor.membershipId,
  sessionId: actor.sessionId, role: actor.rol, permissions: actor.permissions, scope: actor.scope,
}, callback);

describe.runIf(process.env.ACT_CREATION_QA === '1')('integral act creation · isolated PostgreSQL', () => {
  beforeAll(async () => {
    const [identity] = await db.$queryRaw<Array<{ database: string; schema: string }>>`SELECT current_database() AS database, current_schema() AS schema`;
    expect(identity).toEqual({ database: 'pravia_qa', schema: 'pravia_os' });
    for (const actor of [owner, outsider]) {
      await db.organization.create({ data: { id: actor.organizationId, name: `Act QA ${actor.organizationId}` } });
      await db.user.create({ data: { id: actor.id, email: actor.email, password_hash: 'synthetic-not-a-login', nombre: actor.nombre, apellido: actor.apellido, rol: actor.rol, activo: true } });
      await db.organizationMembership.create({ data: { id: actor.membershipId, organization_id: actor.organizationId, user_id: actor.id, rol: actor.rol, status: 'ACTIVE' } });
    }
  });
  afterAll(async () => { await Promise.all([db.$disconnect(), prisma.$disconnect()]); });

  it('persists processes, parties and audit atomically, without seeding unrelated acts', async () => {
    const name = `Acto QA ${randomUUID()}`;
    const before = await db.tipoActo.count({ where: { organization_id: owner.organizationId } });
    const created = await run(owner, () => actsAndTimesService.create(owner, {
      nombre: name, clasificacion: 'TRASLATIVOS', familia: 'QA', jurisdiccion: 'Jalisco',
      registrable: true, actividad_vulnerable: false,
      processes: [
        { code: 'REVISION_INICIAL', duration: 4, dayType: 'HABILES', margin: 1 },
        { code: 'PROYECCION_INSTRUMENTO', duration: 7, dayType: 'HABILES', margin: 2, parallelGroup: 'PREFIRMA_QA',
          dependencyCodes: ['REVISION_INICIAL'], condition: { op: 'eq', field: 'expediente.tiene_credito', value: true },
          exceptions: [{ selector: 'JURISDICCION', jurisdiction: 'Jalisco', duration: 9, dayType: 'NATURALES', margin: 3 }],
        },
      ],
      characters: [{ name: 'VENDEDOR', principal: true }, { name: 'COMPRADOR', principal: true }, { name: 'APODERADO', principal: false }],
    }));
    expect(created.complete).toBe(true);
    expect(await db.tipoActo.count({ where: { organization_id: owner.organizationId } })).toBe(before + 1);
    const detail = await run(owner, () => actsAndTimesService.get(owner, created.id));
    expect(detail.complete).toBe(true);
    expect(detail.effective_activities).toHaveLength(2);
    expect(detail.effective_activities).toEqual(expect.arrayContaining([expect.objectContaining({ duracion_estimada: 4, margen_seguridad: 1 })]));
    const configured = await db.configuracionActividad.findFirstOrThrow({ where: { etapa: { configuracion_id: created.configuration.id }, grupo_paralelo: 'PREFIRMA_QA' }, include: { dependencias: true, excepciones: true } });
    expect(configured.dependencias).toHaveLength(1);
    expect(configured.excepciones).toMatchObject([{ selector_tipo: 'JURISDICCION', jurisdiccion: 'JALISCO', duracion: 9 }]);
    expect(detail.character_roles.map((role: { caracter: { nombre: string } }) => role.caracter.nombre.toLocaleUpperCase('es-MX'))).toEqual(['VENDEDOR', 'COMPRADOR', 'APODERADO']);
    await expect(run(outsider, () => actsAndTimesService.get(outsider, created.id))).rejects.toMatchObject({ status: 404 });
    expect(await db.auditLog.count({ where: { organization_id: owner.organizationId, accion: 'CFG_ACT_CREATED', entidad_id: created.id } })).toBe(1);
  });

  it('rejects cyclic process dependencies without persisting an act', async () => {
    const name = `Acto Ciclo ${randomUUID()}`;
    await expect(run(owner, () => actsAndTimesService.create(owner, {
      nombre: name, clasificacion: 'TRASLATIVOS', familia: 'QA', jurisdiccion: 'Jalisco', registrable: true, actividad_vulnerable: false,
      processes: [
        { code: 'REVISION_INICIAL', duration: 1, dayType: 'HABILES', dependencyCodes: ['FIRMA'] },
        { code: 'FIRMA', duration: 1, dayType: 'HABILES', dependencyCodes: ['REVISION_INICIAL'] },
      ],
      characters: [{ name: 'COMPRADOR', principal: true }],
    }))).rejects.toMatchObject({ code: 'DEPENDENCY_CYCLE' });
    expect(await db.tipoActo.count({ where: { organization_id: owner.organizationId, nombre: name.toLocaleUpperCase('es-MX') } })).toBe(0);
  });

  it('rejects a repeated create request without duplicating an act', async () => {
    const name = `Acto Reintento ${randomUUID()}`;
    const input = {
      nombre: name, clasificacion: 'TRASLATIVOS', familia: 'QA', jurisdiccion: 'Jalisco', registrable: false, actividad_vulnerable: false,
      processes: [{ code: 'REVISION_INICIAL', duration: 1, dayType: 'HABILES' }],
      characters: [{ name: 'COMPRADOR', principal: true }],
    };
    await run(owner, () => actsAndTimesService.create(owner, input));
    await expect(run(owner, () => actsAndTimesService.create(owner, input))).rejects.toMatchObject({ status: 409, code: 'ACT_ALREADY_EXISTS' });
    expect(await db.tipoActo.count({ where: { organization_id: owner.organizationId, nombre: name.toLocaleUpperCase('es-MX') } })).toBe(1);
  });

  it('adds a missing role to an existing act without cross-tenant disclosure or duplicate links', async () => {
    const created = await run(owner, () => actsAndTimesService.create(owner, {
      nombre: `Acto roles ${randomUUID()}`, clasificacion: 'TRASLATIVOS', familia: 'QA', jurisdiccion: 'Jalisco',
      registrable: false, actividad_vulnerable: false,
      processes: [{ code: 'REVISION_INICIAL', duration: 1, dayType: 'HABILES' }],
      characters: [{ name: 'Transmitente', principal: true }],
    }));
    const before = await db.tipoActoCaracterCompareciente.count({ where: { tipo_acto_id: created.id } });
    await run(owner, () => actsAndTimesService.addCharacter(owner, created.id, { name: 'Adquirente', principal: true }));
    const detail = await run(owner, () => actsAndTimesService.get(owner, created.id));
    expect(detail.character_roles.map((role: { caracter: { nombre: string } }) => role.caracter.nombre)).toContain('ADQUIRENTE');
    expect(await db.tipoActoCaracterCompareciente.count({ where: { tipo_acto_id: created.id } })).toBe(before + 1);
    await expect(run(owner, () => actsAndTimesService.addCharacter(owner, created.id, { name: 'adquirente', principal: true }))).rejects.toMatchObject({ code: 'ACT_CHARACTER_DUPLICATE' });
    await expect(run(outsider, () => actsAndTimesService.addCharacter(outsider, created.id, { name: 'Comprador', principal: true }))).rejects.toMatchObject({ code: 'ACT_NOT_FOUND' });
    expect(await db.auditLog.count({ where: { organization_id: owner.organizationId, accion: 'CFG_ACT_CHARACTER_ADDED', entidad: 'TipoActoCaracterCompareciente' } })).toBeGreaterThanOrEqual(1);
  });
});
