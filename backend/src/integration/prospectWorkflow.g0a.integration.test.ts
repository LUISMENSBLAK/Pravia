import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { ProspectWorkflowService } from '../services/prospectWorkflow.service';
import { ProspectDocumentReviewService } from '../services/prospectDocumentReview.service';
import { CotizacionWorkflowService } from '../services/cotizacionWorkflow.service';
import { CotizacionConversionService } from '../services/cotizacionConversion.service';
import { ExpedienteBudgetService } from '../services/expedienteBudget.service';
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
  permissions: ['prospectos.read', 'prospectos.write', 'documentos.read', 'documentos.write', 'documentos.unlink', 'cotizaciones.read', 'cotizaciones.write', 'expedientes.read', 'expedientes.write', 'finanzas.read', 'finanzas.write', 'ia.execute'],
});
const primary = actor(1);
const foreign = actor(2);
let formalApplicantId = '';
let primaryActTypeId = '';
let secondaryActTypeId = '';
let quoteWorkerId = '';
const quoteWorkflow = new CotizacionWorkflowService(scoped);
const quoteConversion = new CotizacionConversionService(scoped);
const expedienteBudget = new ExpedienteBudgetService(scoped);
const run = <T>(who: Actor, fn: () => T) => runWithActorContext({
  userId: who.id, organizationId: who.organizationId, membershipId: who.membershipId,
  sessionId: who.sessionId, role: who.rol, permissions: who.permissions, scope: who.scope,
}, fn);
const create = (who = primary, key = randomUUID(), nombre = '  cliente   corrección 001 ') =>
  run(who, () => service.create(who, { nombre, servicio_catalogo_codigo: 'COMPRAVENTA', tipo_acto_ids: [primaryActTypeId] }, key)).then((result) => result.prospecto);
const read = (id: string, who = primary) => run(who, () => service.read(who, id));
const mutate = (who: Actor, id: string, payload: Record<string, unknown>) => run(who, () => service.act(who, id, payload));
const act = async (id: string, action: string, who = primary, extra: Record<string, unknown> = {}) => {
  const current = await read(id, who);
  return mutate(who, id, { action, expectedVersion: current.version, confirm: true, idempotencyKey: randomUUID(),
    ...(action === 'MARCAR_LISTO_PARA_COTIZAR' ? { quoteAssigneeId: who.id } : {}), ...extra });
};
const ready = async (who = primary) => {
  const prospect = await create(who);
  await act(prospect.id, 'COMENZAR_INTEGRACION', who);
  await act(prospect.id, 'MARCAR_LISTO_PARA_COTIZAR', who);
  return prospect;
};
const actQuote = async (id: string, action: string, extra: Record<string, unknown> = {}) => {
  const current = await run(primary, () => quoteWorkflow.read(primary, id));
  return run(primary, () => quoteWorkflow.act(primary, id, {
    action,
    expectedVersion: current.version,
    confirm: true,
    idempotencyKey: randomUUID(),
    effectiveAt: new Date().toISOString(),
    ...extra,
  }));
};

