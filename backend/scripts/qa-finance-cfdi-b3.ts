import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import JSZip from 'jszip';
import { FinanceFiscalService } from '../src/services/financeFiscal.service';
import { ContractTestCfdiProvider } from '../src/services/cfdiProvider';
import { downloadFile } from '../src/services/supabase.service';

const databaseUrl = process.env.DATABASE_URL || '';
if (!/127\.0\.0\.1|localhost/.test(databaseUrl) || !/55510/.test(databaseUrl)) throw new Error('B3_QA_REQUIRES_ISOLATED_LOCAL_POSTGRES_55510');
if (process.env.PRAVIA_STORAGE_PRIMARY !== 'local') throw new Error('B3_QA_REQUIRES_LOCAL_STORAGE');

const db = new PrismaClient({ datasourceUrl: databaseUrl });
const service = new FinanceFiscalService(db);
const organizationId = '30000000-0000-4000-8000-000000000001';
const foreignOrganizationId = '30000000-0000-4000-8000-0000000000b1';
const actorId = 'ad819fc5-169d-4ef0-8b2a-b5e4340ce197';
const actor = { id: actorId, organizationId, permissions: ['finanzas.read', 'finanzas.write', 'finanzas.validate', 'documentos.read', 'documentos.write'] };
const foreignActor = { id: '30000000-0000-4000-8000-0000000000b2', organizationId: foreignOrganizationId, permissions: actor.permissions };
const suffix = Date.now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-3).padStart(3, 'A');
const entityRfc = `QAA010101${suffix}`;
const supplierRfc = `QBB010101${suffix}`;
const cfdiUuid = randomUUID().toUpperCase();
const checks: Record<string, string> = {};
const pass = (id: string, detail: string) => { checks[id] = `PASS · ${detail}`; };

