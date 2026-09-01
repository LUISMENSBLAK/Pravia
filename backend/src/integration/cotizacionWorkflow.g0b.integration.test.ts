import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithActorContext } from '../auth/actorContext';
import { tenantIsolationMiddleware } from '../config/tenantPrisma';
import { evaluateConversionEligibility } from '../domain/cotizacionWorkflow';
import { CotizacionWorkflowService } from '../services/cotizacionWorkflow.service';
import { CotizacionConversionService } from '../services/cotizacionConversion.service';
import { ProspectWorkflowService } from '../services/prospectWorkflow.service';

const url = process.env.G0B_DATABASE_URL || 'postgresql://postgres:test@127.0.0.1:55442/pravia_g0a?schema=pravia_os';
const db = new PrismaClient({ datasources: { db: { url } } });
const scoped = new PrismaClient({ datasources: { db: { url } } });
scoped.$use(tenantIsolationMiddleware);
let failQuoteAudit = false;
scoped.$use(async (params, next) => {
  if (failQuoteAudit && params.model === 'AuditLog' && params.action === 'create') throw new Error('test-quote-audit-failure');
  return next(params);
});
const prospects = new ProspectWorkflowService(scoped, async () => true);
const quotes = new CotizacionWorkflowService(scoped);
const conversions = new CotizacionConversionService(scoped);
type Actor = NonNullable<Request['user']>;
const actor = (n: number): Actor => ({
  id: `20000000-0000-4000-8000-00000000000${n}`,
  organizationId: `10000000-0000-4000-8000-00000000000${n}`,
  membershipId: `30000000-0000-4000-8000-00000000000${n}`,
  sessionId: randomUUID(), rol: 'ADMINISTRACION', nombre: 'Prueba', apellido: String(n),
  email: `g0b-${n}@example.test`, scope: 'GLOBAL', requiresPasswordChange: false,
  permissions: ['prospectos.read','prospectos.write','documentos.read','documentos.write','cotizaciones.read','cotizaciones.write','notarias.read','expedientes.read','expedientes.write'],
});
const a = actor(1), b = actor(2);
const run = <T>(who: Actor, fn: () => T) => runWithActorContext({ userId: who.id, organizationId: who.organizationId,
  membershipId: who.membershipId, sessionId: who.sessionId, role: who.rol, permissions: who.permissions, scope: who.scope }, fn);
