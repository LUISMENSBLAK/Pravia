import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
const storage = vi.hoisted(() => ({ uploadFile: vi.fn(async () => undefined), deleteFile: vi.fn(async () => undefined) }));
vi.mock('../services/supabase.service', () => ({ ...storage, downloadFile: vi.fn() }));
import { ISRService } from '../services/isr.service';
import type { ISRV3Input } from '../domain/isrV3Engine';

const url = process.env.ISR_CLIENT_QA_DATABASE_URL;
if (url) { const u = new URL(url); if (u.hostname !== '127.0.0.1' || u.port !== '55521' || u.pathname !== '/pravia_client_qa' || u.searchParams.get('schema') !== 'pravia_os') throw Error('ISR_LOCAL_ISOLATED_DATABASE_REQUIRED'); }
const db = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
const org = randomUUID(), user = randomUUID();
const actor = { id: user, organizationId: org, rol: 'ADMINISTRACION', permissions: ['isr.read', 'isr.write', 'ia.execute'], scope: 'GLOBAL' } as NonNullable<Request['user']>;
let calcId = '', failAudit = false;
db?.$use(async (params, next) => { if (failAudit && params.model === 'AuditLog' && params.action === 'create') throw Error('QA_TEXT_AUDIT_FAILURE'); return next(params); });
const description = 'SINTÉTICO QA. Venta del terreno por 746130 pesos el 11 de noviembre de 2026.';
const input: ISRV3Input = { schemaVersion: 3, taxYear: 2026, operationDate: '', act: { name: '', fiscalClassification: 'OTRO' }, property: { type: 'TERRENO', sameAcquisitionDate: true }, values: { operation: '', appraisal: '', cadastral: '', landSale: '', constructionSale: '' }, parties: [], deductions: [], calculateIVA: false };
const modelResponse = { output: [{ content: [{ type: 'output_text', text: JSON.stringify({ operationDate: { value: '2026-11-11', excerpt: description }, 'values.operation': { value: '746130', excerpt: description }, 'values.appraisal': null, 'values.cadastral': null, 'values.landSale': null, 'values.constructionSale': null, 'property.type': null, parties: [] }) }] }] };

describe.runIf(Boolean(url))('ISR descripción · transacción PostgreSQL (Gateway/Storage sintéticos, NO OCR)', () => {
  beforeAll(async () => {
    await db!.organization.create({ data: { id: org, name: 'SINTÉTICO QA ISR interpretación' } });
    await db!.user.create({ data: { id: user, email: `isr-text-${user}@example.test`, nombre: 'SINTÉTICO', apellido: 'QA', rol: 'ADMINISTRACION', password_hash: 'synthetic-no-login' } });
    await db!.organizationMembership.create({ data: { user_id: user, organization_id: org, rol: 'ADMINISTRACION' } });
    calcId = (await db!.calculoISR.create({ data: { organization_id: org, folio: `ISR-QA-TEXT-${randomUUID()}`, ejercicio: 2026, tipo_operacion: 'ENAJENACION_INMUEBLE', input_data: input as any, creado_por_id: user, actualizado_por_id: user } })).id;
  });
  afterAll(async () => { await db?.$disconnect(); });
  it('persiste fuente/propuestas/auditoría, pero no aplica datos ni genera impuesto', async () => {
    const gateway = { execute: vi.fn().mockResolvedValue(modelResponse) }; const service = new ISRService(db!, gateway);
    const result = await service.interpretOperation(actor, calcId, description, 'text-first');
    expect(result).toMatchObject({ proposals: 2, idempotent: false }); expect(gateway.execute).toHaveBeenCalledTimes(1);
    const source = await db!.documento.findUniqueOrThrow({ where: { id: result.source_document_id } });
    expect(source.datos_extraidos).toMatchObject({ source: 'USER_DECLARED_NOT_OFFICIAL', description_sha256: createHash('sha256').update(description).digest('hex') });
    const upload = storage.uploadFile.mock.calls.at(-1) as unknown as [Buffer, string, string];
    expect(source.checksum_sha256).toBe(createHash('sha256').update(upload[0]).digest('hex')); expect(source.size_bytes).toBe(upload[0].length);
    expect(await db!.calculoISRPropuesta.count({ where: { calculo_id: calcId, source_document_id: source.id, status: 'PENDIENTE' } })).toBe(2);
    expect((await db!.calculoISR.findUniqueOrThrow({ where: { id: calcId } })).input_data).toEqual(input);
    expect(await db!.calculoISRVersion.count({ where: { calculo_id: calcId } })).toBe(0);
    expect(await db!.auditLog.findFirst({ where: { entidad_id: calcId, accion: 'INTERPRETAR_OPERACION_ISR_IA' } })).toMatchObject({ detalles: { input_modified: false, tax_calculated: false, proposals: 2 } });
    expect(await service.interpretOperation(actor, calcId, description, 'text-first')).toMatchObject({ idempotent: true, source_document_id: source.id });
    expect(gateway.execute).toHaveBeenCalledTimes(1);
    await expect(service.interpretOperation(actor, calcId, `${description} Alterada.`, 'text-first')).rejects.toMatchObject({ code: 'ISR_KEY_REUSED' });
  });
  it('fallo de auditoría revierte fuente/vínculo/propuestas y compensa el blob', async () => {
    const before = await db!.calculoISRPropuesta.count({ where: { calculo_id: calcId } });
    failAudit = true;
    try { await expect(new ISRService(db!, { execute: vi.fn().mockResolvedValue(modelResponse) }).interpretOperation(actor, calcId, description, 'text-rollback')).rejects.toThrow('QA_TEXT_AUDIT_FAILURE'); } finally { failAudit = false; }
    expect(await db!.calculoISRPropuesta.count({ where: { calculo_id: calcId } })).toBe(before);
    expect(await db!.calculoISRDocumento.count({ where: { calculo_id: calcId } })).toBe(1);
    expect(storage.deleteFile).toHaveBeenCalled();
  });
  it('tenant/permiso impiden proveedor y Storage antes de procesar', async () => {
    const gateway = { execute: vi.fn() }, service = new ISRService(db!, gateway);
    await expect(service.interpretOperation({ ...actor, organizationId: randomUUID() }, calcId, description, 'foreign')).rejects.toMatchObject({ status: 404 });
    await expect(service.interpretOperation({ ...actor, permissions: ['isr.read'] }, calcId, description, 'no-grant')).rejects.toMatchObject({ status: 403 });
    expect(gateway.execute).not.toHaveBeenCalled();
  });
});
