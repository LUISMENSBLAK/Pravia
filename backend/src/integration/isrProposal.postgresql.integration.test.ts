import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ISRService } from '../services/isr.service';
import type { ISRV3Input } from '../domain/isrV3Engine';

const url = process.env.ISR_CLIENT_QA_DATABASE_URL;
if (url) { const u = new URL(url); if (u.hostname !== '127.0.0.1' || u.port !== '55521' || u.pathname !== '/pravia_client_qa' || u.searchParams.get('schema') !== 'pravia_os') throw Error('ISR_LOCAL_ISOLATED_DATABASE_REQUIRED'); }
const db = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
let failAudit = false;
db?.$use(async (params, next) => { if (failAudit && params.model === 'AuditLog' && params.action === 'create') throw Error('SYNTHETIC_ISR_AUDIT_FAILURE'); return next(params); });
const org = randomUUID(), otherOrg = randomUUID(), user = randomUUID(), colleague = randomUUID();
const actor = { id: user, organizationId: org, rol: 'ADMINISTRACION', permissions: ['isr.read', 'isr.write', 'comparecientes.read'], scope: 'GLOBAL' } as NonNullable<Request['user']>;
const service = () => new ISRService(db!);
const input: ISRV3Input = { schemaVersion: 3, taxYear: 2026, operationDate: '', act: { name: 'SINTÉTICO', fiscalClassification: 'OTRO', otherDescription: 'QA, sin cálculo fiscal' }, property: { type: 'TERRENO', sameAcquisitionDate: true }, values: { operation: '100.00', appraisal: '', cadastral: '', landSale: '100.00', constructionSale: '0' }, calculateIVA: false, deductions: [], parties: [ { id: 'seller', role: 'ENAJENANTE', name: 'SINTÉTICO QA', subjectType: 'PF', nationalityCode: 'MX', fiscalResidence: 'POR_DETERMINAR', percentage: '100' } ] };
let calcId = '', sourceId = '';
const fresh = () => db!.calculoISR.findUniqueOrThrow({ where: { id: calcId } });
const proposal = (field = 'precio_enajenacion', value = '200.00') => db!.calculoISRPropuesta.create({ data: { organization_id: org, calculo_id: calcId, field_path: field, proposed_value: value, source_document_id: sourceId, source_document_name: 'SINTÉTICO QA — sin OCR en esta prueba', model_version: 'SYNTHETIC_HARNESS_NOT_PROVIDER', source_fragment: 'Propuesta sintética para comprobar aplicación transaccional.' } });

