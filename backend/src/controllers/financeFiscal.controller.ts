import type { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { FinanceFiscalError, FinanceFiscalService, type UploadedFiscalFile } from '../services/financeFiscal.service';
import { FiscalDocumentExtractionService, FiscalExtractionError } from '../services/fiscalDocumentExtraction.service';

const service = new FinanceFiscalService(prisma);
const fiscalExtractor = new FiscalDocumentExtractionService();
const correlation = (req: Request) => req.correlationId;
const actor = (req: Request) => {
  if (!req.user) throw new FinanceFiscalError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
  return { id: req.user.id, organizationId: req.user.organizationId, rol: req.user.rol, permissions: req.user.permissions };
};

function file(value: Express.Multer.File | undefined): UploadedFiscalFile | undefined {
  return value ? { buffer: value.buffer, originalname: value.originalname, mimetype: value.mimetype, size: value.size } : undefined;
}

function fail(res: Response, error: unknown, fallback: string) {
  const correlationId = String(res.getHeader('x-correlation-id') || '');
  if (error instanceof FinanceFiscalError) return res.status(error.status).json({ success: false, code: error.code, error: error.message, correlation_id: correlationId });
  if (error instanceof FiscalExtractionError) return res.status(error.status).json({ success: false, code: error.code, error: error.message, correlation_id: correlationId });
  const safeError = error instanceof Error ? { name: error.name, code: 'CFDI_OPERATION_FAILED' } : { name: 'UnknownError', code: 'CFDI_OPERATION_FAILED' };
  console.error(`[FinanceFiscal] ${fallback}`, { ...safeError, correlation_id: correlationId });
  return res.status(500).json({ success: false, code: 'CFDI_OPERATION_FAILED', error: fallback, correlation_id: correlationId });
}

export class FinanceFiscalController {
  static status(req: Request, res: Response) {
    return res.json({ success: true, data: service.providerStatus() });
  }

  static async entities(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.listEntities(actor(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos cargar las entidades fiscales.'); }
  }

  static fiscalRegimes(_req: Request, res: Response) {
    return res.json({ success: true, data: service.fiscalRegimes() });
  }

  static fiscalUses(_req: Request, res: Response) {
    return res.json({ success: true, data: service.fiscalUses() });
  }

  static async pendingEntityCsf(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.pendingEntityCsfState(actor(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos recuperar la constancia pendiente.'); }
  }

  static async uploadEntityCsf(req: Request, res: Response) {
    try {
      if (!req.file) throw new FinanceFiscalError(400, 'CFDI_CSF_FILE_REQUIRED', 'Selecciona un PDF de constancia fiscal.');
      const result = await service.uploadEntityCsf(actor(req), file(req.file)!, correlation(req));
      return res.status(result.idempotent ? 200 : 201).json({ success: true, data: result });
    } catch (error) { return fail(res, error, 'No pudimos guardar la constancia fiscal.'); }
  }

  static async extractEntityCsf(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.extractEntityCsf(actor(req), req.params.id, correlation(req)) }); }
    catch (error) { return fail(res, error, 'La constancia está guardada, pero no se pudo completar su extracción.'); }
  }

  static async entityCsfUrl(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.entityCsfUrl(actor(req), req.params.id, correlation(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos abrir la constancia fiscal.'); }
  }

  static async entityCsfVersions(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.entityCsfVersions(actor(req), req.params.id) }); }
    catch (error) { return fail(res, error, 'No pudimos consultar las versiones de la constancia.'); }
  }

  static async entityCsfVersionUrl(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.entityCsfVersionUrl(actor(req), req.params.id, Number(req.params.version), correlation(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos abrir la versión solicitada.'); }
  }

  static async replaceEntityCsf(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.replaceEntityCsf(actor(req), req.params.id, req.body || {}, correlation(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos sustituir la constancia fiscal.'); }
  }

  static async createEntity(req: Request, res: Response) {
    try { return res.status(201).json({ success: true, data: await service.createEntity(actor(req), req.body || {}, correlation(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos crear la entidad fiscal.'); }
  }

  static async updateEntity(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.updateEntity(actor(req), req.params.id, req.body || {}, correlation(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos actualizar la entidad fiscal.'); }
  }

  static async fiscalConcepts(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.listFiscalConcepts(actor(req), String(req.query.entidad_fiscal_id || '')) }); }
    catch (error) { return fail(res, error, 'No pudimos cargar los conceptos fiscales.'); }
  }

  static async fiscalActOptions(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.listFiscalActOptions(actor(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos cargar los actos para conceptos fiscales.'); }
  }

  static async createFiscalConcept(req: Request, res: Response) {
    try { return res.status(201).json({ success: true, data: await service.createFiscalConcept(actor(req), req.body || {}, correlation(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos guardar el concepto fiscal.'); }
  }

  static async suppliers(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.listSuppliers(actor(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos cargar los proveedores.'); }
  }

  static async createSupplier(req: Request, res: Response) {
    try {
      const input = { ...req.body };
      if (req.file) {
        const regime = String(input.regimen_fiscal || '').trim();
        if (regime && !/^\d{3}$/.test(regime)) throw new FinanceFiscalError(400, 'CFDI_REGIME_INVALID', 'El régimen fiscal debe tener tres dígitos.');
        let regimes: unknown = [];
        if (input.regimenes_fiscales) {
          try { regimes = JSON.parse(String(input.regimenes_fiscales)); }
          catch { throw new FinanceFiscalError(400, 'CFDI_REGIMES_INVALID', 'La lista de regímenes no tiene un formato válido.'); }
        }
        if (!Array.isArray(regimes) || regimes.length > 20 || regimes.some((item) => !item || typeof item !== 'object' || !/^\d{3}$/.test(String(item.clave || '')))) {
          throw new FinanceFiscalError(400, 'CFDI_REGIMES_INVALID', 'Confirma cada régimen fiscal detectado con una clave de tres dígitos.');
        }
        input.regimenes_fiscales = regimes.length ? regimes : regime ? [{ clave: regime, descripcion: '' }] : [];
      }
      const result = await service.createSupplier(actor(req), input, correlation(req), file(req.file));
      return res.status(result.idempotent ? 200 : 201).json({ success: true, data: result });
    } catch (error) { return fail(res, error, 'No pudimos crear el proveedor.'); }
  }

  static async updateSupplier(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.updateSupplier(actor(req), req.params.id, req.body || {}, correlation(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos actualizar el proveedor.'); }
  }

  static async supplierCsfUrl(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.supplierCsfUrl(actor(req), req.params.id, correlation(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos abrir la constancia fiscal.'); }
  }

  static async extractCsf(req: Request, res: Response) {
    try {
      if (!req.file) throw new FiscalExtractionError(400, 'CSF_FILE_REQUIRED', 'Selecciona un archivo de constancia para extraer datos.');
      return res.json({ success: true, data: await fiscalExtractor.extract(file(req.file)!) });
    } catch (error) { return fail(res, error, 'No pudimos extraer la constancia fiscal.'); }
  }

  static async documents(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.listDocuments(actor(req), req.query) }); }
    catch (error) { return fail(res, error, 'No pudimos cargar los CFDI.'); }
  }

  static async incomeContext(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.incomeContext(actor(req), req.params.incomeId) }); }
    catch (error) { return fail(res, error, 'No pudimos cargar el saldo facturable del ingreso.'); }
  }

  static async confirmIncomeReceiver(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.confirmIncomeReceiver(actor(req), req.params.incomeId, req.params.comparecienteId, req.body || {}, correlation(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos confirmar los datos fiscales del compareciente.'); }
  }

  static async createDraft(req: Request, res: Response) {
    try {
      const result = await service.createDraft(actor(req), req.body || {}, correlation(req));
      return res.status(result.idempotent ? 200 : 201).json({ success: true, data: result });
    } catch (error) { return fail(res, error, 'No pudimos crear la prefactura.'); }
  }

  static async updateDraft(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.updateDraft(actor(req), req.params.id, req.body || {}, correlation(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos actualizar la prefactura.'); }
  }

  static async deleteDraft(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.deleteDraft(actor(req), req.params.id, correlation(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos eliminar la prefactura.'); }
  }

  static async generatePrefactura(req: Request, res: Response) {
    try {
      const key = String(req.header('Idempotency-Key') || req.body?.idempotency_key || '').trim();
      const result = await service.generatePrefactura(actor(req), req.params.id, key, correlation(req));
      return res.status(result.idempotent ? 200 : 201).json({ success: true, data: result });
    } catch (error) { return fail(res, error, 'No pudimos generar el PDF de prefactura.'); }
  }

  static async prefacturaVersions(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.prefacturaVersions(actor(req), req.params.id) }); }
    catch (error) { return fail(res, error, 'No pudimos cargar las versiones de la prefactura.'); }
  }

  static async prefacturaVersionUrl(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.prefacturaVersionUrl(actor(req), req.params.id, Number(req.params.version)) }); }
    catch (error) { return fail(res, error, 'No pudimos abrir esta versión PDF.'); }
  }

  static async uploadManual(req: Request, res: Response) {
    try {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const xml = file(files?.xml?.[0]);
      if (!xml) throw new FinanceFiscalError(400, 'CFDI_XML_REQUIRED', 'Selecciona el XML del CFDI.');
      const result = await service.uploadManual(actor(req), xml, file(files?.pdf?.[0]), correlation(req));
      return res.status(result.idempotent ? 200 : 201).json({ success: true, data: result });
    } catch (error) { return fail(res, error, 'No pudimos cargar el CFDI manual.'); }
  }

  static async fileUrl(req: Request, res: Response) {
    try {
      const kind = req.params.kind === 'pdf' ? 'pdf' : 'xml';
      return res.json({ success: true, data: await service.documentUrl(actor(req), req.params.id, kind) });
    } catch (error) { return fail(res, error, 'No pudimos abrir el archivo fiscal.'); }
  }

  static async applyPayment(req: Request, res: Response) {
    try {
      const result = await service.applyPayment(actor(req), req.params.id, req.body || {}, correlation(req));
      return res.status(result.idempotent ? 200 : 201).json({ success: true, data: result });
    } catch (error) { return fail(res, error, 'No pudimos aplicar el pago.'); }
  }

  static async prepareRep(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.prepareRep(actor(req), req.params.id) }); }
    catch (error) { return fail(res, error, 'No pudimos preparar el complemento de pago.'); }
  }

  static async stamp(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.stamp(actor(req), req.params.id) }); }
    catch (error) { return fail(res, error, 'No pudimos solicitar el timbrado.'); }
  }

  static async accounts(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.listAccounts(actor(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos cargar cuentas por cobrar y pagar.'); }
  }

  static async transfer(req: Request, res: Response) {
    try {
      const result = await service.createInternalTransfer(actor(req), req.body || {}, correlation(req));
      return res.status(result.idempotent ? 200 : 201).json({ success: true, data: result });
    } catch (error) { return fail(res, error, 'No pudimos registrar la transferencia interna.'); }
  }

  static async exportXlsx(req: Request, res: Response) {
    try {
      const result = await service.exportXlsx(actor(req));
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('X-Export-Rows', String(result.rowCount));
      return res.send(result.buffer);
    } catch (error) { return fail(res, error, 'No pudimos exportar el reporte fiscal.'); }
  }
}