const actProspect = async (who: Actor, id: string, action: string, extra: Record<string, unknown> = {}) => {
  const current = await db.prospecto.findUniqueOrThrow({ where: { id } });
  return run(who, () => prospects.act(who, id, { action, expectedVersion: current.version_operativa, confirm: true, idempotencyKey: randomUUID(), ...extra }));
};
const canonicalQuote = async (who = a) => {
  const created = await run(who, () => prospects.create(who, { nombre: `COT G0B ${randomUUID()}` }, randomUUID()));
  await run(who, () => prospects.update(who, created.prospecto.id, { expectedVersion: created.prospecto.version_operativa, notaria_id: `40000000-0000-4000-8000-00000000000${who === b ? 2 : 1}` }));
  await actProspect(who, created.prospecto.id, 'MARCAR_LISTO');
  await actProspect(who, created.prospecto.id, 'REGISTRAR_ENVIO', { effectiveAt: new Date().toISOString(), channel: 'Correo', recipient: 'notaria@example.test', evidence: 'Confirmado', content: 'Solicitud revisada', attachmentIds: [] });
  const doc = await db.documento.create({ data: { organization_id: who.organizationId, prospecto_id: created.prospecto.id, subido_por_id: who.id,
    tipo: 'PRESUPUESTO_NOTARIA', nombre_original: 'Fuente notarial.pdf', nombre_interno: randomUUID(), storage_key: `organizations/${who.organizationId}/documentos/${randomUUID()}`, mime_type: 'application/pdf', size_bytes: 100 } });
  await actProspect(who, created.prospecto.id, 'REGISTRAR_RECEPCION', { documentId: doc.id, effectiveAt: new Date().toISOString() });
  const result = await actProspect(who, created.prospecto.id, 'CONVERTIR');
  const quote = await db.cotizacion.findUniqueOrThrow({ where: { id: result.quoteId! } });
  await db.cotizacionVersion.create({ data: { organization_id: who.organizationId, cotizacion_id: quote.id, version: 1, total_cliente: 100,
    total_notaria: 100, honorarios_pravia: 10, desglose_notaria: {}, desglose_pravia: {}, aprobada: true, creada_por_id: who.id } });
  return quote.id;
};
const actQuote = async (id: string, action: string, extra: Record<string, unknown> = {}, who = a, key = randomUUID()) => {
  const quote = await db.cotizacion.findUniqueOrThrow({ where: { id } });
  return run(who, () => quotes.act(who, id, { action, expectedVersion: quote.version_operativa, confirm: true, idempotencyKey: key,
    effectiveAt: new Date().toISOString(), ...extra }));
};
const acceptedQuote = async (who = a) => {
  const id = await canonicalQuote(who);
  await actQuote(id, 'ENVIAR_CLIENTE', { channel: 'Correo', recipient: 'cliente@example.test', evidence: 'Confirmado' }, who);
  await actQuote(id, 'REGISTRAR_ACEPTACION_ANTICIPO', {}, who);
  return id;
};
describe.runIf(process.env.G0B_RUN_ISOLATED === '1')('G0-B PostgreSQL aislado · COT-001', () => {
  beforeAll(async () => {
    const [database] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(database.name).toBe('pravia_g0a');
  });
  afterAll(async () => { await Promise.all([db.$disconnect(), scoped.$disconnect()]); });

  it('baseline → latest conserva conteos, enlaces y deja todo legacy UNKNOWN', async () => {
    const before = await db.$queryRaw<Array<{ entity: string; count: bigint }>>`SELECT entity,count FROM public.g0b_counts_before ORDER BY entity`;
    const tables: Record<string, string> = { cotizaciones: 'cotizaciones', prospectos: 'prospectos', cotizacion_versiones: 'cotizacion_versiones', pagos: 'pagos', documentos: 'documentos', expedientes: 'expedientes', organizations: 'organizations' };
    for (const row of before) {
      const table = tables[row.entity];
      expect(table).toBeDefined();
      const [current] = await db.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) count FROM pravia_os.${table}`);
      expect(Number(current.count)).toBe(Number(row.count));
    }
    const legacy = await db.$queryRaw<Array<{ etapa_contractual: string | null; transicion_actual_id: string | null; version_operativa: number }>>`
      SELECT etapa_contractual::text, transicion_actual_id, version_operativa
      FROM pravia_os.cotizaciones
      WHERE id::text LIKE '90000000-%'
    `;
    expect(legacy).toHaveLength(10);
    expect(legacy.every((quote) => quote.etapa_contractual === null && quote.transicion_actual_id === null && quote.version_operativa === 0)).toBe(true);
    const beforeRows = await db.$queryRaw<Array<{ id: string; row: Record<string, unknown> }>>`SELECT id,row FROM public.g0b_quotes_before`;
    for (const item of beforeRows) {
      const [current] = await db.$queryRaw<Array<{ row: Record<string, unknown> }>>`SELECT to_jsonb(q) - ARRAY['etapa_contractual','version_operativa','transicion_actual_id'] AS row FROM pravia_os.cotizaciones q WHERE id=${item.id}::uuid`;
      expect(current.row).toMatchObject(item.row);
    }
  });
  it('nace desde Prospecto/fuente en Borrador con un hecho y audit atómicos', async () => {
    const id = await canonicalQuote(); const workflow = await run(a, () => quotes.read(a, id));
    expect(workflow).toMatchObject({ stage: 'BORRADOR', knowledge: 'KNOWN', version: 1 });
    expect(workflow.events).toHaveLength(1); expect(workflow.events[0].action).toBe('CREAR');
    expect(await db.auditLog.count({ where: { organization_id: a.organizationId, entidad_id: id, accion: 'COT001_CREAR' } })).toBe(1);
  });
  it('envío y retry crean un hito; el reenvío conserva la primera fecha', async () => {
    const id = await canonicalQuote(); const key = randomUUID();
    const initial = await db.cotizacion.findUniqueOrThrow({ where: { id } });
    const payload = { action: 'ENVIAR_CLIENTE', expectedVersion: initial.version_operativa, confirm: true, idempotencyKey: key,
      effectiveAt: new Date().toISOString(), channel: 'Correo', recipient: 'cliente@example.test', evidence: 'Outlook 10:00' };
    const first = await run(a, () => quotes.act(a, id, payload));
    const retry = await run(a, () => quotes.act(a, id, payload));
    expect(retry).toMatchObject({ idempotent: true, eventId: first.eventId });
    const firstDate = (await run(a, () => quotes.read(a, id))).firstSentAt;
    await actQuote(id, 'REENVIAR_CLIENTE', { channel: 'WhatsApp', recipient: '+5210000000000', evidence: 'Mensaje confirmado' });
    const after = await run(a, () => quotes.read(a, id));
    expect(after.firstSentAt).toEqual(firstDate); expect(after.lastSentAt).not.toBeNull();
    expect(await db.cotizacionTransicion.count({ where: { cotizacion_id: id, accion: 'ENVIAR_CLIENTE' } })).toBe(1);
  });
  it('Aceptó / Anticipo es un solo hito y no crea finanzas', async () => {
    const id = await canonicalQuote(); await actQuote(id, 'ENVIAR_CLIENTE', { channel: 'Correo', recipient: 'cliente@example.test', evidence: 'Confirmado' });
    await actQuote(id, 'REGISTRAR_ACEPTACION_ANTICIPO');
    const quote = await db.cotizacion.findUniqueOrThrow({ where: { id }, include: { versiones: true, pagos: true, expediente: true } });
    const eligibility = evaluateConversionEligibility(quote);
    expect(quote.etapa_contractual).toBe('ACEPTO_ANTICIPO'); expect(quote.pagos).toHaveLength(0);
    expect(eligibility).toMatchObject({ eligible: true, validatedAdvance: false });
    expect(await db.movimientoFinanciero.count({ where: { cotizacion_id: id } })).toBe(0);
  });
  it.each([['SUSPENDER','SUSPENDIDA'],['CANCELAR','CANCELADA']] as const)('%s conserva documentos y fuente', async (action, stage) => {
    const id = await canonicalQuote(); const before = await db.cotizacionDocumento.count({ where: { cotizacion_id: id } });
    await actQuote(id, action); const quote = await db.cotizacion.findUniqueOrThrow({ where: { id } });
    expect(quote.etapa_contractual).toBe(stage); expect(await db.cotizacionDocumento.count({ where: { cotizacion_id: id } })).toBe(before);
    expect(quote.fuente_notarial_id).not.toBeNull();
  });
  it('dos pestañas Enviar/Cancelar dan un ganador determinista', async () => {
    const id = await canonicalQuote(); const quote = await db.cotizacion.findUniqueOrThrow({ where: { id } });
    const base = { expectedVersion: quote.version_operativa, confirm: true, effectiveAt: new Date().toISOString() };
    const results = await Promise.allSettled([
      run(a, () => quotes.act(a, id, { ...base, action: 'ENVIAR_CLIENTE', idempotencyKey: randomUUID(), channel: 'Correo', recipient: 'cliente@example.test', evidence: 'Confirmado' })),
      run(a, () => quotes.act(a, id, { ...base, action: 'CANCELAR', idempotencyKey: randomUUID() })),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.cotizacionTransicion.count({ where: { cotizacion_id: id } })).toBe(2);
  });
  it.each([
    ['REGISTRAR_ACEPTACION_ANTICIPO', 'CANCELAR'],
    ['REGISTRAR_ACEPTACION_ANTICIPO', 'SUSPENDER'],
  ] as const)('dos pestañas %s/%s conservan un único ganador', async (left, right) => {
    const id = await canonicalQuote();
    await actQuote(id, 'ENVIAR_CLIENTE', { channel: 'Correo', recipient: 'cliente@example.test', evidence: 'Confirmado' });
    const quote = await db.cotizacion.findUniqueOrThrow({ where: { id } });
    const base = { expectedVersion: quote.version_operativa, confirm: true, effectiveAt: new Date().toISOString() };
    const results = await Promise.allSettled([
      run(a, () => quotes.act(a, id, { ...base, action: left, idempotencyKey: randomUUID() })),
      run(a, () => quotes.act(a, id, { ...base, action: right, idempotencyKey: randomUUID() })),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.cotizacionTransicion.count({ where: { cotizacion_id: id, accion: 'REGISTRAR_ACEPTACION_ANTICIPO' } })).toBeLessThanOrEqual(1);
  });
  it('doble aceptación concurrente persiste un solo hito', async () => {
    const id = await canonicalQuote();
    await actQuote(id, 'ENVIAR_CLIENTE', { channel: 'Correo', recipient: 'cliente@example.test', evidence: 'Confirmado' });
    const quote = await db.cotizacion.findUniqueOrThrow({ where: { id } });
    const base = { action: 'REGISTRAR_ACEPTACION_ANTICIPO', expectedVersion: quote.version_operativa, confirm: true, effectiveAt: new Date().toISOString() };
    const results = await Promise.allSettled([
      run(a, () => quotes.act(a, id, { ...base, idempotencyKey: randomUUID() })),
      run(a, () => quotes.act(a, id, { ...base, idempotencyKey: randomUUID() })),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.cotizacionTransicion.count({ where: { cotizacion_id: id, accion: 'REGISTRAR_ACEPTACION_ANTICIPO' } })).toBe(1);
  });
  it('dos conversiones PostgreSQL concurrentes crean exactamente un expediente', async () => {
    const id = await acceptedQuote();
    const quote = await db.cotizacion.findUniqueOrThrow({ where: { id } });
    const type = await db.tipoActo.findFirstOrThrow({ where: { activo: true } });
    const request = (key: string) => run(a, () => conversions.convert({
      cotizacionId: id, actorUserId: a.id, actorOrganizationId: a.organizationId,
      actorSessionId: a.sessionId, actor: a, expectedVersion: quote.version_operativa,
      idempotencyKey: key, confirm: true, effectiveAt: new Date().toISOString(), tipoActoId: type.id,
    }));
    const results = await Promise.all([request(randomUUID()), request(randomUUID())]);
    expect(results.filter((result) => !result.alreadyConverted)).toHaveLength(1);
    expect(results.filter((result) => result.alreadyConverted)).toHaveLength(1);
    expect(await db.expediente.count({ where: { cotizacion_id: id } })).toBe(1);
    expect(await db.cotizacionTransicion.count({ where: { cotizacion_id: id, accion: 'CONVERTIR' } })).toBe(1);
  });
  it('la proyección no permite saltar el servicio canónico por escritura directa', async () => {
    const id = await canonicalQuote();
    await expect(db.$executeRaw(Prisma.sql`
      UPDATE pravia_os.cotizaciones
      SET etapa_contractual = 'ACEPTO_ANTICIPO', estado = 'ACEPTADA'
      WHERE id = ${id}::uuid
    `)).rejects.toThrow();
    expect(await run(a, () => quotes.read(a, id))).toMatchObject({ stage: 'BORRADOR', version: 1 });
  });
  it('edición stale no borra el hito comercial', async () => {
    const id = await canonicalQuote(); const stale = await db.cotizacion.findUniqueOrThrow({ where: { id } });
    await actQuote(id, 'ENVIAR_CLIENTE', { channel: 'Correo', recipient: 'cliente@example.test', evidence: 'Confirmado' });
    await expect(run(a, () => quotes.act(a, id, { action: 'CANCELAR', expectedVersion: stale.version_operativa, confirm: true,
      idempotencyKey: randomUUID(), effectiveAt: new Date().toISOString() }))).rejects.toMatchObject({ code: 'COT001_STALE_VERSION' });
    expect((await db.cotizacion.findUniqueOrThrow({ where: { id } })).etapa_contractual).toBe('ENVIADA_CLIENTE');
  });
  it('fallo de auditoría revierte estado, fecha y evento', async () => {
    const id = await canonicalQuote(); failQuoteAudit = true;
    try { await expect(actQuote(id, 'ENVIAR_CLIENTE', { channel: 'Correo', recipient: 'cliente@example.test', evidence: 'Confirmado' })).rejects.toThrow('test-quote-audit-failure'); }
    finally { failQuoteAudit = false; }
    const quote = await db.cotizacion.findUniqueOrThrow({ where: { id } });
    expect(quote).toMatchObject({ etapa_contractual: 'BORRADOR', fecha_enviada_cliente: null, version_operativa: 1 });
    expect(await db.cotizacionTransicion.count({ where: { cotizacion_id: id } })).toBe(1);
  });
  it('tenant A no lee ni actúa sobre quote B con ID válido', async () => {
    const id = await canonicalQuote(b);
    await expect(run(a, () => quotes.read(a, id))).rejects.toMatchObject({ status: 404 });
    await expect(actQuote(id, 'CANCELAR', {}, a)).rejects.toMatchObject({ status: 404 });
  });
  it('la base rechaza relaciones cruzadas con IDs válidos de prospecto, fuente, documento, pago y expediente', async () => {
    const quoteA = await canonicalQuote(a);
    const quoteB = await canonicalQuote(b);
    const foreign = await db.cotizacion.findUniqueOrThrow({ where: { id: quoteB }, include: { documentos: true } });
    expect(foreign.prospecto_id).toBeTruthy();
    expect(foreign.fuente_notarial_id).toBeTruthy();
    const foreignDocument = await db.cotizacionDocumento.findFirstOrThrow({ where: { cotizacion_id: quoteB } });
    await expect(db.cotizacion.update({ where: { id: quoteA }, data: { prospecto_id: foreign.prospecto_id } })).rejects.toThrow();
    await expect(db.cotizacion.update({ where: { id: quoteA }, data: { fuente_notarial_id: foreign.fuente_notarial_id } })).rejects.toThrow();
    await expect(db.cotizacionDocumento.create({ data: {
      organization_id: a.organizationId, cotizacion_id: quoteA, documento_id: foreignDocument.documento_id,
      tipo_vinculo: 'COTIZACION_NOTARIA', creado_por_id: a.id, estatus: 'ACTIVO',
    } })).rejects.toThrow();
    const foreignPayment = await db.pago.findFirstOrThrow({ where: { cotizacion_id: '90000000-0000-4000-8000-000000000010' } });
    await expect(db.pago.update({ where: { id: foreignPayment.id }, data: { cotizacion_id: quoteA } })).rejects.toThrow();
    const foreignCase = await db.expediente.findUniqueOrThrow({ where: { id: 'a0000000-0000-4000-8000-000000000001' } });
    await expect(db.expediente.update({ where: { id: foreignCase.id }, data: { cotizacion_id: quoteA } })).rejects.toThrow();
  });
  it('eventos son append-only incluso por escritura SQL directa', async () => {
    const id = await canonicalQuote(); const event = await db.cotizacionTransicion.findFirstOrThrow({ where: { cotizacion_id: id } });
    await expect(db.cotizacionTransicion.update({ where: { id: event.id }, data: { causa: 'manipulado' } })).rejects.toThrow();
    await expect(db.cotizacionTransicion.delete({ where: { id: event.id } })).rejects.toThrow();
  });
});