describe.runIf(Boolean(url))('ISR propuestas · PostgreSQL físico aislado', () => {
  beforeAll(async () => {
    for (const id of [org, otherOrg]) await db!.organization.create({ data: { id, name: 'SINTÉTICO QA ISR propuestas' } });
    for (const id of [user, colleague]) { await db!.user.create({ data: { id, email: `isr-proposal-${id}@example.test`, nombre: 'SINTÉTICO', apellido: 'QA', rol: 'ADMINISTRACION', password_hash: 'synthetic-no-login' } }); await db!.organizationMembership.create({ data: { user_id: id, organization_id: org, rol: 'ADMINISTRACION' } }); }
    const calc = await db!.calculoISR.create({ data: { organization_id: org, folio: `ISR-QA-${randomUUID()}`, ejercicio: 2026, tipo_operacion: 'ENAJENACION_INMUEBLE', input_data: input as unknown as Prisma.InputJsonValue, creado_por_id: user, actualizado_por_id: user } }); calcId = calc.id;
    const doc = await db!.documento.create({ data: { organization_id: org, nombre_original: 'SINTÉTICO QA, metadatos de ensayo', nombre_interno: `qa/isr/${randomUUID()}`, storage_key: `qa/isr/${randomUUID()}`, tipo: 'ISR_SOPORTE', mime_type: 'text/plain', size_bytes: 0, subido_por_id: user } }); sourceId = doc.id;
    await db!.calculoISRDocumento.create({ data: { organization_id: org, calculo_id: calcId, documento_id: sourceId, creado_por_id: user } });
  });
  afterAll(async () => { await db?.$disconnect(); });
  it('confirmar aplica dato, persiste tras reconsulta y registra procedencia anterior/nueva', async () => {
    const p = await proposal(); const before = await fresh();
    await service().reviewProposal(actor, calcId, p.id, 'ACEPTADA', { expectedUpdatedAt: before.updated_at.toISOString() });
    expect((await fresh()).input_data).toMatchObject({ values: { operation: '200.00', landSale: '100.00' } });
    expect(await db!.calculoISRPropuesta.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'ACEPTADA', reviewed_by_id: user });
    const audit = await db!.auditLog.findFirstOrThrow({ where: { organization_id: org, entidad_id: calcId, accion: 'ACEPTAR_PROPUESTA_ISR_IA' } });
    expect(audit.valores_anteriores).toEqual({ path: 'values.operation', value: '100.00' }); expect(audit.valores_nuevos).toEqual({ path: 'values.operation', value: '200.00' });
    expect(audit.detalles).toMatchObject({ source_document_id: sourceId, calculated_versions_modified: false, master_modified: false });
  });
  it('dos usuarios concurrentes y retry aplican una sola vez la misma propuesta', async () => {
    const p = await proposal('valor_avaluo', '225'); const before = await fresh(); const options = { expectedUpdatedAt: before.updated_at.toISOString() };
    await Promise.all([service().reviewProposal(actor, calcId, p.id, 'ACEPTADA', options), service().reviewProposal({ ...actor, id: colleague }, calcId, p.id, 'ACEPTADA', options)]);
    await service().reviewProposal(actor, calcId, p.id, 'ACEPTADA', options);
    const logs = await db!.auditLog.findMany({ where: { entidad_id: calcId, detalles: { path: ['propuesta_id'], equals: p.id } } }); expect(logs).toHaveLength(1);
    expect((await fresh()).input_data).toMatchObject({ values: { appraisal: '225.00' } });
  });
  it('stale de dos propuestas diferentes no sobrescribe el borrador más reciente', async () => {
    const a = await proposal('valor_operacion', '300'); const b = await proposal('valor_operacion', '400'); const before = await fresh();
    const results = await Promise.allSettled([a, b].map((p) => service().reviewProposal(actor, calcId, p.id, 'ACEPTADA', { expectedUpdatedAt: before.updated_at.toISOString() })));
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((item) => item.status === 'rejected')).toMatchObject({ reason: { code: 'ISR_STALE_STATE' } });
  });
  it('fallar auditoría revierte tanto dato como aceptación', async () => {
    const p = await proposal('valor_catastral', '900'); const before = await fresh(); failAudit = true;
    try { await expect(service().reviewProposal(actor, calcId, p.id, 'ACEPTADA', { expectedUpdatedAt: before.updated_at.toISOString() })).rejects.toThrow('SYNTHETIC_ISR_AUDIT_FAILURE'); } finally { failAudit = false; }
    expect((await fresh()).input_data).toEqual(before.input_data); expect((await db!.calculoISRPropuesta.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('PENDIENTE');
  });
  it('otro tenant y CONSULTA no pueden revisar ni aplicar', async () => {
    const p = await proposal();
    await expect(service().reviewProposal({ ...actor, organizationId: otherOrg }, calcId, p.id, 'RECHAZADA')).rejects.toMatchObject({ status: 404 });
    await expect(service().reviewProposal({ ...actor, rol: 'CONSULTA', permissions: ['isr.read'] }, calcId, p.id, 'RECHAZADA')).rejects.toMatchObject({ status: 403 });
    expect((await db!.calculoISRPropuesta.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('PENDIENTE');
  });
  it('identidad necesita destino explícito y no modifica maestros', async () => {
    const p = await proposal('rfc', 'AAAA800101AA1'); const before = await fresh(); const options = { expectedUpdatedAt: before.updated_at.toISOString() };
    await expect(service().reviewProposal(actor, calcId, p.id, 'ACEPTADA', options)).rejects.toMatchObject({ code: 'ISR_PROPOSAL_TARGET_REQUIRED' });
    await service().reviewProposal(actor, calcId, p.id, 'ACEPTADA', { ...options, partyId: 'seller' });
    expect((await fresh()).input_data).toMatchObject({ parties: [{ id: 'seller', rfc: 'AAAA800101AA1' }] });
    expect(await db!.compareciente.count({ where: { organization_id: org } })).toBe(0);
  });
  it('fuente inactiva y path desconocido se rechazan sin falso éxito', async () => {
    const p = await proposal('__proto__.polluted', 'true'); let before = await fresh();
    await expect(service().reviewProposal(actor, calcId, p.id, 'ACEPTADA', { expectedUpdatedAt: before.updated_at.toISOString() })).rejects.toMatchObject({ code: 'ISR_PROPOSAL_MANUAL_FIELD' });
    await db!.calculoISRDocumento.update({ where: { calculo_id_documento_id: { calculo_id: calcId, documento_id: sourceId } }, data: { estatus: 'INACTIVO' } });
    before = await fresh(); await expect(service().reviewProposal(actor, calcId, p.id, 'ACEPTADA', { expectedUpdatedAt: before.updated_at.toISOString() })).rejects.toMatchObject({ code: 'ISR_PROPOSAL_SOURCE_INACTIVE' });
  });
});
