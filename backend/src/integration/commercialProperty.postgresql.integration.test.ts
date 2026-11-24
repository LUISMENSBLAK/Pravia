import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommercialPropertyService } from '../services/commercialProperty.service';
import { QuoteBudgetService } from '../services/quoteBudget.service';
import { ProspectWorkflowService } from '../services/prospectWorkflow.service';
import { CotizacionWorkflowService } from '../services/cotizacionWorkflow.service';
import { CotizacionConversionService } from '../services/cotizacionConversion.service';
import { runWithActorContext } from '../auth/actorContext';

const target = process.env.COMMERCIAL_PROPERTY_QA_DATABASE_URL;
if (target) {
  const url = new URL(target);
  if (url.hostname !== '127.0.0.1' || url.port !== '55521' || url.pathname !== '/pravia_client_qa' || url.searchParams.get('schema') !== 'pravia_os') throw Error('ISOLATED_COMMERCIAL_PROPERTY_QA_REQUIRED');
}
const db = target ? new PrismaClient({ datasources: { db: { url: target } } }) : null;
const org = randomUUID(), otherOrg = randomUUID(), user = randomUUID(), colleague = randomUUID();
const otherUser = randomUUID();
const quote = randomUUID(), prospect = randomUUID(), property = randomUUID(), otherProperty = randomUUID();
const actor = { id: user, organizationId: org, membershipId: randomUUID(), sessionId: randomUUID(), rol: 'ADMINISTRACION', scope: 'GLOBAL',
  permissions: ['cotizaciones.read', 'cotizaciones.write', 'prospectos.read', 'prospectos.write', 'expedientes.read', 'expedientes.write'] } as NonNullable<Request['user']>;
const reader = { ...actor, id: colleague, rol: 'ABOGADO' };
let service: CommercialPropertyService;
const select = async (kind: 'cotizacion' | 'prospecto', id: string, predioId: string | null, override = actor) => {
  const source = await service.read(override, kind, id);
  return service.select(override, kind, id, { predio_id: predioId, expected_updated_at: source.expected_updated_at.toISOString(), expected_property_version: 1, confirm: true });
};

