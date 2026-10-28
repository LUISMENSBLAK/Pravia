import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FinanceFiscalService } from '../services/financeFiscal.service';
import { deleteFile, downloadFile } from '../services/supabase.service';

const qaUrl = process.env.CFDI_BALANCE_QA_DATABASE_URL || '';
const enabled = process.env.CFDI_BALANCE_QA === '1';
if (enabled) {
  const parsed = new URL(qaUrl);
  const runtime = new URL(process.env.DATABASE_URL || 'postgresql://invalid.invalid/blocked');
  for (const url of [parsed, runtime]) {
    if (url.hostname !== '127.0.0.1' || url.port !== '55510' || url.pathname !== '/pravia_qa' || url.searchParams.get('schema') !== 'pravia_os') {
      throw new Error('CFDI balance integration test requires isolated local pravia_qa.');
    }
  }
}

const db = enabled ? new PrismaClient({ datasources: { db: { url: qaUrl } } }) : null;
const service = db ? new FinanceFiscalService(db) : null;
const partyIds: string[] = [];
const linkIds: string[] = [];
const incomeIds: string[] = [];
const importedCfdiIds: string[] = [];
const importedDocumentIds: string[] = [];
const importedStorageKeys: string[] = [];
let organizationId = '';
let expedienteId = '';
let entityId = '';
let conceptId = '';
let actorId = '';
let characterId = '';
const actor = () => ({ id: actorId, organizationId, rol: 'DIRECCION' as const, permissions: ['finanzas.write'] });

async function makeIncome(amount: string) {
  const income = await db!.expedienteIngresoReportado.create({ data: {
    organization_id: organizationId, expediente_id: expedienteId,
    reportado_por_id: actorId, idempotency_key: randomUUID(),
    monto_reportado: amount, factura_estado: 'PENDIENTE',
    facturar_a_vinculo_id: linkIds[0], facturar_a_compareciente_id: partyIds[0],
  } });
  incomeIds.push(income.id);
  return income.id;
}

function draft(incomeId: string, receiverId: string, total: string) {
  return { direccion: 'EMITIDO', tipo: 'I', entidad_fiscal_id: entityId,
    expediente_id: expedienteId, ingreso_reportado_id: incomeId,
    receptor_compareciente_id: receiverId, subtotal: total,
    impuestos_trasladados: '0.00', impuestos_retenidos: '0.00', total,
    metodo_pago: 'PPD', forma_pago: '99', moneda: 'MXN',
    concepto: 'Honorarios QA', conceptos: [{ concepto_fiscal_id: conceptId, cantidad: '1', valor_unitario: total }],
    idempotency_key: randomUUID() };
}

