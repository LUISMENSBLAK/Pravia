import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { ProspectWorkflowService } from '../services/prospectWorkflow.service';
import { tenantIsolationMiddleware } from '../config/tenantPrisma';
import { runWithActorContext } from '../auth/actorContext';

const url = process.env.CORRECTION001_DATABASE_URL ?? 'postgresql://postgres:test@127.0.0.1:55475/pravia_c001_fresh_a?schema=pravia_os';
const db: any = new PrismaClient({ datasources: { db: { url } } });
const scoped = new PrismaClient({ datasources: { db: { url } } });
scoped.$use(tenantIsolationMiddleware);
let failAudit = false;
scoped.$use(async (params, next) => {
  if (failAudit && params.model === 'AuditLog' && params.action === 'create') throw new Error('correction001-audit-failure');
  return next(params);
});
const service = new ProspectWorkflowService(scoped);
type Actor = NonNullable<Request['user']>;
const actor = (n: number): Actor => ({
  id: `92000000-0000-4000-8000-00000000000${n}`,
  organizationId: `91000000-0000-4000-8000-00000000000${n}`,
  membershipId: `93000000-0000-4000-8000-00000000000${n}`,
  sessionId: randomUUID(), rol: 'ADMINISTRACION', nombre: 'Corrección', apellido: String(n),
  email: `correction-001-${n}@example.test`, scope: 'GLOBAL', requiresPasswordChange: false,
  permissions: ['prospectos.read', 'prospectos.write', 'documentos.read', 'documentos.write', 'documentos.unlink', 'cotizaciones.read', 'cotizaciones.write'],
});
const primary = actor(1);
const foreign = actor(2);
const run = <T>(who: Actor, fn: () => T) => runWithActorContext({
  userId: who.id, organizationId: who.organizationId, membershipId: who.membershipId,
  sessionId: who.sessionId, role: who.rol, permissions: who.permissions, scope: who.scope,
}, fn);
const create = (who = primary, key = randomUUID(), nombre = '  cliente   corrección 001 ') =>
  run(who, () => service.create(who, { nombre }, key)).then((result) => result.prospecto);
const read = (id: string, who = primary) => run(who, () => service.read(who, id));
const mutate = (who: Actor, id: string, payload: Record<string, unknown>) => run(who, () => service.act(who, id, payload));
const act = async (id: string, action: string, who = primary, extra: Record<string, unknown> = {}) => {
  const current = await read(id, who);
  return mutate(who, id, { action, expectedVersion: current.version, confirm: true, idempotencyKey: randomUUID(), ...extra });
};
const ready = async (who = primary) => {
  const prospect = await create(who);
  await act(prospect.id, 'COMENZAR_INTEGRACION', who);
  await act(prospect.id, 'MARCAR_LISTO_PARA_COTIZAR', who);
  return prospect;
};

