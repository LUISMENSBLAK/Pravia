import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { PDFParse } from 'pdf-parse';
import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { FinanceFiscalService } from '../services/financeFiscal.service';
import { downloadFile, uploadFile } from '../storage/storage.service';
import { runWithActorContext } from '../auth/actorContext';
import { fiscalCsfSynthetic } from '../fixtures/fiscalCsf.synthetic';

const enabled = process.env.PREFACTURA_PDF_QA === '1';
const qaUrl = process.env.PREFACTURA_PDF_QA_DATABASE_URL || '';
const qaPdfText = (storageKey: string, fallback: string) => process.env.PDFTOTEXT_BIN
  ? execFileSync(process.env.PDFTOTEXT_BIN, ['-layout', path.join(process.env.LOCAL_STORAGE_PATH || '', storageKey), '-'], { encoding: 'utf8' })
  : fallback;
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
    const actor = { id: user.id, organizationId: org.id, rol: 'DIRECCION' as const, permissions: ['finanzas.write', 'finanzas.validate', 'documentos.write', 'documentos.read', 'configuracion.plantillas_formatos.manage'] };
    const asActor = <T>(work: () => T) => runWithActorContext({ userId: user.id, organizationId: org.id,
      membershipId: 'QA', sessionId: 'QA', role: 'DIRECCION', permissions: ['finanzas.write', 'finanzas.validate', 'documentos.write', 'documentos.read', 'configuracion.plantillas_formatos.manage'], scope: 'GLOBAL' }, work);
    const entity = await db.entidadFiscalCfdi.create({ data: { organization_id: org.id, created_by_id: user.id,
      razon_social: 'EMISOR SINTETICO QA', rfc: 'AAA010101AAA', regimen_fiscal: '601', codigo_postal: '63735' } });
    const sourceWord = await readFile(path.resolve(__dirname, '../../assets/fiscal/Factura_PRAVIA.docx'));
    const templateKey = `organizations/${org.id}/catalogos/plantillas-formatos/${randomUUID()}_Factura_PRAVIA.docx`;
    await asActor(() => uploadFile(sourceWord, templateKey, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    const templateArtifact = await asActor(() => db.catalogoArtefacto.create({ data: { organization_id: org.id,
      tipo: 'PLANTILLA', propietario_tipo: 'ORGANIZACION', nombre: 'Factura PRAVIA · cliente',
      creado_por_id: user.id, actualizado_por_id: user.id } }));
    const templateVersion = await asActor(() => db.catalogoArtefactoVersion.create({ data: { organization_id: org.id,
      artefacto_id: templateArtifact.id, version: 1, nombre_original: 'Factura_PRAVIA.docx',
      storage_key: templateKey, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: sourceWord.length, checksum_sha256: createHash('sha256').update(sourceWord).digest('hex'),
      origen: 'CARGA_USUARIO', creado_por_id: user.id } }));
    await expect(asActor(() => service.updateEntity({ ...actor, permissions: ['finanzas.validate'] }, entity.id,
      { plantilla_id: templateVersion.id }))).rejects.toMatchObject({ status: 403, code: 'CFDI_TEMPLATE_MANAGE_DENIED' });
    await expect(asActor(() => service.updateEntity({ ...actor, organizationId: randomUUID() }, entity.id,
      { plantilla_id: templateVersion.id }))).rejects.toMatchObject({ status: 422, code: 'CFDI_TEMPLATE_INVALID' });
    await asActor(() => service.updateEntity(actor, entity.id, { plantilla_id: templateVersion.id }));
    expect((await asActor(() => service.listInvoiceTemplates(actor))).map((item) => item.id)).toContain(templateVersion.id);
    expect((await asActor(() => service.listInvoiceTemplates({ ...actor, organizationId: randomUUID() }))).map((item) => item.id)).not.toContain(templateVersion.id);
    const fiscalConcept = await db.conceptoFiscalCfdi.create({ data: { organization_id: org.id,
      entidad_fiscal_id: entity.id, created_by_id: user.id, descripcion: 'Honorarios sintéticos de prueba',
      clave_prod_serv: '80121700', clave_unidad: 'E48', objeto_impuesto: '01', iva_tasa: 0,
      iva_retencion_tasa: 0, isr_retencion_tasa: 0 } });
      const taxedConcept = await db.conceptoFiscalCfdi.create({ data: { organization_id: org.id,
        entidad_fiscal_id: entity.id, created_by_id: user.id, descripcion: 'Concepto fiscal sintético con IVA configurado',
        clave_prod_serv: '80121700', clave_unidad: 'E48', objeto_impuesto: '02', iva_tasa: 0.16,
        iva_retencion_tasa: 0, isr_retencion_tasa: 0 } });
    try {
      const logoCanvas = createCanvas(64, 64);
      const logoContext = logoCanvas.getContext('2d');
      logoContext.fillStyle = '#123b5d'; logoContext.fillRect(0, 0, 64, 64);
      const logoBytes = await logoCanvas.encode('png');
      const logoFile = { buffer: logoBytes, originalname: 'logo-qa.png', mimetype: 'image/png', size: logoBytes.length };
      await expect(asActor(() => service.uploadEntityLogo({ ...actor, permissions: ['finanzas.write'] }, entity.id, logoFile)))
        .rejects.toMatchObject({ status: 403, code: 'CFDI_LOGO_WRITE_DENIED' });
      await expect(asActor(() => service.uploadEntityLogo({ ...actor, organizationId: randomUUID() }, entity.id, logoFile)))
        .rejects.toMatchObject({ status: 404, code: 'CFDI_ENTITY_NOT_FOUND' });
      const uploadedLogo = await asActor(() => service.uploadEntityLogo(actor, entity.id, logoFile));
      expect(uploadedLogo.sha256).toBe(createHash('sha256').update(logoBytes).digest('hex'));
      expect((await db.entidadFiscalCfdi.findUniqueOrThrow({ where: { id: entity.id } })).logo_documento_id)
        .toBe(uploadedLogo.documentId);
      const logoLink = await asActor(() => service.entityLogoUrl(actor, entity.id));
      expect(logoLink).toMatchObject({ documentId: uploadedLogo.documentId, sha256: uploadedLogo.sha256 });
      await expect(service.entityLogoUrl({ ...actor, organizationId: randomUUID() }, entity.id))
        .rejects.toMatchObject({ status: 404 });
      await expect(service.entityLogoUrl({ ...actor, permissions: ['finanzas.write'] }, entity.id))
        .rejects.toMatchObject({ status: 403, code: 'CFDI_LOGO_READ_DENIED' });
      const csfPdf = await PDFDocument.create();
      const csfFont = await csfPdf.embedFont(StandardFonts.Helvetica);
      const csfPage = csfPdf.addPage([612, 792]);
      fiscalCsfSynthetic.physicalMultiple
        .replace('901 REGIMEN SINTETICO A', '612 Personas Fisicas con Actividades Empresariales y Profesionales')
        .replace('902 REGIMEN SINTETICO B', '626 Regimen Simplificado de Confianza')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').split('\n')
        .forEach((line, index) => csfPage.drawText(line.replace(/—/g, '-'), {
          x: 32, y: 740 - index * 30, size: 13, font: csfFont,
        }));
      const csfBytes = Buffer.from(await csfPdf.save());
      const csfFile = { buffer: csfBytes, originalname: 'CSF_SINTETICA_SIN_VALIDEZ_FISCAL.pdf',
        mimetype: 'application/pdf', size: csfBytes.length };
      const csfSha = createHash('sha256').update(csfBytes).digest('hex');
      const supplierInput = { rfc: 'QAFA010101QA1', razon_social: 'PERSONA FISICA SINTETICA',
        codigo_postal: '63735', regimen_fiscal: '612',
        regimenes_fiscales: [{ clave: '612', descripcion: 'Personas Físicas con Actividades Empresariales y Profesionales' }],
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
      expect(storedSupplier.regimenes_fiscales).toMatchObject([{ clave: '612' }, { clave: '626' }]);
      expect(storedSupplier.csf_extraction).toMatchObject({ sha256: csfSha,
        source: 'DETERMINISTIC_PDF_TEXT', extraction_status: 'EXTRACTED', confirmation_status: 'CONFIRMED',
        confirmed: { regimen_fiscal: '612' }, detected: { regimenes_fiscales: [{ clave: '612' }, { clave: '626' }],
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
        regimen_fiscal: '626', regimenes_fiscales: [{ clave: '626', descripcion: 'Régimen Simplificado de Confianza' }],
        codigo_postal: '63735', csf_documento_id: receiverDocument.id, csf_sha256: csfSha };
      await expect(asActor(() => service.confirmIncomeReceiver(actor, income.id, receiver.id,
        { ...receiverConfirmation, csf_sha256: 'otro-hash' })))
        .rejects.toMatchObject({ code: 'CFDI_CSF_FILE_CHANGED' });
      await expect(asActor(() => service.confirmIncomeReceiver(actor, income.id, receiver.id,
        { ...receiverConfirmation, regimen_fiscal: '999',
          regimenes_fiscales: [{ clave: '999', descripcion: 'Clave inexistente QA' }] })))
        .rejects.toMatchObject({ status: 422, code: 'CFDI_REGIME_INVALID' });
      await expect(asActor(() => service.confirmIncomeReceiver(actor, income.id, receiver.id,
        { ...receiverConfirmation, regimen_fiscal: '601',
          regimenes_fiscales: [{ clave: '601', descripcion: 'Persona moral QA' }] })))
        .rejects.toMatchObject({ status: 422, code: 'CFDI_REGIME_INVALID' });
      const confirmedReceiver = await asActor(() => service.confirmIncomeReceiver(actor, income.id,
        receiver.id, receiverConfirmation));
      expect(confirmedReceiver.regimenes_fiscales).toMatchObject([{ clave: '626' }, { clave: '612' }]);
      expect(confirmedReceiver.csf_documento_id).toBe(receiverDocument.id);
      expect(confirmedReceiver.csf_extraction).toMatchObject({ sha256: csfSha,
        source: 'DETERMINISTIC_PDF_TEXT', extraction_status: 'EXTRACTED',
        confirmation_status: 'CONFIRMED', detected: { regimenes_fiscales: [{ clave: '612' }, { clave: '626' }],
          regimenes_documentales: [] }, source_pages: { rfc: 1, regimenes_documentales: [] },
        confirmed: { regimen_fiscal: '626', regimenes_fiscales: [{ clave: '626' }, { clave: '612' }] },
      });
      const correctedReceiver = await asActor(() => service.confirmIncomeReceiver(actor, income.id,
        receiver.id, { ...receiverConfirmation, codigo_postal: '63736',
          csf_documento_id: undefined, csf_sha256: undefined }));
      expect(correctedReceiver.version).toBe(confirmedReceiver.version + 1);
      expect(correctedReceiver.codigo_postal).toBe('63736');
      expect(correctedReceiver.csf_documento_id).toBe(receiverDocument.id);
      expect(correctedReceiver.csf_extraction).toMatchObject({ sha256: csfSha,
        confirmation_status: 'CORRECTED', corrected_fields: expect.arrayContaining(['codigo_postal']) });
      expect(await db.auditLog.count({ where: { organization_id: org.id,
        accion: 'CONFIRM_CFDI_RECEIVER_PROFILE', entidad_id: confirmedReceiver.id } })).toBe(2);
      const correctionAudit = await db.auditLog.findFirstOrThrow({ where: { organization_id: org.id,
        accion: 'CONFIRM_CFDI_RECEIVER_PROFILE', entidad_id: confirmedReceiver.id }, orderBy: { created_at: 'desc' } });
      expect(correctionAudit.user_id).toBe(actor.id);
      expect(correctionAudit.created_at).toBeInstanceOf(Date);
      expect(correctionAudit.valores_anteriores).toMatchObject({ fiscal_profile: {
        razon_social: 'PERSONA FISICA SINTETICA', codigo_postal: '63735',
        csf_documento_id: receiverDocument.id, version: confirmedReceiver.version,
      } });
      expect(correctionAudit.valores_nuevos).toMatchObject({ fiscal_profile: {
        razon_social: 'PERSONA FISICA SINTETICA', codigo_postal: '63736',
        csf_documento_id: receiverDocument.id, version: correctedReceiver.version,
      } });
      const receiverContext = await service.incomeContext(actor, income.id);
      expect(receiverContext.receivers[0].compareciente.fiscalProfile?.regimenes_fiscales)
        .toMatchObject([{ clave: '626' }, { clave: '612' }]);
      const completedIncomeDraft = await asActor(() => service.updateDraft(actor, zeroDraft.cfdi.id, {
        entidad_fiscal_id: entity.id, receptor_regimen: '612', uso_cfdi: 'G03',
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
        { ...incomeDraftInput, receptor_regimen: '612' }));
      expect(chosenDraft.cfdi.receptor_regimen).toBe('612');
      await expect(asActor(() => service.updateDraft(actor, chosenDraft.cfdi.id,
        { receptor_regimen: '999' }))).rejects.toMatchObject({ code: 'CFDI_RECEIVER_REGIME_SELECTION_REQUIRED' });
      const reselectedDraft = await asActor(() => service.updateDraft(actor, chosenDraft.cfdi.id,
        { receptor_regimen: '626' }));
      expect(reselectedDraft.receptor_regimen).toBe('626');
      expect((await service.incomeContext(actor, income.id)).documents[0].receptor_regimen).toBe('626');
      expect((await db.comparecienteFiscalProfile.findUniqueOrThrow({ where: {
        compareciente_id_organization_id: { compareciente_id: receiver.id, organization_id: org.id },
      } })).regimenes_fiscales).toMatchObject([{ clave: '626' }, { clave: '612' }]);
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
        receptor_rfc: 'BBBA010101BBB', receptor_nombre: 'RECEPTOR SINTETICO QA', receptor_regimen: '612',
        receptor_codigo_postal: '63736', uso_cfdi: 'G03', metodo_pago: 'PPD', forma_pago: '99',
        lugar_expedicion: '63735', subtotal: '8000.00', impuestos_trasladados: '0.00',
        impuestos_retenidos: '0.00', total: '8000.00', conceptos: [{ concepto_fiscal_id: fiscalConcept.id,
          cantidad: '1', valor_unitario: '8000.00' }] });
      expect(completed.receptor_nombre).toBe('RECEPTOR SINTETICO QA');
      expect(await db.cuentaPorCobrarCfdi.count({ where: { cfdi_id: incomplete.cfdi.id } })).toBe(1);
      expect((await asActor(() => service.generatePrefactura(actor, incomplete.cfdi.id, randomUUID()))).representation.version).toBe(1);
      await expect(service.createDraft(actor, { direccion: 'EMITIDO', tipo: 'I', entidad_fiscal_id: entity.id,
        receptor_rfc: 'BBBA010101BBB', receptor_nombre: 'RECEPTOR SINTETICO QA',
        subtotal: '100.00', total: '100.00', conceptos: [{ descripcion: 'Clave enviada por cliente',
          clave_prod_serv: '80121700', clave_unidad: 'E48', cantidad: '1', valor_unitario: '100.00' }],
        idempotency_key: randomUUID() })).rejects.toMatchObject({ code: 'CFDI_CONCEPT_ID_INVALID' });
      const created = await service.createDraft(actor, {
        direccion: 'EMITIDO', tipo: 'I', entidad_fiscal_id: entity.id, receptor_rfc: 'BBBA010101BBB',
        receptor_nombre: 'RECEPTOR SINTETICO QA', receptor_regimen: '612', receptor_codigo_postal: '63736',
        uso_cfdi: 'G03', metodo_pago: 'PPD', forma_pago: '99', moneda: 'MXN', lugar_expedicion: '63735',
        subtotal: '8000.00', impuestos_trasladados: '0.00', impuestos_retenidos: '0.00', total: '8000.00',
        concepto: 'Honorarios QA', conceptos: [{ concepto_fiscal_id: fiscalConcept.id,
          descripcion: 'EXP-QA-001 Honorarios de este expediente', cantidad: '1', valor_unitario: '8000.00' }],
        idempotency_key: randomUUID(),
      });
      await expect(service.updateDraft(actor, created.cfdi.id, { uso_cfdi: 'ZZZ' }))
        .rejects.toMatchObject({ code: 'CFDI_USE_INVALID', status: 422 });
      await expect(service.updateDraft(actor, created.cfdi.id, { receptor_regimen: '605' }))
        .rejects.toMatchObject({ code: 'CFDI_USE_REGIME_INCOMPATIBLE', status: 422 });
      expect((await db.documentoCfdi.findUniqueOrThrow({ where: { id: created.cfdi.id } })).uso_cfdi).toBe('G03');
      expect(created.cfdi.estado).toBe('DRAFT');
      expect(created.cfdi.internal_folio).toMatch(/^FAC-BOR-\d+$/);
      expect(created.cfdi.draft_payload).toMatchObject({ concepts: [{
        descripcion: 'EXP-QA-001 Honorarios de este expediente', clave_prod_serv: fiscalConcept.clave_prod_serv,
      }] });
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
      expect(firstRow.snapshot).toMatchObject({ concepts: [{ description: 'EXP-QA-001 Honorarios de este expediente' }] });
      expect(firstRow.snapshot).toMatchObject({ logo: { source: 'ENTITY', sha256: uploadedLogo.sha256, document_id: uploadedLogo.documentId } });
      expect(firstRow.size_bytes).toBe(firstBytes.length);
      const taxedDraft = await service.createDraft(actor, {
        direccion: 'EMITIDO', tipo: 'I', entidad_fiscal_id: entity.id,
        receptor_rfc: 'BBBA010101BBB', receptor_nombre: 'RECEPTOR SINTETICO QA',
        receptor_regimen: '612', receptor_codigo_postal: '63736', uso_cfdi: 'G03',
        metodo_pago: 'PPD', forma_pago: '99', moneda: 'MXN', lugar_expedicion: '63735',
        subtotal: '100.00', impuestos_trasladados: '16.00', impuestos_retenidos: '0.00', total: '116.00',
        conceptos: [{ concepto_fiscal_id: taxedConcept.id, cantidad: '1', valor_unitario: '100.00' }],
        idempotency_key: randomUUID(),
      });
      await asActor(() => service.generatePrefactura(actor, taxedDraft.cfdi.id, randomUUID()));
      const taxedRepresentation = await db.prefacturaRepresentacion.findFirstOrThrow({
        where: { organization_id: org.id, cfdi_id: taxedDraft.cfdi.id, version: 1 }, include: { documento: true },
      });
      expect(taxedRepresentation.snapshot).toMatchObject({
        amounts: { subtotal: '100.00', transferred: '16.00', retained: '0.00', total: '116.00' },
        concepts: [{ subtotal: '100.00', transferred: '16.00', retained: '0.00', total: '116.00' }],
      });
      const taxedBytes = await downloadFile(taxedRepresentation.documento.storage_key);
      expect(createHash('sha256').update(taxedBytes).digest('hex')).toBe(taxedRepresentation.pdf_sha256);
      const taxedParser = new PDFParse({ data: taxedBytes });
      try {
        const taxedText = qaPdfText(taxedRepresentation.documento.storage_key, (await taxedParser.getText()).text);
        expect(taxedText).toContain('100.00');
        expect(taxedText).toContain('16.00');
        expect(taxedText).toContain('116.00');
      } finally { await taxedParser.destroy(); }
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
        const firstText = qaPdfText(firstRow.documento.storage_key, (await firstParser.getText()).text);
        const secondText = qaPdfText(secondRow.documento.storage_key, (await secondParser.getText()).text);
        expect(firstText).toContain('RECEPTOR SINTETICO QA');
        expect(firstText).toContain('EMISOR SINTETICO QA');
        expect(firstText).not.toContain('PRAVIA OS');
        expect(firstText).toContain('EXP-QA-001 Honorarios de este expediente');
        expect(firstText).toContain('PREFACTURA — SIN VALIDEZ');
        expect(firstText).toContain('SIN TIMBRAR');
        expect(firstText).not.toContain('SELLO DIGITAL DEL SAT');
        expect(firstRow.generator).toBe('CLIENT_FACTURA_PRAVIA_DOCX_V1');
        expect(firstRow.snapshot).toMatchObject({ template: { source: `CFG-002:${templateArtifact.id}:V1`, version_id: templateVersion.id,
          sha256: '93c7eeac20182e9c75cf21561089dc65becbd1fee037e156af1549bec3e0f9b3' } });
        expect(firstText).not.toContain('RECEPTOR CORREGIDO SINTETICO QA');
        expect(secondText).toContain('RECEPTOR CORREGIDO SINTETICO QA');
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
          receptor_rfc: 'BBBA010101BBB', receptor_nombre: `RECEPTOR ${currency} SINTETICO QA`,
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
          const content = qaPdfText(row.documento.storage_key, (await parser.getText()).text);
          expect(content).toContain(currency);
          // PDF text extraction can split or mis-map digits in the Word font;
          // the exact rate is asserted above from the immutable DB snapshot.
          expect(content).toContain(currency);
          expect(content).toContain(Number(equivalent).toLocaleString('es-MX', { minimumFractionDigits: 2 }) + ' MXN');
        } finally { await parser.destroy(); }
      }
      await expect(service.prefacturaVersions({ ...actor, organizationId: randomUUID() }, created.cfdi.id)).rejects.toMatchObject({ status: 404 });
      await expect(service.prefacturaVersionUrl({ ...actor, organizationId: randomUUID() }, created.cfdi.id, 1)).rejects.toMatchObject({ status: 404 });
      await expect(asActor(() => service.removeEntityLogo({ ...actor, permissions: ['finanzas.write'] }, entity.id)))
        .rejects.toMatchObject({ status: 403, code: 'CFDI_LOGO_WRITE_DENIED' });
      expect(await asActor(() => service.removeEntityLogo(actor, entity.id))).toEqual({ removed: true });
      expect((await db.entidadFiscalCfdi.findUniqueOrThrow({ where: { id: entity.id } })).logo_documento_id).toBeNull();
      expect(await asActor(() => service.entityLogoUrl(actor, entity.id))).toBeNull();
      expect((await downloadFile(firstRow.documento.storage_key)).equals(firstBytes)).toBe(true);
      expect((await db.prefacturaRepresentacion.findUniqueOrThrow({ where: { id: firstRow.id } })).snapshot)
        .toMatchObject({ logo: { sha256: uploadedLogo.sha256, document_id: uploadedLogo.documentId } });
    } finally { await db.$disconnect(); }
  }, 60000);
});