describe.runIf(Boolean(target))('Predio comercial · PostgreSQL físico aislado', () => {
  beforeAll(async () => {
    await db!.organization.createMany({ data: [{ id: org, name: 'SINTÉTICO QA relación de inmueble' }, { id: otherOrg, name: 'SINTÉTICO QA tenant ajeno' }] });
    await db!.user.createMany({ data: [user, colleague].map(id => ({ id, email: `commercial-${id}@example.test`, password_hash: 'no-login-synthetic', nombre: 'QA', apellido: 'Sintético', rol: 'ADMINISTRACION' as const })) });
    await db!.organizationMembership.createMany({ data: [user, colleague].map(user_id => ({ organization_id: org, user_id, rol: 'ADMINISTRACION' as const })) });
    await db!.user.create({ data: { id: otherUser, email: `commercial-${otherUser}@example.test`, password_hash: 'no-login-synthetic', nombre: 'QA', apellido: 'Otro tenant', rol: 'ADMINISTRACION' } });
    await db!.organizationMembership.create({ data: { organization_id: otherOrg, user_id: otherUser, rol: 'ADMINISTRACION' } });
    await db!.cotizacion.create({ data: { id: quote, organization_id: org, user_id: user, estado: 'BORRADOR', valor_operacion: '111.11', cuenta_predial: '000-HIST', importe_predial: '77.77', total_cliente: '116.00' } });
    await db!.prospecto.create({ data: { id: prospect, organization_id: org, user_id: user, nombre: 'SINTÉTICO QA prospecto' } });
    for (const [id, organization_id] of [[property, org], [otherProperty, otherOrg]]) {
      const owner = organization_id === org ? user : otherUser;
      await db!.predio.create({ data: { id, organization_id, apodo: `SINTÉTICO QA ${id}`, created_by: owner, updated_by: owner, valor_operacion: '2500000.50', valor_catastral: '0', valor_avaluo: null } });
    }
    service = new CommercialPropertyService(db!);
  });
  afterAll(async () => { await db?.$disconnect(); });

  it('persiste los tres valores manuales sin modificar predial histórico, presupuesto o pagos', async () => {
    const current = await db!.cotizacion.findUniqueOrThrow({ where: { id: quote } });
    await new QuoteBudgetService(db!).save(actor, quote, { propertyValues: { operationValue: '111.11', cadastralValue: null, appraisalValue: '12.34' }, expectedUpdatedAt: current.updated_at.toISOString() });
    const stored = await db!.cotizacion.findUniqueOrThrow({ where: { id: quote } });
    expect(stored.valor_avaluo?.toFixed(2)).toBe('12.34');
    expect(stored.cuenta_predial).toBe('000-HIST'); expect(stored.importe_predial?.toFixed(2)).toBe('77.77');
    expect(stored.total_cliente?.toFixed(2)).toBe('116.00');
    expect(await db!.pago.count({ where: { cotizacion_id: quote } })).toBe(0);
    expect(await db!.cotizacionConcepto.count({ where: { cotizacion_id: quote } })).toBe(0);
  });
  it.each(['cotizacion', 'prospecto'] as const)('vincula %s a la misma ficha sin duplicarla, audita y conserva después de reconsulta', async kind => {
    const id = kind === 'cotizacion' ? quote : prospect;
    const before = await db!.predio.findUniqueOrThrow({ where: { id: property } });
    await select(kind, id, property);
    const reloaded = await service.read(actor, kind, id);
    expect(reloaded.source).toBe('PREDIO_MASTER'); expect(reloaded.property?.id).toBe(property);
    expect(reloaded.values).toMatchObject({ operationValue: '2500000.5', cadastralValue: '0', appraisalValue: null });
    expect(await db!.predio.findUniqueOrThrow({ where: { id: property } })).toEqual(before);
    expect(await db!.auditLog.count({ where: { organization_id: org, entidad_id: id, accion: 'COMMERCIAL_PROPERTY_SELECTED' } })).toBe(1);
  });
  it('permite lectura compartida pero deniega escritura de un colega no asignado', async () => {
    expect((await service.read(reader, 'cotizacion', quote)).capabilities.canWrite).toBe(false);
    expect((await service.read(reader, 'prospecto', prospect)).property?.id).toBe(property);
    await expect(select('cotizacion', quote, null, reader)).rejects.toMatchObject({ code: 'COMMERCIAL_PROPERTY_NOT_FOUND' });
    await expect(select('prospecto', prospect, null, reader)).rejects.toMatchObject({ code: 'COMMERCIAL_PROPERTY_NOT_FOUND' });
  });
  it('limita búsqueda y objeto a la Organization y no expone documentos del maestro', async () => {
    const result = await service.options(actor, 'cotizacion', quote, 'SINTÉTICO QA');
    expect(result.map(item => item.id)).toEqual([property]);
    expect(result[0]).not.toHaveProperty('documentos'); expect(result[0]).not.toHaveProperty('created_by');
    await expect(service.read({ ...actor, organizationId: otherOrg }, 'cotizacion', quote)).rejects.toMatchObject({ code: 'COMMERCIAL_PROPERTY_NOT_FOUND' });
    await expect(select('cotizacion', quote, otherProperty)).rejects.toMatchObject({ code: 'PROPERTY_SOURCE_NOT_FOUND' });
  });
  it('rechaza backend sin permiso de módulo o de Predios, incluso si intenta mutar directamente', async () => {
    await expect(service.read({ ...actor, permissions: [] }, 'cotizacion', quote)).rejects.toMatchObject({ status: 403 });
    await expect(service.read({ ...actor, permissions: ['cotizaciones.read'] }, 'cotizacion', quote)).rejects.toMatchObject({ code: 'PROPERTY_READ_DENIED' });
    const source = await service.read(actor, 'cotizacion', quote);
    await expect(service.select({ ...actor, permissions: ['cotizaciones.write'] }, 'cotizacion', quote, { predio_id: null, expected_updated_at: source.expected_updated_at.toISOString(), confirm: true })).rejects.toMatchObject({ status: 403 });
    expect((await db!.cotizacion.findUniqueOrThrow({ where: { id: quote } })).predio_principal_id).toBe(property);
  });
  it('rechaza intento de doble fuente manual mientras hay un inmueble vinculado', async () => {
    const current = await db!.cotizacion.findUniqueOrThrow({ where: { id: quote } });
    await expect(new QuoteBudgetService(db!).save(actor, quote, { propertyValues: { appraisalValue: '999' }, expectedUpdatedAt: current.updated_at.toISOString() })).rejects.toMatchObject({ code: 'QUOTE_PROPERTY_MASTER_LINKED' });
  });
  it('requiere confirmación y revisión de ambas fichas y rechaza inyección de campos', async () => {
    const current = await service.read(actor, 'cotizacion', quote);
    const input = { predio_id: property, expected_updated_at: current.expected_updated_at.toISOString(), expected_property_version: 1, confirm: true };
    await expect(service.select(actor, 'cotizacion', quote, { ...input, confirm: false })).rejects.toMatchObject({ code: 'PROPERTY_LINK_CONFIRMATION_REQUIRED' });
    await expect(service.select(actor, 'cotizacion', quote, { ...input, estado: 'ACEPTADA' })).rejects.toMatchObject({ status: 400 });
    await expect(service.select(actor, 'cotizacion', quote, { ...input, expected_property_version: 0 })).rejects.toMatchObject({ code: 'PROPERTY_SOURCE_STALE' });
    await expect(service.select(actor, 'cotizacion', quote, { ...input, expected_updated_at: new Date(0).toISOString() })).rejects.toMatchObject({ code: 'PROPERTY_LINK_STALE' });
  });
  it('serializa dos usuarios concurrentes y no pierde la revisión', async () => {
    const current = await service.read(actor, 'cotizacion', quote);
    const input = { predio_id: property, expected_updated_at: current.expected_updated_at.toISOString(), expected_property_version: 1, confirm: true };
    const results = await Promise.allSettled([actor, { ...actor, id: colleague }].map(person => service.select(person, 'cotizacion', quote, input)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'PROPERTY_LINK_STALE' } });
  });
  it('refleja cambio canónico del maestro sin sobreescribir los valores históricos de la cotización', async () => {
    await db!.predio.update({ where: { id: property }, data: { valor_operacion: '3000000.75', valor_avaluo: '3100000', version: { increment: 1 } } });
    expect((await service.read(actor, 'cotizacion', quote)).values).toMatchObject({ operationValue: '3000000.75', appraisalValue: '3100000' });
    expect((await db!.cotizacion.findUniqueOrThrow({ where: { id: quote } })).valor_operacion?.toFixed(2)).toBe('111.11');
  });
  it('conserva lectura de archivo pero impide vincular nuevas referencias a un predio archivado', async () => {
    await db!.predio.update({ where: { id: property }, data: { archived_at: new Date() } });
    expect((await service.read(actor, 'cotizacion', quote)).property?.archived_at).not.toBeNull();
    expect(await service.options(actor, 'cotizacion', quote, '')).toHaveLength(0);
    await expect(select('cotizacion', quote, property)).rejects.toMatchObject({ code: 'PROPERTY_SOURCE_NOT_FOUND' });
    await db!.predio.update({ where: { id: property }, data: { archived_at: null } });
  });
  it('PostgreSQL físico impide referencias entre tenants y avalúos negativos sin depender del API', async () => {
    await expect(db!.cotizacion.update({ where: { id: quote }, data: { predio_principal_id: otherProperty } })).rejects.toThrow();
    await expect(db!.prospecto.update({ where: { id: prospect }, data: { predio_principal_id: otherProperty } })).rejects.toThrow();
    await expect(db!.cotizacion.update({ where: { id: quote }, data: { valor_avaluo: '-0.01' } })).rejects.toThrow();
  });
  it.each(['cotizacion', 'prospecto'] as const)('desvincula %s sin borrar el inmueble ni los datos históricos', async kind => {
    const id = kind === 'cotizacion' ? quote : prospect;
    await select(kind, id, null);
    expect((await service.read(actor, kind, id)).source).toBe('MANUAL');
    expect(await db!.predio.count({ where: { id: property } })).toBe(1);
    const stored = await db!.cotizacion.findUniqueOrThrow({ where: { id: quote } });
    expect(stored.cuenta_predial).toBe('000-HIST'); expect(stored.importe_predial?.toFixed(2)).toBe('77.77');
  });
  it('hereda Prospecto → Cotización por el workflow canónico, sin duplicar Predio y con retry idempotente', async () => {
    const act = await db!.tipoActo.create({ data: { organization_id: org, nombre: `SINTÉTICO QA acto ${randomUUID()}` } });
    const workflow = new ProspectWorkflowService(db!);
    const created = await workflow.create(actor, { nombre: 'SINTÉTICO QA herencia de inmueble', tipo_acto_ids: [act.id] }, randomUUID());
    const id = created.prospecto.id;
    const propertyState = await service.read(actor, 'prospecto', id);
    const master = await db!.predio.findUniqueOrThrow({ where: { id: property } });
    await service.select(actor, 'prospecto', id, { predio_id: property, expected_property_version: master.version, expected_updated_at: propertyState.expected_updated_at.toISOString(), confirm: true });
    for (const action of ['COMENZAR_INTEGRACION', 'MARCAR_LISTO_PARA_COTIZAR']) {
      const current = await db!.prospecto.findUniqueOrThrow({ where: { id } });
      await workflow.act(actor, id, { action, expectedVersion: current.version_operativa, idempotencyKey: randomUUID(), confirm: true, ...(action === 'MARCAR_LISTO_PARA_COTIZAR' ? { quoteAssigneeId: actor.id } : {}) });
    }
    const current = await db!.prospecto.findUniqueOrThrow({ where: { id } });
    const input = { action: 'CONVERTIR', expectedVersion: current.version_operativa, idempotencyKey: randomUUID(), confirm: true };
    const converted = await workflow.act(actor, id, input);
    expect(converted.quoteId).toBeTruthy();
    expect((await db!.cotizacion.findUniqueOrThrow({ where: { id: converted.quoteId! } })).predio_principal_id).toBe(property);
    expect((await workflow.act(actor, id, input)).quoteId).toBe(converted.quoteId);
    expect(await db!.cotizacion.count({ where: { prospecto_id: id } })).toBe(1);
    expect((await service.read(actor, 'prospecto', id)).capabilities.canWrite).toBe(false);
    const quoteId = converted.quoteId!;
    const quoteWorkflow = new CotizacionWorkflowService(db!);
    const actQuote = async (action: string, extra: Record<string, unknown> = {}) => {
      const quote = await db!.cotizacion.findUniqueOrThrow({ where: { id: quoteId } });
      return quoteWorkflow.act(actor, quoteId, { action, expectedVersion: quote.version_operativa, idempotencyKey: randomUUID(), confirm: true, effectiveAt: new Date().toISOString(), ...extra });
    };
    await actQuote('COMENZAR_ELABORACION');
    const beforeBudget = await db!.cotizacion.findUniqueOrThrow({ where: { id: quoteId } });
    await new QuoteBudgetService(db!).save(actor, quoteId, { concepts: [{ concepto: 'Honorario sintético de prueba', categoria: 'HONORARIOS', importe: '100' }], expectedUpdatedAt: beforeBudget.updated_at.toISOString() });
    await actQuote('ENVIAR_CLIENTE', { channel: 'presencial', recipient: 'SINTÉTICO QA', evidence: 'Entrega sólo simulada en QA local', deliveryMode: 'MANUAL_CONFIRMED' });
    const applicant = await db!.compareciente.create({ data: { organization_id: org, nombre_busqueda: 'SINTÉTICO QA solicitante', creado_por_id: user } });
    const quoteAct = await db!.cotizacionActo.findFirstOrThrow({ where: { cotizacion_id: quoteId } });
    await actQuote('ACEPTAR', { confirmedActIds: [quoteAct.id], formalApplicantId: applicant.id });
    const ready = await db!.cotizacion.findUniqueOrThrow({ where: { id: quoteId } });
    const conversion = new CotizacionConversionService(db!);
    const conversionInput = { actor, actorUserId: actor.id, actorOrganizationId: org, cotizacionId: quoteId, abogadoId: actor.id,
      expectedVersion: ready.version_operativa, idempotencyKey: randomUUID(), confirm: true, effectiveAt: new Date().toISOString(), solicitanteCaracterPorActo: { [quoteAct.id]: null } };
    const context = { userId: actor.id, organizationId: org, membershipId: actor.membershipId, role: actor.rol, permissions: actor.permissions, scope: actor.scope, sessionId: actor.sessionId };
    const opened = await runWithActorContext(context, () => conversion.convert(conversionInput));
    const expediente = await db!.expediente.findUniqueOrThrow({ where: { id: opened.expediente.id } });
    expect(expediente.valor_operacion?.toFixed(2)).toBe('3000000.75');
    expect(expediente.cliente_compareciente_id).toBe(applicant.id);
    expect(await db!.expedientePredio.count({ where: { expediente_id: expediente.id, predio_id: property, organization_id: org } })).toBe(1);
    expect(await db!.predio.count({ where: { organization_id: org } })).toBe(1);
    expect((await runWithActorContext(context, () => conversion.convert(conversionInput))).expediente.id).toBe(expediente.id);
    expect(await db!.expedientePredio.count({ where: { expediente_id: expediente.id } })).toBe(1);
    expect(await db!.auditLog.count({ where: { entidad_id: expediente.id, accion: 'INHERIT_QUOTE_PROPERTY' } })).toBe(1);
  });
  it('conserva el vínculo en cotizaciones aceptadas, también históricas sin etapa canónica', async () => {
    await db!.cotizacion.update({ where: { id: quote }, data: { estado: 'ACEPTADA' } });
    expect((await service.read(actor, 'cotizacion', quote)).capabilities.canWrite).toBe(false);
    await expect(select('cotizacion', quote, null)).rejects.toMatchObject({ code: 'PROPERTY_LINK_FROZEN' });
  });
});