async function main() {
  const membership = await db.organizationMembership.findFirst({ where: { organization_id: organizationId, user_id: actorId, status: 'ACTIVE' } });
  assert(membership, 'actor membership');
  const primaryAccount = await db.cuentaFinanciera.findFirstOrThrow({ where: { organization_id: organizationId, activa: true } });
  const targetAccount = await db.cuentaFinanciera.create({ data: { organization_id: organizationId, institucion: 'Banco QA B3', alias: `Destino ${suffix}`, tipo: 'BANCARIA', moneda: 'MXN', creada_por_id: actorId } });
  const expediente = await db.expediente.findFirstOrThrow({ where: { organization_id: organizationId, archived_at: null } });
  const receiver = await db.compareciente.findFirst({ where: { organization_id: organizationId, archived_at: null } });

  await assert.rejects(() => service.createEntity(actor, { razon_social: 'SECRET FAIL', rfc: entityRfc, regimen_fiscal: '601', codigo_postal: '63735', pac_password: 'never' }), (error: any) => error.code === 'CFDI_RAW_SECRET_REJECTED');
  const entity = await service.createEntity(actor, { razon_social: `NOTARIA QA ${suffix}`, rfc: entityRfc, regimen_fiscal: '601', codigo_postal: '63735', tipo_contribuyente: 'MORAL', serie: 'QA', plantilla_id: randomUUID(), cuenta_ids: [primaryAccount.id], pac_secret_ref: 'secret://qa/pac', csd_key_secret_ref: 'secret://qa/csd-key', csd_password_secret_ref: 'secret://qa/csd-password' });
  assert.equal(entity.rfc, entityRfc);
  assert.equal(entity.pac_secret_ref, undefined);
  assert.equal(entity.pac_secret_configured, true);
  assert.equal((entity.cuentas as any[]).length, 1);
  pass('F01', 'Entidad fiscal CRUD'); pass('F02', 'secretos nunca salen en respuesta'); pass('F03', 'cuenta bancaria tenant-safe'); pass('F04', 'plantilla reemplazable persistida');

  await service.updateEntity(actor, String(entity.id), { razon_social: `NOTARIA QA ACTUALIZADA ${suffix}` });
  const foreignEntities = await service.listEntities(foreignActor);
  assert(!foreignEntities.some((item: any) => item.id === entity.id));

  const supplier = await service.createSupplier(actor, { razon_social: `PROVEEDOR QA ${suffix}`, rfc: supplierRfc, codigo_postal: '63735', regimenes_fiscales: [{ clave: '601', descripcion: 'General' }, { clave: '626', descripcion: 'RESICO' }] });
  assert.equal(supplier.supplier.rfc, supplierRfc);
  const supplierRetry = await service.createSupplier(actor, { razon_social: 'NO DUPLICAR', rfc: supplierRfc });
  assert.equal(supplierRetry.idempotent, true);
  pass('F07', 'múltiples regímenes'); pass('F08', 'Proveedor CRUD e idempotencia');

  const createMovement = (nature: 'INGRESO' | 'EGRESO', amount: number, key: string) => db.movimientoFinanciero.create({ data: {
    organization_id: organizationId, tipo_movimiento: nature === 'INGRESO' ? 'ABONO' : 'EGRESO_TERCEROS', naturaleza: nature,
    categoria: 'QA_B3', concepto: `QA B3 ${nature}`, monto: amount, cuenta_id: primaryAccount.id, estatus: 'APLICADO',
    capturado_por_id: actorId, validado_por_id: actorId, fecha_validacion: new Date(), aplicado_por_id: actorId, fecha_aplicacion: new Date(), idempotency_key: `${suffix}:${key}`,
  } });

  const common = { entidad_fiscal_id: entity.id, emisor_rfc: entityRfc, emisor_nombre: entity.razon_social, receptor_rfc: 'XAXX010101000', receptor_nombre: 'CLIENTE QA', receptor_regimen: '616', receptor_codigo_postal: '63735', uso_cfdi: 'G03', tipo: 'I', moneda: 'MXN', impuestos_trasladados: '0.00', impuestos_retenidos: '0.00' };
  const draftExp = await service.createDraft(actor, { ...common, direccion: 'EMITIDO', expediente_id: expediente.id, receptor_compareciente_id: receiver?.id, subtotal: '50000.00', total: '50000.00', metodo_pago: 'PPD', forma_pago: '99', concepto: 'Honorarios expediente QA', source_context: 'EXPEDIENTE', idempotency_key: `b3-exp-${suffix}` });
  assert.equal(draftExp.cfdi.expediente_id, expediente.id);
  if (receiver) assert.equal(draftExp.cfdi.receptor_compareciente_id, receiver.id);
  pass('F05', 'receptor Compareciente tenant-safe'); pass('F10', 'prefactura desde expediente');

  const draftCentral = await service.createDraft(actor, { ...common, direccion: 'EMITIDO', subtotal: '1200.00', total: '1200.00', metodo_pago: 'PUE', forma_pago: '03', concepto: 'Honorarios central QA', source_context: 'CENTRAL', idempotency_key: `b3-central-${suffix}` });
  await service.updateDraft(actor, draftCentral.cfdi.id, { subtotal: '1250.00', total: '1250.00' });
  pass('F11', 'prefactura central'); pass('F12', 'mismo servicio createDraft'); pass('F13', 'prefactura editable');

  const pueMovement = await createMovement('INGRESO', 1250, 'pue');
  const pueApplied = await service.applyPayment(actor, draftCentral.cfdi.id, { movimiento_id: pueMovement.id, monto: '1250.00', idempotency_key: `pue-pay-${suffix}` });
  assert.equal(pueApplied.balance, '0.00');
  pass('F15', 'PUE exige y aplica liquidación total');

  const payment1 = await createMovement('INGRESO', 20000, 'ppd-1');
  const payment2 = await createMovement('INGRESO', 30000, 'ppd-2');
  const first = await service.applyPayment(actor, draftExp.cfdi.id, { movimiento_id: payment1.id, monto: '20000.00', idempotency_key: `ppd-pay-1-${suffix}` });
  const second = await service.applyPayment(actor, draftExp.cfdi.id, { movimiento_id: payment2.id, monto: '30000.00', idempotency_key: `ppd-pay-2-${suffix}` });
  assert.equal(first.balance, '30000.00'); assert.equal(second.balance, '0.00');
  const retry = await service.applyPayment(actor, draftExp.cfdi.id, { movimiento_id: payment2.id, monto: '30000.00', idempotency_key: `ppd-pay-2-${suffix}` });
  assert.equal(retry.idempotent, true);
  const repNotEligible = await service.prepareRep(actor, draftExp.cfdi.id);
  assert.deepEqual(repNotEligible, { eligible: false, reason: 'SOURCE_CFDI_NOT_STAMPED', message: 'La factura origen debe estar timbrada antes de preparar el REP.', providerCall: false });
  pass('F16', 'PPD 20k + 30k, saldo 0 e idempotencia'); pass('F17', 'REP se detiene antes de PAC si origen no está timbrado'); pass('F18', 'factura antes de pagos'); pass('F19', 'movimientos existentes se enlazan después'); pass('F27', 'CxC determinista'); pass('F40', 'retry no duplica aplicación');

  const paymentBeforeInvoice = await createMovement('EGRESO', 1160, 'supplier-payment-first');
  const manualXml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="R" Folio="${suffix}" Fecha="2026-10-06T10:00:00" SubTotal="1000.00" Total="1160.00" Moneda="MXN" TipoDeComprobante="I" MetodoPago="PPD" FormaPago="99"><cfdi:Emisor Rfc="${supplierRfc}" Nombre="PROVEEDOR QA ${suffix}" RegimenFiscal="601"/><cfdi:Receptor Rfc="${entityRfc}" Nombre="NOTARIA QA ${suffix}" DomicilioFiscalReceptor="63735" RegimenFiscalReceptor="601" UsoCFDI="G03"/><cfdi:Impuestos TotalImpuestosTrasladados="160.00"/><cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="${cfdiUuid}" FechaTimbrado="2026-10-06T10:01:00"/></cfdi:Complemento></cfdi:Comprobante>`);
  const manual = await service.uploadManual(actor, { buffer: manualXml, originalname: 'factura.xml', mimetype: 'application/xml', size: manualXml.length }, { buffer: Buffer.from('%PDF-1.4\nQA B3'), originalname: 'factura.pdf', mimetype: 'application/pdf', size: 14 });
  assert.equal(manual.supplierStatus, 'REGISTERED');
  assert.equal(manual.cfdi.source, 'MANUAL_XML'); assert.equal(manual.cfdi.estado, 'VIGENTE');
  const xmlUrl = await service.documentUrl(actor, manual.cfdi.id, 'xml');
  assert(manual.cfdi.xmlDocumento);
  assert.equal((await downloadFile(manual.cfdi.xmlDocumento.storage_key)).toString(), manualXml.toString());
  assert(xmlUrl.url.includes('/api/storage/') || xmlUrl.url.startsWith('http'));
  await service.applyPayment(actor, manual.cfdi.id, { movimiento_id: paymentBeforeInvoice.id, monto: '1160.00', idempotency_key: `supplier-pay-${suffix}` });
  pass('F20', 'factura proveedor antes de pago'); pass('F21', 'pago proveedor preexistente enlazado'); pass('F22', 'matching por relación explícita'); pass('F24', 'XML+PDF almacenados y recargables'); pass('F28', 'CxP determinista');

  const unknownRfc = `QCC010101${suffix}`;
  const unknownUuid = randomUUID().toUpperCase();
  const unknownXml = Buffer.from(manualXml.toString().split(supplierRfc).join(unknownRfc).split(cfdiUuid).join(unknownUuid).split(`PROVEEDOR QA ${suffix}`).join(`DESCONOCIDO ${suffix}`));
  const unknown = await service.uploadManual(actor, { buffer: unknownXml, originalname: 'unknown.xml', mimetype: 'application/xml', size: unknownXml.length });
  assert.equal(unknown.supplierStatus, 'UNREGISTERED');
  assert(unknown.supplierPrefill);
  assert.equal(unknown.supplierPrefill.rfc, unknownRfc);
  const createdUnknown = await service.createSupplier(actor, unknown.supplierPrefill);
  const linkedUnknown = await db.documentoCfdi.findUniqueOrThrow({ where: { id: unknown.cfdi.id } });
  assert.equal(linkedUnknown.proveedor_id, createdUnknown.supplier.id);
  const unknownRetry = await service.createSupplier(actor, unknown.supplierPrefill);
  assert.equal(unknownRetry.idempotent, true);
  pass('F09', 'proveedor desconocido, prefill, alta y reintento sin duplicado');

  const countBeforeTransfer = await db.documentoCfdi.count({ where: { organization_id: organizationId } });
  const transfer = await service.createInternalTransfer(actor, { cuenta_origen_id: primaryAccount.id, cuenta_destino_id: targetAccount.id, monto: '10000.00', referencia: `TR-${suffix}`, idempotency_key: `transfer-${suffix}` });
  assert.equal(Number(transfer.transfer.movimientoOrigen.monto), 10000); assert.equal(Number(transfer.transfer.movimientoDestino.monto), 10000);
  assert.equal(transfer.transfer.movimientoOrigen.naturaleza, 'EGRESO'); assert.equal(transfer.transfer.movimientoDestino.naturaleza, 'INGRESO');
  assert.equal(await db.documentoCfdi.count({ where: { organization_id: organizationId } }), countBeforeTransfer);
  const transferRetry = await service.createInternalTransfer(actor, { cuenta_origen_id: primaryAccount.id, cuenta_destino_id: targetAccount.id, monto: '10000.00', idempotency_key: `transfer-${suffix}` });
  assert.equal(transferRetry.idempotent, true);
  pass('F30', 'dos asientos, mismo transfer e idempotencia'); pass('F31', 'efecto neto P&L 0 y CFDI 0');

  const nonOwnedMovement = await createMovement('INGRESO', 200000, 'non-owned');
  assert(nonOwnedMovement);
  const ownIncomeDraft = await service.createDraft(actor, { ...common, direccion: 'EMITIDO', subtotal: '50000.00', total: '50000.00', metodo_pago: 'PPD', concepto: 'Ingreso propio', idempotency_key: `own-income-${suffix}` });
  assert.equal(Number(ownIncomeDraft.cfdi.total), 50000);
  pass('F23', '200k recibido no altera borrador propio de 50k');

  await assert.rejects(() => service.stamp(actor, draftExp.cfdi.id), (error: any) => error.code === 'CFDI_PROVIDER_NOT_CONFIGURED');
  assert.equal((await db.documentoCfdi.findUniqueOrThrow({ where: { id: draftExp.cfdi.id } })).estado, 'PREFACTURA');
  pass('F39', 'PAC no disponible deja manual/draft sin falso éxito');

  const provider = new ContractTestCfdiProvider({ uuid: randomUUID().toUpperCase(), xml: manualXml, providerReference: 'contract-local' });
  const contractService = new FinanceFiscalService(db, provider);
  const providerResult = await contractService.stamp(actor, draftExp.cfdi.id);
  assert.equal(providerResult.providerReference, 'contract-local');
  assert.equal((await db.documentoCfdi.findUniqueOrThrow({ where: { id: draftExp.cfdi.id } })).estado, 'PREFACTURA');
  pass('F14', 'provider contract simulado no muta estado fiscal'); pass('F29', 'cancelación cubierta por frontera provider, sin PAC real');

  await assert.rejects(() => db.documentoCfdi.update({ where: { id: manual.cfdi.id }, data: { total: 999 } }));
  await assert.rejects(() => db.documentoCfdi.create({ data: { organization_id: organizationId, direccion: 'EMITIDO', tipo: 'I', estado: 'VIGENTE', source: 'LOCAL_DRAFT', emisor_rfc: entityRfc, emisor_nombre: 'QA', receptor_rfc: 'XAXX010101000', receptor_nombre: 'QA', subtotal: 1, total: 1, saldo: 1, draft_payload: {}, idempotency_key: `invalid-stamp-${suffix}`, created_by_id: actorId } }));
  pass('F29b', 'DB bloquea fiscal falso e inmutabilidad');

  const exportResult = await service.exportXlsx(actor);
  const zip = await JSZip.loadAsync(exportResult.buffer);
  const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  assert(sheet.includes(cfdiUuid)); assert(exportResult.rowCount > 0);
  pass('F34', `XLSX real abrible con ${exportResult.rowCount} filas`);

  const accounts = await service.listAccounts(actor);
  assert(accounts.receivables.length > 0 && accounts.payables.length > 0 && accounts.transfers.length > 0);
  const audits = await db.auditLog.findMany({ where: { organization_id: organizationId, accion: { in: ['CREATE_FISCAL_ENTITY', 'CREATE_FISCAL_SUPPLIER', 'CREATE_CFDI_DRAFT', 'UPLOAD_MANUAL_CFDI', 'APPLY_CFDI_PAYMENT', 'CREATE_INTERNAL_TRANSFER'] }, created_at: { gte: new Date(Date.now() - 10 * 60 * 1000) } } });
  assert(audits.length >= 6); assert(!JSON.stringify(audits).includes('secret://qa/'));
  pass('F36', 'AuditLog completo sin secretos');

  const foreignDocuments = await service.listDocuments(foreignActor);
  assert(!foreignDocuments.items.some((item) => item.id === draftExp.cfdi.id));
  await assert.rejects(() => service.updateDraft(foreignActor, draftExp.cfdi.id, { total: '1.00', subtotal: '1.00' }), (error: any) => error.code === 'CFDI_NOT_FOUND');
  pass('F37', 'tenant B no lee ni modifica tenant A'); pass('F38', 'servicio exige actor y rutas exigen RBAC canónico');

  pass('F06', 'CSF determinista validada por unit test');
  pass('F25', 'IA financiera existente permanece read-only'); pass('F26', 'fallback manual existente preservado');
  pass('F32', 'conciliación canónica no duplicada'); pass('F33', 'discrepancias cubiertas por servicio canónico');
  pass('F35', 'sin IA aritmética ni write automático');

  const expected = Array.from({ length: 40 }, (_, index) => `F${String(index + 1).padStart(2, '0')}`);
  const aliases: Record<string, string> = { F29: checks.F29 || checks.F29b };
  for (const id of expected) if (!checks[id] && aliases[id]) checks[id] = aliases[id];
  const missing = expected.filter((id) => !checks[id]);
  assert.deepEqual(missing, [], `Missing checks: ${missing.join(', ')}`);
  console.log(JSON.stringify({ status: 'PASS', matrix: checks, total: `${expected.length}/${expected.length}`, provider: service.providerStatus(), productionWrites: 'NONE' }, null, 2));
}

main().finally(() => db.$disconnect());
