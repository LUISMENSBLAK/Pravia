import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { FinanceFiscalService } from '../services/financeFiscal.service';
import { downloadFile, uploadFile } from '../storage/storage.service';
import { runWithActorContext } from '../auth/actorContext';
import { fiscalCsfSynthetic } from '../fixtures/fiscalCsf.synthetic';

const enabled = process.env.PREFACTURA_PDF_QA === '1';
const qaUrl = process.env.PREFACTURA_PDF_QA_DATABASE_URL || '';
if (enabled) {
  const parsed = new URL(qaUrl);
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55439' || parsed.pathname !== '/postgres' || parsed.searchParams.get('schema') !== 'pravia_os' ||
      process.env.STORAGE_MODE !== 'local' || process.env.PRAVIA_DATABASE_MODE !== 'local') {
    throw new Error('Prefactura PDF integration requires the isolated local PostgreSQL and Storage QA environment.');
  }
}

describe.runIf(enabled)('prefactura PDF física · PostgreSQL + Storage local aislados', () => {
  it('crea borrador, conserva v1/v2, bytes/SHA, idempotencia y aislamiento', async () => {
    const db = new PrismaClient({ datasources: { db: { url: qaUrl } } });
    const service = new FinanceFiscalService(db);
    const suffix = randomUUID();
    const user = await db.user.create({ data: { email: `fiscal-pdf-${suffix}@pravia.test`, password_hash: 'LOCAL_QA_NO_LOGIN', nombre: 'QA', apellido: 'Prefactura', rol: 'DIRECCION' } });
    const org = await db.organization.create({ data: { name: `QA prefactura ${suffix}` } });
    await db.organizationMembership.create({ data: { organization_id: org.id, user_id: user.id, rol: 'DIRECCION' } });
    await db.tenantEntitlement.create({ data: { organization_id: org.id, included_storage_bytes: 1024n * 1024n,
      total_storage_capacity_bytes: 1024n * 1024n } });
    await db.tenantStorageUsage.create({ data: { organization_id: org.id } });
    const actor = { id: user.id, organizationId: org.id, rol: 'DIRECCION' as const, permissions: ['finanzas.write', 'documentos.write', 'documentos.read'] };
    const asActor = <T>(work: () => T) => runWithActorContext({ userId: user.id, organizationId: org.id,
      membershipId: 'QA', sessionId: 'QA', role: 'DIRECCION', permissions: ['finanzas.write', 'documentos.write', 'documentos.read'], scope: 'GLOBAL' }, work);
    const entity = await db.entidadFiscalCfdi.create({ data: { organization_id: org.id, created_by_id: user.id,
      razon_social: 'EMISOR SINTETICO QA', rfc: 'AAA010101AAA', regimen_fiscal: '601', codigo_postal: '63735' } });
    const fiscalConcept = await db.conceptoFiscalCfdi.create({ data: { organization_id: org.id,
      entidad_fiscal_id: entity.id, created_by_id: user.id, descripcion: 'Honorarios sintéticos de prueba',
      clave_prod_serv: '80121700', clave_unidad: 'E48', objeto_impuesto: '01', iva_tasa: 0,
      iva_retencion_tasa: 0, isr_retencion_tasa: 0 } });
    try {
      const csfPdf = await PDFDocument.create();
      const csfFont = await csfPdf.embedFont(StandardFonts.Helvetica);
      const csfPage = csfPdf.addPage([612, 792]);
      fiscalCsfSynthetic.physicalMultiple.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split('\n')
        .forEach((line, index) => csfPage.drawText(line.replace(/—/g, '-'), {
          x: 32, y: 740 - index * 30, size: 13, font: csfFont,
        }));
      const csfBytes = Buffer.from(await csfPdf.save());
      const csfFile = { buffer: csfBytes, originalname: 'CSF_SINTETICA_SIN_VALIDEZ_FISCAL.pdf',
        mimetype: 'application/pdf', size: csfBytes.length };
      const csfSha = createHash('sha256').update(csfBytes).digest('hex');
      const supplierInput = { rfc: 'QAFA010101QA1', razon_social: 'PERSONA FISICA SINTETICA',
        codigo_postal: '63735', regimen_fiscal: '901',
        regimenes_fiscales: [{ clave: '901', descripcion: 'REGIMEN SINTETICO A' }],
        csf_reviewed: true, csf_sha256: csfSha };
      await expect(asActor(() => service.createSupplier(actor, { ...supplierInput, csf_sha256: 'otro-archivo' }, undefined, csfFile)))
        .rejects.toMatchObject({ code: 'CFDI_CSF_FILE_CHANGED' });
      await expect(asActor(() => service.createSupplier(actor, { ...supplierInput,
        regimen_fiscal: '904', regimenes_fiscales: [{ clave: '904', descripcion: 'CLAVE NO PRESENTE' }] }, undefined, csfFile)))
        .rejects.toMatchObject({ code: 'CFDI_CSF_REGIME_UNVERIFIED' });
      expect(await db.proveedorFiscal.count({ where: { organization_id: org.id } })).toBe(0);
      const supplier = await asActor(() => service.createSupplier(actor, supplierInput, undefined, csfFile));
      expect(supplier.idempotent).toBe(false);
      const storedSupplier = await db.proveedorFiscal.findUniqueOrThrow({ where: { id: supplier.supplier.id } });
      expect(storedSupplier.regimenes_fiscales).toMatchObject([{ clave: '901' }, { clave: '902' }]);
      expect(storedSupplier.csf_extraction).toMatchObject({ sha256: csfSha,
        source: 'DETERMINISTIC_PDF_TEXT', extraction_status: 'EXTRACTED', confirmation_status: 'CONFIRMED',
        confirmed: { regimen_fiscal: '901' }, detected: { regimenes_fiscales: [{ clave: '901' }, { clave: '902' }],
          regimenes_documentales: [] }, source_pages: { rfc: 1, regimenes_documentales: [] } });
      const csfOriginal = await db.documento.findUniqueOrThrow({ where: { id: storedSupplier.csf_documento_id! } });
      expect(csfOriginal.checksum_sha256).toBe(csfSha);
      expect((await downloadFile(csfOriginal.storage_key)).equals(csfBytes)).toBe(true);
      const csfLink = await asActor(() => service.supplierCsfUrl(actor, supplier.supplier.id));
      expect(csfLink).toMatchObject({ sha256: csfSha, sizeBytes: csfBytes.length,
        filename: 'CSF_SINTETICA_SIN_VALIDEZ_FISCAL.pdf', mimeType: 'application/pdf' });
      expect(csfLink.url).toContain('/api/storage/local?');
      expect(await db.auditLog.count({ where: { organization_id: org.id,
        accion: 'VIEW_FISCAL_SUPPLIER_CSF', entidad_id: csfOriginal.id } })).toBe(1);
      expect(await service.listSuppliers({ ...actor, organizationId: randomUUID() })).toEqual([]);
      await expect(service.supplierCsfUrl({ ...actor, organizationId: randomUUID() }, supplier.supplier.id))
        .rejects.toMatchObject({ status: 404 });
      await expect(service.supplierCsfUrl({ ...actor, permissions: ['finanzas.write'] }, supplier.supplier.id))
        .rejects.toMatchObject({ status: 403, code: 'CFDI_CSF_READ_DENIED' });
      await asActor(async () => {
      const expedition = await db.expediente.create({ data: { organization_id: org.id,
        numero_pravia: `EXP-QA-${suffix}`, abogado_id: user.id, creador_id: user.id } });
      const receiver = await db.compareciente.create({ data: { organization_id: org.id,
        nombre_busqueda: 'PERSONA FISICA SINTETICA', creado_por_id: user.id } });
      const character = await db.caracterCompareciente.findFirstOrThrow({ where: { activo: true } });
      const receiverLink = await db.expedienteCompareciente.create({ data: { organization_id: org.id,
        expediente_id: expedition.id, compareciente_id: receiver.id, caracter_id: character.id,
        creado_por_id: user.id } });
      const income = await db.expedienteIngresoReportado.create({ data: { organization_id: org.id,
        expediente_id: expedition.id, reportado_por_id: user.id, idempotency_key: randomUUID(),
        monto_reportado: '100.00', factura_estado: 'PENDIENTE', facturar_a_vinculo_id: receiverLink.id,
        facturar_a_compareciente_id: receiver.id } });
      const receiverCsfKey = `organizations/${org.id}/fiscal-qa/${randomUUID()}.pdf`;
      await uploadFile(csfBytes, receiverCsfKey, 'application/pdf');
      const receiverDocument = await db.documento.create({ data: { organization_id: org.id,
        nombre_original: 'CSF_SINTETICA_SIN_VALIDEZ_FISCAL.pdf', nombre_interno: receiverCsfKey,
        tipo: 'CONSTANCIA_FISCAL', categoria: 'OTROS', storage_key: receiverCsfKey,
        mime_type: 'application/pdf', size_bytes: csfBytes.length, checksum_sha256: csfSha,
        subido_por_id: user.id, compareciente_id: receiver.id } });
      await db.comparecienteDocumento.create({ data: { organization_id: org.id,
        compareciente_id: receiver.id, documento_id: receiverDocument.id,
        categoria: 'CONSTANCIA_FISCAL', creado_por_id: user.id } });
      const incompleteKey = randomUUID();
      const incompleteIncomeInput = { direccion: 'EMITIDO', tipo: 'I', allow_incomplete: true,
        expediente_id: expedition.id, ingreso_reportado_id: income.id,
        receptor_compareciente_id: receiver.id, metodo_pago: 'PPD', forma_pago: '99',
        idempotency_key: incompleteKey };
      const zeroDraft = await asActor(() => service.createDraft(actor, incompleteIncomeInput));
      const zeroRetry = await asActor(() => service.createDraft(actor, incompleteIncomeInput));
      expect(zeroRetry.idempotent).toBe(true);
      expect(zeroRetry.cfdi.id).toBe(zeroDraft.cfdi.id);
      expect(zeroDraft.cfdi.total.toFixed(2)).toBe('0.00');
      expect(zeroDraft.cfdi.draft_payload).toMatchObject({ incomplete_income: true, concepts: [] });
      expect(await db.cuentaPorCobrarCfdi.count({ where: { cfdi_id: zeroDraft.cfdi.id } })).toBe(0);
      expect((await service.incomeContext(actor, income.id)).reservedDraftAmount).toBe('0.00');
      await expect(asActor(() => service.generatePrefactura(actor, zeroDraft.cfdi.id, randomUUID())))
        .rejects.toMatchObject({ code: 'CFDI_PDF_FIELDS_MISSING' });
      await expect(asActor(() => service.updateDraft(actor, zeroDraft.cfdi.id,
        { subtotal: '100.00', total: '100.00', conceptos: [{ concepto_fiscal_id: fiscalConcept.id,
          cantidad: '1', valor_unitario: '100.00' }] })))
        .rejects.toMatchObject({ code: 'CFDI_RECEIVER_FISCAL_PROFILE_REQUIRED' });
      const receiverConfirmation = { rfc: 'QAFA010101QA1', razon_social: 'PERSONA FISICA SINTETICA',
        regimen_fiscal: '902', regimenes_fiscales: [{ clave: '902', descripcion: 'REGIMEN SINTETICO B' }],
        codigo_postal: '63735', csf_documento_id: receiverDocument.id, csf_sha256: csfSha };
      await expect(asActor(() => service.confirmIncomeReceiver(actor, income.id, receiver.id,
        { ...receiverConfirmation, csf_sha256: 'otro-hash' })))
        .rejects.toMatchObject({ code: 'CFDI_CSF_FILE_CHANGED' });
      const confirmedReceiver = await asActor(() => service.confirmIncomeReceiver(actor, income.id,
        receiver.id, receiverConfirmation));
      expect(confirmedReceiver.regimenes_fiscales).toMatchObject([{ clave: '902' }, { clave: '901' }]);
      expect(confirmedReceiver.csf_documento_id).toBe(receiverDocument.id);
      expect(confirmedReceiver.csf_extraction).toMatchObject({ sha256: csfSha,
        source: 'DETERMINISTIC_PDF_TEXT', extraction_status: 'EXTRACTED',
        confirmation_status: 'CONFIRMED', detected: { regimenes_fiscales: [{ clave: '901' }, { clave: '902' }],
          regimenes_documentales: [] }, source_pages: { rfc: 1, regimenes_documentales: [] },
        confirmed: { regimen_fiscal: '902', regimenes_fiscales: [{ clave: '902' }, { clave: '901' }] },
      });
      const receiverContext = await service.incomeContext(actor, income.id);
      expect(receiverContext.receivers[0].compareciente.fiscalProfile?.regimenes_fiscales)
        .toMatchObject([{ clave: '902' }, { clave: '901' }]);
      const completedIncomeDraft = await asActor(() => service.updateDraft(actor, zeroDraft.cfdi.id, {
        entidad_fiscal_id: entity.id, receptor_regimen: '901', uso_cfdi: 'G03',
        subtotal: '100.00', impuestos_trasladados: '0.00', impuestos_retenidos: '0.00', total: '100.00',
        conceptos: [{ concepto_fiscal_id: fiscalConcept.id, cantidad: '1', valor_unitario: '100.00' }],
        metodo_pago: 'PPD', forma_pago: '99', lugar_expedicion: '63735',
      }));
      expect(completedIncomeDraft.draft_payload).toMatchObject({ incomplete_income: false });
      expect(completedIncomeDraft.receptor_rfc).toBe('QAFA010101QA1');
      expect(completedIncomeDraft.emisor_rfc).toBe('AAA010101AAA');
      expect((await service.incomeContext(actor, income.id)).reservedDraftAmount).toBe('100.00');
      await asActor(() => service.deleteDraft(actor, zeroDraft.cfdi.id));
      expect((await service.incomeContext(actor, income.id)).reservedDraftAmount).toBe('0.00');
      const incomeDraftInput = { direccion: 'EMITIDO', tipo: 'I', entidad_fiscal_id: entity.id,
        expediente_id: expedition.id, ingreso_reportado_id: income.id,
        receptor_compareciente_id: receiver.id, subtotal: '100.00', total: '100.00',
        impuestos_trasladados: '0.00', impuestos_retenidos: '0.00',
        metodo_pago: 'PPD', forma_pago: '99', moneda: 'MXN',
        conceptos: [{ concepto_fiscal_id: fiscalConcept.id, cantidad: '1', valor_unitario: '100.00' }],
        idempotency_key: randomUUID() };
      await expect(asActor(() => service.createDraft(actor, incomeDraftInput)))
        .rejects.toMatchObject({ code: 'CFDI_RECEIVER_REGIME_SELECTION_REQUIRED' });
      await expect(asActor(() => service.createDraft(actor,
        { ...incomeDraftInput, receptor_regimen: '999' })))
        .rejects.toMatchObject({ code: 'CFDI_RECEIVER_REGIME_SELECTION_REQUIRED' });
      const chosenDraft = await asActor(() => service.createDraft(actor,
        { ...incomeDraftInput, receptor_regimen: '901' }));
      expect(chosenDraft.cfdi.receptor_regimen).toBe('901');
      await expect(asActor(() => service.updateDraft(actor, chosenDraft.cfdi.id,
        { receptor_regimen: '999' }))).rejects.toMatchObject({ code: 'CFDI_RECEIVER_REGIME_SELECTION_REQUIRED' });
      const reselectedDraft = await asActor(() => service.updateDraft(actor, chosenDraft.cfdi.id,
        { receptor_regimen: '902' }));
      expect(reselectedDraft.receptor_regimen).toBe('902');
      expect((await service.incomeContext(actor, income.id)).documents[0].receptor_regimen).toBe('902');
      expect((await db.comparecienteFiscalProfile.findUniqueOrThrow({ where: {
        compareciente_id_organization_id: { compareciente_id: receiver.id, organization_id: org.id },
      } })).regimenes_fiscales).toMatchObject([{ clave: '902' }, { clave: '901' }]);
      });
      const incomplete = await service.createDraft(actor, { direccion: 'EMITIDO', tipo: 'I', allow_incomplete: true,
        idempotency_key: randomUUID() });
      expect(incomplete.cfdi.total.toFixed(2)).toBe('0.00');
      expect(incomplete.cfdi.estado).toBe('DRAFT');
      expect(await db.cuentaPorCobrarCfdi.count({ where: { cfdi_id: incomplete.cfdi.id } })).toBe(0);
      await expect(asActor(() => service.generatePrefactura(actor, incomplete.cfdi.id, randomUUID())))
        .rejects.toMatchObject({ code: 'CFDI_PDF_FIELDS_MISSING' });
      const currencyPending = await service.createDraft(actor, { direccion: 'EMITIDO', tipo: 'I', allow_incomplete: true,
        moneda: 'USD', idempotency_key: randomUUID() });
      expect(currencyPending.cfdi.moneda).toBe('USD');
      expect(currencyPending.cfdi.total.toFixed(2)).toBe('0.00');
      expect((currencyPending.cfdi.draft_payload as { fiscal_comprobante: { tipo_cambio: string | null } }).fiscal_comprobante.tipo_cambio).toBeNull();
      await expect(asActor(() => service.generatePrefactura(actor, currencyPending.cfdi.id, randomUUID())))
        .rejects.toMatchObject({ code: 'CFDI_PDF_FIELDS_MISSING' });
      const currencyCompleted = await service.updateDraft(actor, currencyPending.cfdi.id,
        { tipo_cambio: '17.123456' });
      expect((currencyCompleted.draft_payload as { fiscal_comprobante: { tipo_cambio: string | null } }).fiscal_comprobante.tipo_cambio).toBe('17.123456');
      const completed = await service.updateDraft(actor, incomplete.cfdi.id, { entidad_fiscal_id: entity.id,
        receptor_rfc: 'BBB010101BBB', receptor_nombre: 'RECEPTOR SINTETICO QA', receptor_regimen: '612',
        receptor_codigo_postal: '63736', uso_cfdi: 'G03', metodo_pago: 'PPD', forma_pago: '99',
        lugar_expedicion: '63735', subtotal: '8000.00', impuestos_trasladados: '0.00',
        impuestos_retenidos: '0.00', total: '8000.00', conceptos: [{ concepto_fiscal_id: fiscalConcept.id,
          cantidad: '1', valor_unitario: '8000.00' }] });
      expect(completed.receptor_nombre).toBe('RECEPTOR SINTETICO QA');
      expect(await db.cuentaPorCobrarCfdi.count({ where: { cfdi_id: incomplete.cfdi.id } })).toBe(1);
      expect((await asActor(() => service.generatePrefactura(actor, incomplete.cfdi.id, randomUUID()))).representation.version).toBe(1);
      await expect(service.createDraft(actor, { direccion: 'EMITIDO', tipo: 'I', entidad_fiscal_id: entity.id,
        receptor_rfc: 'BBB010101BBB', receptor_nombre: 'RECEPTOR SINTETICO QA',
        subtotal: '100.00', total: '100.00', conceptos: [{ descripcion: 'Clave enviada por cliente',
          clave_prod_serv: '80121700', clave_unidad: 'E48', cantidad: '1', valor_unitario: '100.00' }],
        idempotency_key: randomUUID() })).rejects.toMatchObject({ code: 'CFDI_CONCEPT_ID_INVALID' });
      const created = await service.createDraft(actor, {
        direccion: 'EMITIDO', tipo: 'I', entidad_fiscal_id: entity.id, receptor_rfc: 'BBB010101BBB',
        receptor_nombre: 'RECEPTOR SINTETICO QA', receptor_regimen: '612', receptor_codigo_postal: '63736',
        uso_cfdi: 'G03', metodo_pago: 'PPD', forma_pago: '99', moneda: 'MXN', lugar_expedicion: '63735',
        subtotal: '8000.00', impuestos_trasladados: '0.00', impuestos_retenidos: '0.00', total: '8000.00',
        concepto: 'Honorarios QA', conceptos: [{ concepto_fiscal_id: fiscalConcept.id, cantidad: '1', valor_unitario: '8000.00' }],
        idempotency_key: randomUUID(),
      });
      expect(created.cfdi.estado).toBe('DRAFT');
      expect(created.cfdi.internal_folio).toMatch(/^FAC-BOR-\d+$/);
      const firstKey = randomUUID();
      const [first, retry] = await asActor(() => Promise.all([service.generatePrefactura(actor, created.cfdi.id, firstKey), service.generatePrefactura(actor, created.cfdi.id, firstKey)]));
      expect(first.representation.id).toBe(retry.representation.id);
      expect([first.idempotent, retry.idempotent].sort()).toEqual([false, true]);
      const firstRow = await db.prefacturaRepresentacion.findFirstOrThrow({ where: { organization_id: org.id, cfdi_id: created.cfdi.id, version: 1 }, include: { documento: true } });
      const firstBytes = await downloadFile(firstRow.documento.storage_key);
      expect(firstBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect((await PDFDocument.load(firstBytes)).getPageCount()).toBeGreaterThan(0);
      expect(createHash('sha256').update(firstBytes).digest('hex')).toBe(firstRow.pdf_sha256);
      expect(firstRow.documento.checksum_sha256).toBe(firstRow.pdf_sha256);
      expect(firstRow.size_bytes).toBe(firstBytes.length);
      await service.updateDraft(actor, created.cfdi.id, { receptor_nombre: 'RECEPTOR CORREGIDO SINTETICO QA' });
      const second = await asActor(() => service.generatePrefactura(actor, created.cfdi.id, randomUUID()));
      expect(second.representation.version).toBe(2);
      const secondRow = await db.prefacturaRepresentacion.findFirstOrThrow({ where: { organization_id: org.id, cfdi_id: created.cfdi.id, version: 2 }, include: { documento: true } });
      expect(firstRow.snapshot).toMatchObject({ receiver: { name: 'RECEPTOR SINTETICO QA' } });
      expect(secondRow.snapshot).toMatchObject({ receiver: { name: 'RECEPTOR CORREGIDO SINTETICO QA' } });
      const secondBytes = await downloadFile(secondRow.documento.storage_key);
      const firstParser = new PDFParse({ data: firstBytes });
      const secondParser = new PDFParse({ data: secondBytes });
      try {
        expect((await firstParser.getText()).text).toContain('RECEPTOR SINTETICO QA');
        expect((await firstParser.getText()).text).not.toContain('RECEPTOR CORREGIDO SINTETICO QA');
        expect((await secondParser.getText()).text).toContain('RECEPTOR CORREGIDO SINTETICO QA');
      } finally { await firstParser.destroy(); await secondParser.destroy(); }
      const history = await service.prefacturaVersions(actor, created.cfdi.id);
      expect(history.versions.map((item) => item.version)).toEqual([2, 1]);
      const firstStill = await downloadFile(firstRow.documento.storage_key);
      expect(firstStill.equals(firstBytes)).toBe(true);
      const updated = await db.documentoCfdi.findUniqueOrThrow({ where: { id: created.cfdi.id } });
      expect(updated.estado).toBe('PREFACTURA');
      expect(updated.internal_folio).toBe(created.cfdi.internal_folio);
      expect(updated.uuid_fiscal).toBeNull();
      expect(updated.xml_documento_id).toBeNull();
      for (const [currency, rate, equivalent] of [['USD', '17.000000', '1700.00'], ['CAD', '12.500000', '1250.00']] as const) {
        const currencyDraft = await service.createDraft(actor, {
          direccion: 'EMITIDO', tipo: 'I', entidad_fiscal_id: entity.id,
          receptor_rfc: 'BBB010101BBB', receptor_nombre: `RECEPTOR ${currency} SINTETICO QA`,
          receptor_regimen: '612', receptor_codigo_postal: '63736', uso_cfdi: 'G03',
          metodo_pago: 'PUE', forma_pago: '03', moneda: currency, tipo_cambio: rate,
          lugar_expedicion: '63735', subtotal: '100.00', impuestos_trasladados: '0.00',
          impuestos_retenidos: '0.00', total: '100.00',
          conceptos: [{ concepto_fiscal_id: fiscalConcept.id, cantidad: '1', valor_unitario: '100.00' }],
          idempotency_key: randomUUID(),
        });
        await asActor(() => service.generatePrefactura(actor, currencyDraft.cfdi.id, randomUUID()));
        const row = await db.prefacturaRepresentacion.findFirstOrThrow({ where: {
          organization_id: org.id, cfdi_id: currencyDraft.cfdi.id, version: 1,
        }, include: { documento: true } });
        expect(row.snapshot).toMatchObject({ currency, exchange_rate: rate, equivalent_mxn: equivalent,
          amounts: { total: '100.00' } });
        const bytes = await downloadFile(row.documento.storage_key);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.pdf_sha256);
        const parser = new PDFParse({ data: bytes });
        try {
          const content = (await parser.getText()).text;
          expect(content).toContain(currency);
          expect(content).toContain(rate);
          expect(content).toContain('100.00 ' + currency);
          expect(content).toContain(Number(equivalent).toLocaleString('es-MX', { minimumFractionDigits: 2 }) + ' MXN');
        } finally { await parser.destroy(); }
      }
      await expect(service.prefacturaVersions({ ...actor, organizationId: randomUUID() }, created.cfdi.id)).rejects.toMatchObject({ status: 404 });
      await expect(service.prefacturaVersionUrl({ ...actor, organizationId: randomUUID() }, created.cfdi.id, 1)).rejects.toMatchObject({ status: 404 });
    } finally { await db.$disconnect(); }
  }, 30000);
});