describe.runIf(enabled)('CFDI V2 income balance · isolated PostgreSQL', () => {
  beforeAll(async () => {
    const identity = await db!.$queryRaw<Array<{ database: string; schema: string }>>`SELECT current_database() AS database, current_schema() AS schema`;
    expect(identity[0]).toEqual({ database: 'pravia_qa', schema: 'pravia_os' });
    const entity = await db!.entidadFiscalCfdi.findFirst({ where: { activa: true }, select: { id: true, organization_id: true } });
    expect(entity).toBeTruthy();
    organizationId = entity!.organization_id;
    entityId = entity!.id;
    const expedition = await db!.expediente.findFirst({ where: { organization_id: organizationId, archived_at: null }, select: { id: true } });
    expect(expedition).toBeTruthy();
    expedienteId = expedition!.id;
    const membership = await db!.organizationMembership.findFirst({ where: { organization_id: organizationId, status: 'ACTIVE' }, select: { user_id: true } });
    expect(membership).toBeTruthy();
    actorId = membership!.user_id;
    const concept = await db!.conceptoFiscalCfdi.create({ data: {
      organization_id: organizationId, entidad_fiscal_id: entityId, descripcion: 'Concepto sintético QA sin impuestos',
      clave_prod_serv: '84111506', clave_unidad: 'E48', objeto_impuesto: '01',
      iva_tasa: '0.000000', iva_retencion_tasa: '0.000000', isr_retencion_tasa: '0.000000', created_by_id: actorId,
    } });
    conceptId = concept.id;
    const character = await db!.caracterCompareciente.findFirst({ select: { id: true } });
    expect(character).toBeTruthy();
    characterId = character!.id;
    for (let index = 0; index < 2; index += 1) {
      const party = await db!.compareciente.create({ data: { organization_id: organizationId,
        nombre_busqueda: `CFDI BALANCE QA ${randomUUID()}`, creado_por_id: actorId } });
      partyIds.push(party.id);
      const link = await db!.expedienteCompareciente.create({ data: { organization_id: organizationId,
        expediente_id: expedienteId, compareciente_id: party.id, caracter_id: characterId, creado_por_id: actorId } });
      linkIds.push(link.id);
    }
  });

  afterAll(async () => {
    if (!db) return;
    if (importedCfdiIds.length) {
      await db.cuentaPorCobrarCfdi.deleteMany({ where: { cfdi_id: { in: importedCfdiIds }, organization_id: organizationId } });
      await db.documentoCfdi.deleteMany({ where: { id: { in: importedCfdiIds }, organization_id: organizationId } });
    }
    if (importedDocumentIds.length) await db.documento.deleteMany({ where: { id: { in: importedDocumentIds }, organization_id: organizationId } });
    await Promise.all(importedStorageKeys.map((key) => deleteFile(key)));
    if (incomeIds.length) await db.documentoCfdi.deleteMany({ where: { ingreso_reportado_id: { in: incomeIds }, organization_id: organizationId } });
    if (partyIds.length) await db.comparecienteFiscalProfile.deleteMany({ where: { compareciente_id: { in: partyIds }, organization_id: organizationId } });
    if (incomeIds.length) await db.expedienteIngresoReportado.deleteMany({ where: { id: { in: incomeIds }, organization_id: organizationId } });
    if (linkIds.length) await db.expedienteCompareciente.deleteMany({ where: { id: { in: linkIds }, organization_id: organizationId } });
    if (partyIds.length) await db.compareciente.deleteMany({ where: { id: { in: partyIds }, organization_id: organizationId } });
    if (conceptId) await db.conceptoFiscalCfdi.delete({ where: { id: conceptId } });
    await db.$disconnect();
  });

  it('requires a confirmed linked receiver and stores a reviewed tenant fiscal profile', async () => {
    const incomeId = await makeIncome('20000.00');
    await expect(service!.createDraft(actor(), draft(incomeId, partyIds[0], '10000.00')))
      .rejects.toMatchObject({ code: 'CFDI_RECEIVER_FISCAL_PROFILE_REQUIRED' });
    const saved = await service!.confirmIncomeReceiver(actor(), incomeId, partyIds[0], {
      rfc: 'XAXX010101000', razon_social: 'COMPARECIENTE QA UNO', regimen_fiscal: '616', codigo_postal: '63735',
    });
    expect(saved.version).toBe(1);
    await service!.confirmIncomeReceiver(actor(), incomeId, partyIds[1], {
      rfc: 'XEXX010101000', razon_social: 'COMPARECIENTE QA DOS', regimen_fiscal: '616', codigo_postal: '63735',
    });
    const first = await service!.createDraft(actor(), draft(incomeId, partyIds[0], '10000.00'));
    expect(first.cfdi).toMatchObject({ estado: 'DRAFT', ingreso_reportado_id: incomeId,
      receptor_compareciente_id: partyIds[0], receptor_rfc: 'XAXX010101000' });
    expect(first.cfdi.cuentaPorCobrar).toBeNull();
    const balance = await service!.incomeContext(actor(), incomeId);
    expect(balance).toMatchObject({ facturableAmount: '20000.00', invoicedAmount: '0.00',
      reservedDraftAmount: '10000.00', remainingInvoiceableAmount: '10000.00' });
    const second = await service!.createDraft(actor(), draft(incomeId, partyIds[1], '10000.00'));
    expect(second.cfdi.receptor_compareciente_id).toBe(partyIds[1]);
    await expect(service!.createDraft(actor(), draft(incomeId, partyIds[0], '0.01')))
      .rejects.toMatchObject({ code: 'CFDI_INCOME_BALANCE_EXCEEDED' });
    await expect(service!.updateDraft(actor(), first.cfdi.id, { subtotal: '10000.01', total: '10000.01' }))
      .rejects.toMatchObject({ code: 'CFDI_INCOME_BALANCE_EXCEEDED' });
    await service!.deleteDraft(actor(), first.cfdi.id);
    const released = await service!.incomeContext(actor(), incomeId);
    expect(released.remainingInvoiceableAmount).toBe('10000.00');
  });

  it('serializes two concurrent reservations against the same income', async () => {
    const incomeId = await makeIncome('8000.00');
    const [a, b] = await Promise.allSettled([
      service!.createDraft(actor(), draft(incomeId, partyIds[0], '8000.00')),
      service!.createDraft(actor(), draft(incomeId, partyIds[1], '8000.00')),
    ]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = a.status === 'rejected' ? a.reason : b.status === 'rejected' ? b.reason : null;
    expect(rejected).toMatchObject({ code: 'CFDI_INCOME_BALANCE_EXCEEDED' });
    expect((await service!.incomeContext(actor(), incomeId)).remainingInvoiceableAmount).toBe('0.00');
    expect(await db!.documentoCfdi.count({ where: { organization_id: organizationId, ingreso_reportado_id: incomeId } })).toBe(1);
  });

  it('returns one draft for concurrent retries carrying the same idempotency key', async () => {
    const incomeId = await makeIncome('1000.00');
    await service!.confirmIncomeReceiver(actor(), incomeId, partyIds[0], {
      rfc: 'XAXX010101000', razon_social: 'COMPARECIENTE QA UNO', regimen_fiscal: '616', codigo_postal: '63735',
    });
    const input = draft(incomeId, partyIds[0], '300.00');
    const [first, retry] = await Promise.all([
      service!.createDraft(actor(), input), service!.createDraft(actor(), input),
    ]);
    expect(first.cfdi.id).toBe(retry.cfdi.id);
    expect([first.idempotent, retry.idempotent].sort()).toEqual([false, true]);
    expect(await db!.documentoCfdi.count({ where: { organization_id: organizationId, ingreso_reportado_id: incomeId } })).toBe(1);
    expect((await service!.incomeContext(actor(), incomeId)).reservedDraftAmount).toBe('300.00');
  });

  it('denies cross-tenant reads without leaking the income', async () => {
    const incomeId = await makeIncome('100.00');
    await expect(service!.incomeContext({ id: actorId, organizationId: randomUUID(), rol: 'DIRECCION', permissions: [] }, incomeId))
      .rejects.toMatchObject({ status: 404, code: 'CFDI_INCOME_NOT_AVAILABLE' });
  });

  it('applies expediente object access to a direct income id while preserving the financial role scope', async () => {
    const incomeId = await makeIncome('100.00');
    await expect(service!.incomeContext({ id: randomUUID(), organizationId, rol: 'ABOGADO', permissions: ['finanzas.read'] }, incomeId))
      .rejects.toMatchObject({ status: 404, code: 'CFDI_INCOME_NOT_AVAILABLE' });
    await expect(service!.confirmIncomeReceiver({ id: randomUUID(), organizationId, rol: 'ABOGADO', permissions: ['finanzas.write'] }, incomeId, partyIds[0], {
      rfc: 'XAXX010101000', razon_social: 'COMPARECIENTE QA', regimen_fiscal: '616', codigo_postal: '63735',
    })).rejects.toMatchObject({ status: 404, code: 'CFDI_INCOME_NOT_AVAILABLE' });
    await expect(service!.incomeContext({ id: actorId, organizationId, rol: 'FINANCIERO', permissions: ['finanzas.read'] }, incomeId))
      .resolves.toMatchObject({ facturableAmount: '100.00' });
  });

  it('denies editing and deleting a draft by direct ID without expediente object access', async () => {
    const incomeId = await makeIncome('500.00');
    await service!.confirmIncomeReceiver(actor(), incomeId, partyIds[0], {
      rfc: 'XAXX010101000', razon_social: 'COMPARECIENTE QA UNO', regimen_fiscal: '616', codigo_postal: '63735',
    });
    const created = await service!.createDraft(actor(), draft(incomeId, partyIds[0], '500.00'));
    const deniedActor = { id: randomUUID(), organizationId, rol: 'ABOGADO' as const, permissions: ['finanzas.write'] };
    await expect(service!.updateDraft(deniedActor, created.cfdi.id, { total: '500.00' }))
      .rejects.toMatchObject({ status: 404, code: 'CFDI_INCOME_NOT_AVAILABLE' });
    await expect(service!.deleteDraft(deniedActor, created.cfdi.id))
      .rejects.toMatchObject({ status: 404, code: 'CFDI_INCOME_NOT_AVAILABLE' });
    await expect(service!.deleteDraft({ ...actor(), organizationId: randomUUID() }, created.cfdi.id))
      .rejects.toMatchObject({ status: 404, code: 'CFDI_NOT_FOUND' });
    expect(await db!.documentoCfdi.count({ where: { id: created.cfdi.id, organization_id: organizationId } })).toBe(1);
    await expect(service!.deleteDraft(actor(), created.cfdi.id)).resolves.toMatchObject({ deleted: true });
    const retryDraft = await service!.createDraft(actor(), draft(incomeId, partyIds[0], '500.00'));
    const concurrentDeletes = await Promise.allSettled([
      service!.deleteDraft(actor(), retryDraft.cfdi.id),
      service!.deleteDraft(actor(), retryDraft.cfdi.id),
    ]);
    expect(concurrentDeletes.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = concurrentDeletes.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ status: 404, code: 'CFDI_NOT_FOUND' });
    expect(await db!.documentoCfdi.count({ where: { id: retryDraft.cfdi.id, organization_id: organizationId } })).toBe(0);
  });

  it.runIf(process.env.STORAGE_MODE === 'local')('keeps the winning XML intact when the same UUID is imported concurrently', async () => {
    const entity = await db!.entidadFiscalCfdi.findUniqueOrThrow({ where: { id: entityId }, select: { rfc: true } });
    const uuid = randomUUID().toUpperCase();
    const makeXml = (folio: string) => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante Version="4.0" Serie="QA" Folio="${folio}" Fecha="2026-10-11T10:00:00" SubTotal="100.00" Total="100.00" Moneda="MXN" TipoDeComprobante="I" MetodoPago="PPD" FormaPago="99">
  <cfdi:Emisor Rfc="${entity.rfc}" Nombre="NOTARIA QA" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="CLIENTE QA" DomicilioFiscalReceptor="63735" RegimenFiscalReceptor="616" UsoCFDI="G03"/>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" FechaTimbrado="2026-10-11T10:01:00"/></cfdi:Complemento>
</cfdi:Comprobante>`);
    const file = (folio: string) => ({ buffer: makeXml(folio), originalname: `synthetic-${folio}.xml`, mimetype: 'application/xml', size: makeXml(folio).length });
    try {
      const [first, second] = await Promise.all([
        service!.uploadManual(actor(), file('QA-A')),
        service!.uploadManual(actor(), file('QA-B')),
      ]);
      expect(first.cfdi.id).toBe(second.cfdi.id);
      expect([first.idempotent, second.idempotent].sort()).toEqual([false, true]);
      const saved = await db!.documentoCfdi.findFirstOrThrow({ where: { organization_id: organizationId, uuid_fiscal: uuid }, include: { xmlDocumento: true } });
      expect(await db!.documentoCfdi.count({ where: { organization_id: organizationId, uuid_fiscal: uuid } })).toBe(1);
      expect(saved.xmlDocumento).toBeTruthy();
      const storedXml = (await downloadFile(saved.xmlDocumento!.storage_key)).toString('utf8');
      expect(storedXml).toContain(`Folio="${saved.folio}"`);
      const objects = await readdir(path.join(process.env.LOCAL_STORAGE_PATH!, 'organizations', organizationId, 'fiscal', 'xml', uuid));
      expect(objects).toEqual([path.basename(saved.xmlDocumento!.storage_key)]);
    } finally {
      const saved = await db!.documentoCfdi.findFirst({ where: { organization_id: organizationId, uuid_fiscal: uuid }, include: { xmlDocumento: true, pdfDocumento: true } });
      if (saved) {
        importedCfdiIds.push(saved.id);
        for (const document of [saved.xmlDocumento, saved.pdfDocumento]) if (document) {
          importedDocumentIds.push(document.id);
          importedStorageKeys.push(document.storage_key);
        }
      }
    }
  });
});