describe.runIf(process.env.CORRECTION001_RUN_ISOLATED === '1')('Corrección 001 · PostgreSQL aislado Prospecto → Cotización', () => {
  beforeAll(async () => {
    const [database] = await db.$queryRaw`SELECT current_database() AS name`;
    expect(database.name).toMatch(/^pravia_c001_/);
    for (const who of [primary, foreign]) {
      await db.organization.upsert({ where: { id: who.organizationId }, update: {}, create: { id: who.organizationId, name: `Tenant ${who.apellido}` } });
      await db.user.upsert({ where: { id: who.id }, update: {}, create: {
        id: who.id, email: who.email, password_hash: 'synthetic-not-a-login', nombre: who.nombre,
        apellido: who.apellido, rol: 'ADMINISTRACION', activo: true, requires_password_change: false,
      } });
      await db.organizationMembership.upsert({ where: { organization_id_user_id: { organization_id: who.organizationId, user_id: who.id } }, update: {}, create: {
        id: who.membershipId, organization_id: who.organizationId, user_id: who.id, rol: 'ADMINISTRACION', status: 'ACTIVE',
      } });
    }
    const actType = await db.tipoActo.upsert({
      where: { codigo_catalogo: 'COMPRAVENTA' },
      update: {},
      create: { codigo_catalogo: 'COMPRAVENTA', nombre: 'Compraventa', activo: true },
    });
    await db.prospectoServicioCatalogo.upsert({
      where: { codigo: 'COMPRAVENTA' },
      update: { tipo_acto_id: actType.id },
      create: {
        codigo: 'COMPRAVENTA', label: 'Compraventa', orden: 1, activo: true,
        estados: ['Nayarit', 'Jalisco'], tipos_persona: [], tipo_acto_id: actType.id,
      },
    });
  });
  afterAll(async () => { await Promise.all([db.$disconnect(), scoped.$disconnect()]); });

  it('crea en NUEVO con folio, actor, fecha y evento persistidos', async () => {
    const prospect = await create();
    const workflow = await read(prospect.id);
    expect(prospect.nombre).toBe('CLIENTE CORRECCIÓN 001');
    expect(prospect.folio).toMatch(/^PRO-\d{4}-\d{4}$/);
    expect(workflow).toMatchObject({ stage: 'NUEVO', version: 1, knowledge: 'KNOWN' });
    expect(workflow.events).toHaveLength(1);
    expect(workflow.events[0]).toMatchObject({ nextLabel: 'Nuevo', actor: 'Corrección 1' });
  });

  it('implementa exactamente NUEVO → EN INTEGRACIÓN → LISTO PARA COTIZAR', async () => {
    const prospect = await create();
    expect((await read(prospect.id)).actions.map((item) => item.code)).toEqual(['COMENZAR_INTEGRACION', 'SUSPENDER', 'CANCELAR']);
    await act(prospect.id, 'COMENZAR_INTEGRACION');
    expect(await read(prospect.id)).toMatchObject({ stage: 'EN_INTEGRACION', wait: { type: 'CLIENTE_DOCUMENTOS' } });
    await act(prospect.id, 'MARCAR_LISTO_PARA_COTIZAR');
    const workflow = await read(prospect.id);
    expect(workflow).toMatchObject({ stage: 'LISTO_PARA_COTIZAR', wait: { type: 'OFFICE_QUOTE' } });
    expect(workflow.events.map((item) => item.actionLabel)).toEqual(['Prospecto creado', 'Comenzar integración', 'Marcar listo para cotizar']);
  });

  it('rechaza saltos, estado manual y acciones de notaría retiradas', async () => {
    const prospect = await create();
    await expect(act(prospect.id, 'CONVERTIR')).rejects.toMatchObject({ status: 409 });
    await expect(act(prospect.id, 'REGISTRAR_ENVIO')).rejects.toMatchObject({ status: 400, code: 'PRO001_ACTION_INVALID' });
    await expect(run(primary, () => service.update(primary, prospect.id, { expectedVersion: 1, etapa_contractual: 'LISTO_PARA_COTIZAR' }))).rejects.toMatchObject({ status: 400 });
    await expect(run(primary, () => service.prepare(primary, prospect.id, {}))).rejects.toMatchObject({ status: 409, code: 'LEGACY_NOTARY_FLOW_RETIRED' });
  });

  it.each([['SUSPENDER', 'SUSPENDIDO'], ['CANCELAR', 'CANCELADO']])('permite la salida excepcional %s', async (action, stage) => {
    const prospect = await create();
    await act(prospect.id, action);
    expect((await read(prospect.id)).stage).toBe(stage);
  });

  it('persiste contacto, acto, responsable y preparación económica', async () => {
    const prospect = await create();
    await run(primary, () => service.update(primary, prospect.id, {
      expectedVersion: 1, nombre: 'cliente editado', telefono: '3111002000', email: 'cliente@example.test',
      servicio_catalogo_codigo: 'COMPRAVENTA', necesidad: 'Adquisición de inmueble',
      honorarios_estimados: '1000.00', impuestos_derechos_estimados: '160.00', total_estimado: '1160.00',
    }));
    const persisted = await db.prospecto.findUniqueOrThrow({ where: { id: prospect.id } });
    expect(persisted).toMatchObject({ nombre: 'CLIENTE EDITADO', telefono: '3111002000', email: 'cliente@example.test', tipo_acto: 'Compraventa', user_id: primary.id });
    expect(persisted.total_estimado?.toString()).toBe('1160');
    await expect(run(primary, () => service.update(primary, prospect.id, {
      expectedVersion: persisted.version_operativa, honorarios_estimados: '1000', impuestos_derechos_estimados: '160', total_estimado: '999',
    }))).rejects.toMatchObject({ status: 400 });
  });

  it('convierte atómicamente, hereda datos y conserva el documento sin duplicar blob', async () => {
    const prospect = await create();
    await run(primary, () => service.update(primary, prospect.id, {
      expectedVersion: 1, telefono: '3111002000', email: 'cliente@example.test', servicio_catalogo_codigo: 'COMPRAVENTA',
      necesidad: 'Operación directa', honorarios_estimados: '1000', impuestos_derechos_estimados: '160', total_estimado: '1160',
    }));
    const document = await db.documento.create({ data: {
      organization_id: primary.organizationId, prospecto_id: prospect.id, subido_por_id: primary.id,
      tipo: 'OTRO', categoria: 'PROYECTO', nombre_original: 'identificacion.pdf', nombre_interno: randomUUID(),
      storage_key: `local-synthetic/${randomUUID()}`, mime_type: 'application/pdf', size_bytes: 32,
    } });
    await act(prospect.id, 'COMENZAR_INTEGRACION');
    await act(prospect.id, 'MARCAR_LISTO_PARA_COTIZAR');
    const result = await act(prospect.id, 'CONVERTIR');
    const quote = await db.cotizacion.findUniqueOrThrow({ where: { id: result.quoteId! }, include: { prospecto: true, versiones: true } });
    expect(quote.numero_cotizacion).toMatch(/^COT-\d{4}-\d{4}$/);
    expect(quote).toMatchObject({ prospecto_id: prospect.id, user_id: primary.id, organization_id: primary.organizationId });
    expect(quote.prospecto).toMatchObject({ telefono: '3111002000', email: 'cliente@example.test', tipo_acto: 'Compraventa', necesidad: 'Operación directa' });
    expect(quote.total_cliente?.toString()).toBe('1160');
    expect(quote.versiones).toHaveLength(1);
    expect(await db.documento.count({ where: { storage_key: document.storage_key } })).toBe(1);
    expect(await db.documento.count({ where: { id: document.id, prospecto_id: prospect.id } })).toBe(1);
    expect((await read(prospect.id)).stage).toBe('CONVERTIDO_EN_COTIZACION');
  });

  it('double click/retry con la misma clave produce exactamente una cotización', async () => {
    const prospect = await ready();
    const workflow = await read(prospect.id);
    const payload = { action: 'CONVERTIR', expectedVersion: workflow.version, confirm: true, idempotencyKey: randomUUID() };
    const [first, second] = await Promise.all([mutate(primary, prospect.id, payload), mutate(primary, prospect.id, payload)]);
    expect(first.quoteId).toBe(second.quoteId);
    expect(await db.cotizacion.count({ where: { prospecto_id: prospect.id } })).toBe(1);
    expect(await db.prospectoTransicion.count({ where: { prospecto_id: prospect.id, accion: 'CONVERTIR' } })).toBe(1);
  });

  it('dos pestañas/keys concurrentes y refresh/retry tampoco reconvierten', async () => {
    const prospect = await ready();
    const workflow = await read(prospect.id);
    const calls = [1, 2].map(() => mutate(primary, prospect.id, {
      action: 'CONVERTIR', expectedVersion: workflow.version, confirm: true, idempotencyKey: randomUUID(),
    }));
    const results = await Promise.allSettled(calls);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.cotizacion.count({ where: { prospecto_id: prospect.id } })).toBe(1);
    const reloaded = await read(prospect.id);
    expect(reloaded).toMatchObject({ stage: 'CONVERTIDO_EN_COTIZACION', actions: [], quote: { id: expect.any(String) } });
    await expect(act(prospect.id, 'CONVERTIR')).rejects.toMatchObject({ status: 409 });
    expect(await db.cotizacion.count({ where: { prospecto_id: prospect.id } })).toBe(1);
  });

  it('rollback de auditoría impide cotización, etapa y evento parcial', async () => {
    const prospect = await ready();
    failAudit = true;
    try { await expect(act(prospect.id, 'CONVERTIR')).rejects.toThrow('correction001-audit-failure'); }
    finally { failAudit = false; }
    expect(await db.cotizacion.count({ where: { prospecto_id: prospect.id } })).toBe(0);
    expect(await read(prospect.id)).toMatchObject({ stage: 'LISTO_PARA_COTIZAR', quote: null });
    expect(await db.prospectoTransicion.count({ where: { prospecto_id: prospect.id, accion: 'CONVERTIR' } })).toBe(0);
  });

  it('aplica RBAC, object access y aislamiento cross-tenant', async () => {
    const prospect = await create();
    const readonly = { ...primary, permissions: ['prospectos.read'] } as Actor;
    await expect(act(prospect.id, 'COMENZAR_INTEGRACION', readonly)).rejects.toMatchObject({ status: 403 });
    const outsider = { ...primary, id: randomUUID(), rol: 'ABOGADO', scope: 'ASSIGNED_OBJECTS' } as Actor;
    await expect(read(prospect.id, outsider)).rejects.toMatchObject({ status: 404 });
    await expect(read(prospect.id, foreign)).rejects.toMatchObject({ status: 404 });
    await expect(act(prospect.id, 'COMENZAR_INTEGRACION', foreign)).rejects.toMatchObject({ status: 404 });
  });

  it('la restricción DB mantiene una sola Cotización por Prospecto', async () => {
    const prospect = await ready();
    await act(prospect.id, 'CONVERTIR');
    await expect(db.cotizacion.create({ data: {
      organization_id: primary.organizationId, prospecto_id: prospect.id, user_id: primary.id,
      numero_cotizacion: `COT-9999-${new Date().getFullYear()}`,
    } })).rejects.toMatchObject({ code: 'P2002' });
    expect(await db.cotizacion.count({ where: { prospecto_id: prospect.id } })).toBe(1);
  });

  it('preserva registros legacy sólo como lectura histórica', async () => {
    const legacy = await db.$transaction(async (tx: any) => {
      const prospect = await tx.prospecto.create({ data: {
        organization_id: primary.organizationId, nombre: 'LEGACY', user_id: primary.id,
        estado: 'COTIZACION_SOLICITADA', prioridad: 'MEDIA', version_operativa: 0,
      } });
      const effectiveAt = new Date();
      const transition = await tx.prospectoTransicion.create({ data: {
        organization_id: primary.organizationId, prospecto_id: prospect.id, actor_id: primary.id,
        etapa_anterior: null, etapa_nueva: 'EN_ESPERA_COTIZACION', hito_intermedio: null,
        effective_at: effectiveAt, recorded_at: effectiveAt, accion: 'LEGACY_IMPORT',
        procedencia: 'MIGRACION_LEGACY', evidencia: { source: 'synthetic-local-test' },
        version: 1, idempotency_key: randomUUID(), payload_hash: '0'.repeat(64),
      } });
      await tx.prospecto.update({ where: { id: prospect.id }, data: {
        etapa_contractual: 'EN_ESPERA_COTIZACION', transicion_actual_id: transition.id, version_operativa: 1,
      } });
      return prospect;
    });
    const workflow = await read(legacy.id);
    expect(workflow).toMatchObject({ stage: 'EN_ESPERA_COTIZACION', actions: [], notaria: null });
    expect(workflow.wait).toMatchObject({ type: 'NOTARIA', label: expect.stringContaining('histórico') });
  });
});
