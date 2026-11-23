import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CotizacionWorkflowService } from '../services/cotizacionWorkflow.service';
import { ProspectWorkflowService } from '../services/prospectWorkflow.service';

const target = process.env.DIRECT_QUOTE_QA_DATABASE_URL;
if (target) {
  const u = new URL(target);
  if (u.hostname !== '127.0.0.1' || u.port !== '55521' || u.pathname !== '/pravia_client_qa' || u.searchParams.get('schema') !== 'pravia_os') throw Error('ISOLATED_DIRECT_QUOTE_DATABASE_REQUIRED');
}
const db = target ? new PrismaClient({ datasources: { db: { url: target } } }) : null;
let failAudit = false;
db?.$use(async (params, next) => { if (failAudit && params.model === 'AuditLog' && params.action === 'create') throw Error('QA_AUDIT_FAILURE'); return next(params); });
const org = randomUUID(), otherOrg = randomUUID();
const who = (organizationId = org) => ({ id: randomUUID(), organizationId, membershipId: randomUUID(), sessionId: randomUUID(), rol: 'ADMINISTRACION', scope: 'GLOBAL', permissions: ['cotizaciones.read', 'cotizaciones.write', 'prospectos.read', 'prospectos.write', 'comparecientes.read'] }) as NonNullable<Request['user']>;
const actor = who(), colleague = who(), foreign = who(otherOrg);
const service = () => new CotizacionWorkflowService(db!);
const payload = (key = randomUUID()) => ({ confirm: true, idempotencyKey: key, operationContext: 'SINTÉTICO QA ALTA DIRECTA' });
let quoteId = '';