describe.runIf(process.env.CORRECTION001_RUN_ISOLATED === '1')('Corrección 001 · PostgreSQL aislado Prospecto → Cotización', () => {
  beforeAll(async () => {
    const [database] = await db.$queryRaw`SELECT current_database() AS name`;
    expect(database.name).toMatch(/^pravia_c(?:001|015)_/);
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
    quoteWorkerId = randomUUID();
    await db.user.create({ data: { id: quoteWorkerId, email: `quote-worker-${quoteWorkerId}@example.test`,
      password_hash: 'synthetic-not-a-login', nombre: 'Recepción', apellido: 'Cotizaciones', rol: 'RECEPCION', activo: true,
      requires_password_change: false } });
    await db.organizationMembership.create({ data: { organization_id: primary.organizationId, user_id: quoteWorkerId,
      rol: 'RECEPCION', status: 'ACTIVE' } });
    const actType = await db.tipoActo.upsert({
      where: { codigo_catalogo: 'COMPRAVENTA' },
      update: { activo: true, archived_at: null },
      create: { codigo_catalogo: 'COMPRAVENTA', nombre: 'Compraventa', activo: true },
    });
    primaryActTypeId = actType.id;
    const secondaryActType = await db.tipoActo.upsert({
      where: { codigo_catalogo: 'PODER_GENERAL_QA_C015' },
      update: { activo: true, archived_at: null },
      create: { codigo_catalogo: 'PODER_GENERAL_QA_C015', nombre: 'Poder general', activo: true },
    });
    secondaryActTypeId = secondaryActType.id;
    const character = await db.caracterCompareciente.upsert({
      where: { clave: 'SOLICITANTE_PRINCIPAL_QA_C015' },
      update: { activo: true },
      create: { clave: 'SOLICITANTE_PRINCIPAL_QA_C015', nombre: 'Solicitante principal', activo: true },
    });
    for (const tipoActoId of [primaryActTypeId, secondaryActTypeId]) {
      await db.tipoActoCaracterCompareciente.upsert({
        where: { tipo_acto_id_caracter_id: { tipo_acto_id: tipoActoId, caracter_id: character.id } },
        update: { sugerido: true },
        create: { tipo_acto_id: tipoActoId, caracter_id: character.id, sugerido: true, orden: 0 },
      });
    }
    await db.prospectoServicioCatalogo.upsert({
      where: { codigo: 'COMPRAVENTA' },
      update: { tipo_acto_id: actType.id },
      create: {
        codigo: 'COMPRAVENTA', label: 'Compraventa', orden: 1, activo: true,
        estados: ['Nayarit', 'Jalisco'], tipos_persona: [], tipo_acto_id: actType.id,
      },
    });
    const applicant = await db.compareciente.create({ data: {
      organization_id: primary.organizationId,
      tipo_persona: 'FISICA',
      nombre_busqueda: `SOLICITANTE FORMAL ${randomUUID()}`,
      creado_por_id: primary.id,
    } });
    formalApplicantId = applicant.id;
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

  it('exige responsable de cotización autorizado y distinto del responsable del prospecto', async () => {
    const prospect = await create();
    await act(prospect.id, 'COMENZAR_INTEGRACION');
    const current = await read(prospect.id);
    expect(current.quoteAssignees.map((member) => member.id)).toContain(quoteWorkerId);
    await expect(mutate(primary, prospect.id, { action: 'MARCAR_LISTO_PARA_COTIZAR',
      expectedVersion: current.version, confirm: true, idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ status: 400, code: 'PRO001_QUOTE_ASSIGNEE_REQUIRED' });
    await expect(act(prospect.id, 'MARCAR_LISTO_PARA_COTIZAR', primary, { quoteAssigneeId: foreign.id }))
      .rejects.toMatchObject({ status: 400, code: 'PRO001_QUOTE_ASSIGNEE_INVALID' });
    await act(prospect.id, 'MARCAR_LISTO_PARA_COTIZAR', primary, { quoteAssigneeId: quoteWorkerId });
    const readyWorkflow = await read(prospect.id);
    expect(readyWorkflow.quoteAssignee?.id).toBe(quoteWorkerId);
    expect((await db.prospecto.findUniqueOrThrow({ where: { id: prospect.id } })).cotizacion_responsable_id).toBe(quoteWorkerId);
    expect(readyWorkflow.events.at(-1)?.id).toBeTruthy();
    await expect(act(prospect.id, 'CONVERTIR', primary, { quoteAssigneeId: primary.id }))
      .rejects.toMatchObject({ status: 409, code: 'PRO001_QUOTE_ASSIGNEE_MISMATCH' });
    expect(await db.cotizacion.count({ where: { prospecto_id: prospect.id } })).toBe(0);
    const conversion = await act(prospect.id, 'CONVERTIR');
    const quote = await db.cotizacion.findUniqueOrThrow({ where: { id: conversion.quoteId! } });
    expect(quote.user_id).toBe(quoteWorkerId);
    expect(quote.prospecto_id).toBe(prospect.id);
  });

  it('guarda revisión documental preliminar con fuentes verificables y la invalida al cambiar documentos', async () => {
    const prospect = await create();
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'isolated-synthetic-provider-key';
    const document = await db.documento.create({ data: {
      organization_id: primary.organizationId, nombre_original: 'antecedente.txt', nombre_interno: `${randomUUID()}-antecedente.txt`,
      storage_key: `qa/prospect-review/${randomUUID()}`, tipo: 'ANTECEDENTE', categoria: 'PROYECTO', mime_type: 'text/plain',
      size_bytes: 30, checksum_sha256: 'synthetic-antecedent', estatus: 'VIGENTE', subido_por_id: primary.id, prospecto_id: prospect.id,
    } });
    const reviewService = new ProspectDocumentReviewService(scoped,
      async () => Buffer.from('Titular documentado: Persona A'),
      async (input) => ({ summary: 'Revisión preliminar: titular identificable en la fuente.',
        findings: [{ detail: 'Verificar titular con documentación complementaria.', document_ids: [input.documents[0].id] }],
        model: 'qa-provider', usage: { modelo: 'qa-provider', input_tokens: 4, cached_input_tokens: 0,
          output_tokens: 4, reasoning_tokens: 0, total_tokens: 8, duracion_ms: 1, documentos_enviados: 1,
          costo_estimado_usd: 0, precios_version: 'provider-usage-only-test', escalamiento_utilizado: false } }));
    try {
      const before = await run(primary, () => reviewService.latest(primary, prospect.id));
      expect(before).toMatchObject({ available: true, current: false, review: null });
      const saved = await run(primary, () => reviewService.run(primary, prospect.id));
      expect(saved).toMatchObject({ current: true, review: { findings: [{ document_ids: [document.id] }] } });
      expect(await run(primary, () => reviewService.latest(primary, prospect.id))).toMatchObject({ current: true });
      expect(await db.prospectoRevisionDocumental.count({ where: { prospecto_id: prospect.id } })).toBe(1);
      expect(await db.auditLog.count({ where: { entidad: 'Prospecto', entidad_id: prospect.id, accion: 'PROSPECT_DOCUMENT_REVIEW_AI' } })).toBe(1);
      await expect(run(foreign, () => reviewService.latest(foreign, prospect.id))).rejects.toMatchObject({ status: 404 });
      await expect(run(foreign, () => reviewService.run(foreign, prospect.id))).rejects.toMatchObject({ status: 404 });
      await db.documento.create({ data: { organization_id: primary.organizationId, nombre_original: 'predial.txt',
        nombre_interno: `${randomUUID()}-predial.txt`, storage_key: `qa/prospect-review/${randomUUID()}`,
        tipo: 'PREDIAL', categoria: 'PROYECTO', mime_type: 'text/plain', size_bytes: 20,
        checksum_sha256: 'synthetic-predial', estatus: 'VIGENTE', subido_por_id: primary.id, prospecto_id: prospect.id } });
      expect(await run(primary, () => reviewService.latest(primary, prospect.id))).toMatchObject({ current: false });
    } finally {
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
    }
  });

  it('no presenta un .doc antiguo como revisión IA exitosa', async () => {
    const prospect = await create();
    await db.documento.create({ data: { organization_id: primary.organizationId, nombre_original: 'acta-antigua.doc',
      nombre_interno: `${randomUUID()}-acta-antigua.doc`, storage_key: `qa/prospect-review/${randomUUID()}`,
      tipo: 'INICIAL', categoria: 'PROYECTO', mime_type: 'application/msword', size_bytes: 100,
      estatus: 'VIGENTE', subido_por_id: primary.id, prospecto_id: prospect.id } });
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'isolated-synthetic-provider-key';
    try {
      const reviewService = new ProspectDocumentReviewService(scoped, async () => Buffer.from('legacy'),
        async () => { throw new Error('Provider must not run without readable documents'); });
      expect(await run(primary, () => reviewService.latest(primary, prospect.id))).toMatchObject({
        available: false, requiresManualReview: [{ name: 'acta-antigua.doc' }],
      });
      await expect(run(primary, () => reviewService.run(primary, prospect.id)))
        .rejects.toMatchObject({ status: 422, code: 'PROSPECT_REVIEW_NO_READABLE_SOURCE' });
      expect(await db.prospectoRevisionDocumental.count({ where: { prospecto_id: prospect.id } })).toBe(0);
    } finally {
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
    }
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
    await act(prospect.id, action, primary, { reason: 'Pausa operativa solicitada' });
    expect((await read(prospect.id)).stage).toBe(stage);
  });

  it.each(['SUSPENDER', 'CANCELAR'])('reactiva desde %s y restaura exactamente la etapa operativa anterior', async (exceptionalAction) => {
    const prospect = await create();
    await act(prospect.id, 'COMENZAR_INTEGRACION');
    await act(prospect.id, exceptionalAction, primary, { reason: 'Pausa temporal acreditada' });
    expect((await read(prospect.id)).stage).toBe(exceptionalAction === 'SUSPENDER' ? 'SUSPENDIDO' : 'CANCELADO');
    await act(prospect.id, 'REACTIVAR', primary, { reason: 'Se reanudó la atención' });
    const workflow = await read(prospect.id);
    expect(workflow.stage).toBe('EN_INTEGRACION');
    expect(workflow.events.at(-1)).toMatchObject({ previousLabel: exceptionalAction === 'SUSPENDER' ? 'Suspendido' : 'Cancelado', nextLabel: 'En integración', actionLabel: 'Reactivar prospecto' });
    const event = await db.prospectoTransicion.findFirstOrThrow({ where: { prospecto_id: prospect.id, accion: 'REACTIVAR' } });
    expect(event.evidencia).toMatchObject({ reason: 'SE REANUDÓ LA ATENCIÓN', restoredStage: 'EN_INTEGRACION' });
  });

  it('exige causa para suspender/cancelar y permite motivo opcional al reactivar', async () => {
    const prospect = await create();
    const current = await read(prospect.id);
    await expect(mutate(primary, prospect.id, { action: 'SUSPENDER', expectedVersion: current.version, confirm: true, idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ status: 400, code: 'PRO001_REASON_REQUIRED' });
    await act(prospect.id, 'SUSPENDER', primary, { reason: 'Pausa temporal' });
    await act(prospect.id, 'REACTIVAR');
    expect((await read(prospect.id)).stage).toBe('NUEVO');
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
    const quote = await db.cotizacion.findUniqueOrThrow({
      where: { id: result.quoteId! },
      include: { prospecto: true, conceptos: { orderBy: { orden: 'asc' } }, versiones: { include: { conceptos: { orderBy: { orden: 'asc' } } } } },
    });
    expect(quote.numero_cotizacion).toMatch(/^COT-\d{4}-\d{4}$/);
    expect(quote).toMatchObject({ prospecto_id: prospect.id, user_id: primary.id, organization_id: primary.organizationId });
    expect(quote.prospecto).toMatchObject({ telefono: '3111002000', email: 'cliente@example.test', tipo_acto: 'Compraventa', necesidad: 'OPERACIÓN DIRECTA' });
    expect(quote.total_cliente?.toString()).toBe('1160');
    expect(quote.versiones).toHaveLength(0);
    expect(quote.honorarios_pravia).toBeNull();
    expect(quote.conceptos.map((item: any) => [item.concepto, item.categoria, item.importe.toString()])).toEqual([
      ['Honorarios', 'HONORARIOS', '1000'],
      ['Impuestos y derechos', 'IMPUESTOS_DERECHOS', '160'],
    ]);
    expect(await db.documento.count({ where: { storage_key: document.storage_key } })).toBe(1);
    expect(await db.documento.count({ where: { id: document.id, prospecto_id: prospect.id } })).toBe(1);
    expect((await read(prospect.id)).stage).toBe('CONVERTIDO_EN_COTIZACION');
  });

  it('Corrección 002 conserva snapshot, convierte una vez y crea una copia operativa independiente', async () => {
    const prospect = await create();
    await run(primary, () => service.update(primary, prospect.id, {
      expectedVersion: 1,
      telefono: '3111002000',
      email: 'cotizacion-002@example.test',
      servicio_catalogo_codigo: 'COMPRAVENTA',
      necesidad: 'Conversión completa a expediente',
      honorarios_estimados: '1000',
      impuestos_derechos_estimados: '160',
      total_estimado: '1160',
    }));
    const document = await db.documento.create({ data: {
      organization_id: primary.organizationId,
      prospecto_id: prospect.id,
      subido_por_id: primary.id,
      tipo: 'OTRO',
      categoria: 'PROYECTO',
      nombre_original: 'soporte-cotizacion-002.pdf',
      nombre_interno: randomUUID(),
      storage_key: `local-synthetic/${randomUUID()}`,
      mime_type: 'application/pdf',
      size_bytes: 48,
    } });
    await act(prospect.id, 'COMENZAR_INTEGRACION');
    await act(prospect.id, 'MARCAR_LISTO_PARA_COTIZAR');
    const prospectConversion = await act(prospect.id, 'CONVERTIR');
    const quoteId = prospectConversion.quoteId!;
    expect(await db.cotizacionVersion.count({ where: { cotizacion_id: quoteId } })).toBe(0);

    expect(await run(primary, () => quoteWorkflow.read(primary, quoteId))).toMatchObject({ stage: 'BORRADOR' });
    const started = await actQuote(quoteId, 'COMENZAR_ELABORACION');
    expect(started).toMatchObject({ idempotent: false, eventId: expect.any(String) });
    expect(await db.cotizacionTransicion.findUnique({ where: { id: started.eventId } })).toMatchObject({
      cotizacion_id: quoteId,
      accion: 'COMENZAR_ELABORACION',
      etapa_nueva: 'EN_ELABORACION',
    });
    expect(await run(primary, () => quoteWorkflow.read(primary, quoteId))).toMatchObject({ stage: 'EN_ELABORACION' });
    await actQuote(quoteId, 'ENVIAR_CLIENTE', {
      channel: 'correo',
      recipient: 'cotizacion-002@example.test',
      subject: 'Cotización de servicios notariales',
      messageBody: 'Se adjunta la cotización preparada para su revisión.',
      deliveryMode: 'MANUAL_CONFIRMED',
      evidence: 'Entrega confirmada manualmente por el usuario',
    });
    await actQuote(quoteId, 'INICIAR_SEGUIMIENTO');
    const beforeAcceptance = await run(primary, () => quoteWorkflow.read(primary, quoteId));
    await actQuote(quoteId, 'ACEPTAR', {
      confirmedActIds: beforeAcceptance.acts.map((item: any) => item.id),
      formalApplicantId,
    });
    const accepted = await run(primary, () => quoteWorkflow.read(primary, quoteId));
    expect(accepted).toMatchObject({ stage: 'ACEPTADA' });
    expect(accepted.events.at(-1)).toMatchObject({ action: 'ACEPTAR', quoteVersion: { id: expect.any(String) } });

    const actType = await db.tipoActo.findFirstOrThrow({ where: { codigo_catalogo: 'COMPRAVENTA' } });
    const request = (key: string) => run(primary, () => quoteConversion.convert({
      cotizacionId: quoteId,
      actorUserId: primary.id,
      actorOrganizationId: primary.organizationId,
      actorSessionId: primary.sessionId,
      actor: primary,
      expectedVersion: accepted.version,
      idempotencyKey: key,
      confirm: true,
      effectiveAt: new Date().toISOString(),
      tipoActoId: actType.id,
    }));
    const [first, second] = await Promise.all([request(randomUUID()), request(randomUUID())]);
    expect(first.expediente.id).toBe(second.expediente.id);
    expect([first.alreadyConverted, second.alreadyConverted].sort()).toEqual([false, true]);
    expect(await db.expediente.count({ where: { cotizacion_id: quoteId } })).toBe(1);
    expect(await db.expedienteDocumento.count({ where: { expediente_id: first.expediente.id, documento_id: document.id, estatus: 'ACTIVO' } })).toBe(1);
    expect(await db.documento.count({ where: { storage_key: document.storage_key } })).toBe(1);

    const operational = await run(primary, () => expedienteBudget.read(primary, first.expediente.id));
    expect(operational.quote_origin).toMatchObject({ quote_id: quoteId, quote_version_id: expect.any(String), immutable: true });
    expect(operational.concepts.map((item: any) => [item.concepto, item.categoria, item.importe])).toEqual([
      ['HONORARIOS', 'HONORARIOS', '1000.00'],
      ['IMPUESTOS Y DERECHOS', 'IMPUESTOS_DERECHOS', '160.00'],
    ]);
    await run(primary, () => expedienteBudget.save(primary, first.expediente.id, {
      expected_version: operational.version,
      concepts: [
        { concepto: 'Honorarios ajustados en expediente', categoria: 'HONORARIOS', importe: '1250.00' },
        { concepto: 'Impuestos y derechos', categoria: 'IMPUESTOS_DERECHOS', importe: '175.00' },
      ],
    }));
    const acceptedAfterExpEdit = await db.cotizacionVersion.findUniqueOrThrow({
      where: { id: operational.quote_origin.quote_version_id },
      include: { conceptos: { orderBy: { orden: 'asc' } } },
    });
    expect(acceptedAfterExpEdit.conceptos.map((item: any) => [item.concepto, item.importe.toString()])).toEqual([
      ['Honorarios', '1000'],
      ['Impuestos y derechos', '160'],
    ]);
    expect(await run(primary, () => quoteWorkflow.read(primary, quoteId))).toMatchObject({
      stage: 'CONVERTIDA_EXPEDIENTE', linkedCase: { id: first.expediente.id }, originProspect: { id: prospect.id },
    });
  }, 30_000);

  it('Corrección 015 hereda múltiples actos, contexto, solicitante formal y avisos hasta el Expediente', async () => {
    const created = await run(primary, () => service.create(primary, {
      nombre: 'CLIENTE MULTIACTO C015',
      email: 'multiacto@example.test',
      necesidad: 'Operación con compraventa y poder general',
      contexto_operacion: 'Adquisición financiada con representación mediante poder.',
      tipo_acto_ids: [primaryActTypeId, secondaryActTypeId],
    }, randomUUID()));
    const prospect = created.prospecto;
    await run(primary, () => service.update(primary, prospect.id, {
      expectedVersion: 1,
      honorarios_estimados: '1500.00',
      impuestos_derechos_estimados: '240.00',
      total_estimado: '1740.00',
    }));
    await act(prospect.id, 'COMENZAR_INTEGRACION');
    await act(prospect.id, 'MARCAR_LISTO_PARA_COTIZAR');
    const prospectConversion = await act(prospect.id, 'CONVERTIR');
    const quoteId = prospectConversion.quoteId!;
    const quote = await db.cotizacion.findUniqueOrThrow({ where: { id: quoteId }, include: { actos: { orderBy: { orden: 'asc' } } } });
    expect(quote.contexto_operacion).toBe('ADQUISICIÓN FINANCIADA CON REPRESENTACIÓN MEDIANTE PODER.');
    expect(quote.actos.map((item: any) => item.tipo_acto_id)).toEqual([primaryActTypeId, secondaryActTypeId]);
    expect(await db.notification.count({ where: { organization_id: primary.organizationId, href: `/cotizaciones/${quoteId}` } })).toBe(1);
    expect(await db.tarea.count({ where: { organization_id: primary.organizationId, idempotency_key: `PRO001:COTIZACION:${prospect.id}` } })).toBe(1);

    await actQuote(quoteId, 'COMENZAR_ELABORACION');
    await actQuote(quoteId, 'ENVIAR_CLIENTE', {
      channel: 'correo', recipient: 'multiacto@example.test', cc: 'archivo@example.test',
      subject: 'Cotización multiacto', messageBody: 'Cotización preparada para su revisión.',
      deliveryMode: 'MANUAL_CONFIRMED', evidence: 'Envío manual confirmado por el usuario',
    });
    await actQuote(quoteId, 'INICIAR_SEGUIMIENTO');
    const beforeAcceptance = await run(primary, () => quoteWorkflow.read(primary, quoteId));
    await actQuote(quoteId, 'ACEPTAR', {
      confirmedActIds: beforeAcceptance.acts.map((item: any) => item.id),
      formalApplicantId,
    });
    const accepted = await run(primary, () => quoteWorkflow.read(primary, quoteId));
    expect(accepted).toMatchObject({
      stage: 'ACEPTADA',
      formalApplicant: { id: formalApplicantId },
      acts: [{ confirmed_at: expect.any(Date) }, { confirmed_at: expect.any(Date) }],
    });

    const conversion = await run(primary, () => quoteConversion.convert({
      cotizacionId: quoteId,
      actorUserId: primary.id,
      actorOrganizationId: primary.organizationId,
      actorSessionId: primary.sessionId,
      actor: primary,
      expectedVersion: accepted.version,
      idempotencyKey: randomUUID(),
      confirm: true,
      effectiveAt: new Date().toISOString(),
      tipoActoId: primaryActTypeId,
    }));
    expect(await db.expedienteActo.count({ where: { organization_id: primary.organizationId, expediente_id: conversion.expediente.id } })).toBe(2);
    expect(await db.expedienteCompareciente.count({ where: {
      organization_id: primary.organizationId,
      expediente_id: conversion.expediente.id,
      compareciente_id: formalApplicantId,
      estatus: 'ACTIVO',
    } })).toBe(2);
    expect(await run(primary, () => quoteWorkflow.read(primary, quoteId))).toMatchObject({
      stage: 'CONVERTIDA_EXPEDIENTE',
      linkedCase: { id: conversion.expediente.id },
    });
  }, 30_000);

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