describe.runIf(Boolean(target))('Actualización 4 · Cotización directa y Prospecto sin acto · PostgreSQL', () => {
  beforeAll(async () => {
    for (const id of [org, otherOrg]) await db!.organization.create({ data: { id, name: 'SINTÉTICO QA alta directa' } });
    for (const a of [actor, colleague, foreign]) {
      await db!.user.create({ data: { id: a.id, email: `direct-${a.id}@example.test`, nombre: 'QA', apellido: 'SINTÉTICO', rol: a.rol, password_hash: 'no-login-synthetic' } });
      await db!.organizationMembership.create({ data: { id: a.membershipId, user_id: a.id, organization_id: a.organizationId, rol: a.rol } });
    }
  });
  afterAll(async () => { await db?.$disconnect(); });
  it('crea borrador canónico con responsable, folio e historial sin crear Prospecto, presupuesto o pago', async () => {
    const q = await service().createDirect(actor, payload()); quoteId = q.id;
    expect(q).toMatchObject({ prospecto_id: null, user_id: actor.id, etapa_contractual: 'BORRADOR', version_operativa: 1 });
    expect(q.numero_cotizacion).toMatch(/^COT-\d{4,}-\d{4}$/);
    expect(await db!.prospecto.count({ where: { organization_id: org } })).toBe(0);
    expect(await db!.cotizacionConcepto.count({ where: { cotizacion_id: q.id } })).toBe(0);
    expect(await db!.pago.count({ where: { cotizacion_id: q.id } })).toBe(0);
    expect(await db!.cotizacionTransicion.findFirst({ where: { cotizacion_id: q.id } })).toMatchObject({ accion: 'CREAR', procedencia: 'ALTA_DIRECTA', actor_id: actor.id, evidencia: { origin: 'DIRECT', prospectId: null } });
    expect(await db!.auditLog.count({ where: { entidad_id: q.id, accion: 'COT001_CREAR' } })).toBe(1);
    expect((await service().read(actor, q.id)).events[0].actionLabel).toBe('Cotización creada directamente');
  });
  it('doble llamada concurrente y retry crean exactamente una cotización y un evento', async () => {
    const input = payload(); const results = await Promise.all([service().createDirect(actor, input), service().createDirect(actor, input)]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1); expect(results.filter((r) => r.idempotent)).toHaveLength(1);
    expect((await service().createDirect(actor, input)).id).toBe(results[0].id);
    expect(await db!.cotizacionTransicion.count({ where: { cotizacion_id: results[0].id } })).toBe(1);
    await expect(service().createDirect(actor, { ...input, operationContext: 'DATOS CAMBIADOS' })).rejects.toMatchObject({ code: 'COT001_KEY_REUSED' });
  });
  it('dos usuarios y otro tenant mantienen numeración canónica sin colisiones', async () => {
    const rows = await Promise.all([service().createDirect(actor, payload()), service().createDirect(colleague, payload()), service().createDirect(foreign, payload())]);
    expect(rows[0].numero_cotizacion).not.toBe(rows[1].numero_cotizacion); expect(rows[2].organization_id).toBe(otherOrg);
    expect(await db!.folioCounter.count({ where: { kind: 'COT', organization_id: { in: [org, otherOrg] } } })).toBe(2);
  });
  it('rechaza permisos, responsable inactivo y campos de privilegio sin crear nada', async () => {
    const before = await db!.cotizacion.count({ where: { organization_id: org } });
    await expect(service().createDirect({ ...actor, permissions: [] }, payload())).rejects.toMatchObject({ status: 403 });
    await expect(service().createDirect(actor, { ...payload(), user_id: colleague.id })).rejects.toMatchObject({ code: 'COT001_FIELDS_DENIED' });
    await db!.organizationMembership.update({ where: { id: colleague.membershipId }, data: { status: 'SUSPENDED' } });
    await expect(service().createDirect(colleague, payload())).rejects.toMatchObject({ code: 'COT001_RESPONSIBLE_REQUIRED' });
    await db!.organizationMembership.update({ where: { id: colleague.membershipId }, data: { status: 'ACTIVE' } });
    expect(await db!.cotizacion.count({ where: { organization_id: org } })).toBe(before);
  });
  it('no acepta un compareciente de otra organización', async () => {
    const party = await db!.compareciente.create({ data: { organization_id: otherOrg, creado_por_id: foreign.id, tipo_persona: 'FISICA', nombre_busqueda: 'QA FUERA DEL TENANT' } });
    await expect(service().createDirect(actor, { ...payload(), formalApplicantId: party.id })).rejects.toMatchObject({ code: 'COT001_APPLICANT_NOT_FOUND' });
  });
  it('fallo de auditoría revierte cotización, historial y contador', async () => {
    const before = await db!.cotizacion.count({ where: { organization_id: org } });
    const counter = await db!.folioCounter.findFirstOrThrow({ where: { organization_id: org, kind: 'COT' } });
    failAudit = true;
    try { await expect(service().createDirect(actor, payload())).rejects.toThrow('QA_AUDIT_FAILURE'); } finally { failAudit = false; }
    expect(await db!.cotizacion.count({ where: { organization_id: org } })).toBe(before);
    expect((await db!.folioCounter.findUniqueOrThrow({ where: { organization_id_kind_series_year: { organization_id: org, kind: counter.kind, series: counter.series, year: counter.year } } })).last_value).toBe(counter.last_value);
  });
  it('un borrador directo continúa mediante el mismo motor contractual', async () => {
    await service().act(actor, quoteId, { action: 'COMENZAR_ELABORACION', expectedVersion: 1, idempotencyKey: randomUUID(), confirm: true, effectiveAt: new Date().toISOString() });
    expect((await service().read(actor, quoteId)).stage).toBe('EN_ELABORACION');
    await expect(service().read(foreign, quoteId)).rejects.toMatchObject({ code: 'COT001_NOT_FOUND' });
  });
  it('PostgreSQL sigue rechazando cotizaciones canónicas huérfanas sin evento de alta directa', async () => {
    await expect(db!.cotizacion.create({ data: { organization_id: org, user_id: actor.id, estado: 'BORRADOR', etapa_contractual: 'BORRADOR' } })).rejects.toThrow();
  });
  it('Prospecto conserva el selector, pero puede marcarse listo y convertirse sin acto preliminar', async () => {
    const p = new ProspectWorkflowService(db!);
    const created = await p.create(actor, { nombre: 'SINTÉTICO SIN ACTO' }, randomUUID());
    const id = created.prospecto.id;
    for (const action of ['COMENZAR_INTEGRACION', 'MARCAR_LISTO_PARA_COTIZAR', 'CONVERTIR']) {
      const current = await p.read(actor, id);
      await p.act(actor, id, { action, expectedVersion: current.version, confirm: true, idempotencyKey: randomUUID(), ...(action === 'MARCAR_LISTO_PARA_COTIZAR' ? { quoteAssigneeId: actor.id } : {}) });
    }
    const q = await db!.cotizacion.findUniqueOrThrow({ where: { prospecto_id: id }, include: { actos: true } });
    expect(q.etapa_contractual).toBe('BORRADOR'); expect(q.actos).toHaveLength(0);
    expect(await db!.cotizacionTransicion.findFirst({ where: { cotizacion_id: q.id } })).toMatchObject({ procedencia: 'CONVERSION_PRO001' });
  });
});
