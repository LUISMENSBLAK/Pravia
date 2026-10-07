import type { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { FinanceFiscalError, FinanceFiscalService, extractCsfFields, type UploadedFiscalFile } from '../services/financeFiscal.service';

const service = new FinanceFiscalService(prisma);
const correlation = (req: Request) => req.correlationId;
const actor = (req: Request) => {
  if (!req.user) throw new FinanceFiscalError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
  return { id: req.user.id, organizationId: req.user.organizationId, permissions: req.user.permissions };
};

function file(value: Express.Multer.File | undefined): UploadedFiscalFile | undefined {
  return value ? { buffer: value.buffer, originalname: value.originalname, mimetype: value.mimetype, size: value.size } : undefined;
}

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof FinanceFiscalError) return res.status(error.status).json({ success: false, code: error.code, error: error.message });
  console.error(`[FinanceFiscal] ${fallback}`, error);
  return res.status(500).json({ success: false, code: 'CFDI_OPERATION_FAILED', error: fallback });
}

export class FinanceFiscalController {
  static status(req: Request, res: Response) {
    return res.json({ success: true, data: service.providerStatus() });
  }

  static async entities(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.listEntities(actor(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos cargar las entidades fiscales.'); }
  }

  static async createEntity(req: Request, res: Response) {
    try { return res.status(201).json({ success: true, data: await service.createEntity(actor(req), req.body || {}, correlation(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos crear la entidad fiscal.'); }
  }

  static async updateEntity(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.updateEntity(actor(req), req.params.id, req.body || {}, correlation(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos actualizar la entidad fiscal.'); }
  }

  static async suppliers(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.listSuppliers(actor(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos cargar los proveedores.'); }
  }

  static async createSupplier(req: Request, res: Response) {
    try {
      const result = await service.createSupplier(actor(req), req.body || {}, correlation(req));
      return res.status(result.idempotent ? 200 : 201).json({ success: true, data: result });
    } catch (error) { return fail(res, error, 'No pudimos crear el proveedor.'); }
  }

  static async updateSupplier(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.updateSupplier(actor(req), req.params.id, req.body || {}, correlation(req)) }); }
    catch (error) { return fail(res, error, 'No pudimos actualizar el proveedor.'); }
  }

  static async extractCsf(req: Request, res: Response) {
    try {
      const uploaded = req.file;
      let text = String(req.body?.text || '');
      if (uploaded) {
        if (uploaded.size > 10 * 1024 * 1024) throw new FinanceFiscalError(400, 'CSF_FILE_TOO_LARGE', 'La constancia no puede exceder 10 MB.');
        if (uploaded.mimetype === 'application/pdf' || uploaded.originalname.toLowerCase().endsWith('.pdf')) {
          const { PDFParse } = require('pdf-parse');
          const parser = new PDFParse({ data: uploaded.buffer });
          try { text = String((await parser.getText())?.text || ''); } finally { await parser.destroy(); }
        } else if (/\.txt$/i.test(uploaded.originalname) || uploaded.mimetype.startsWith('text/')) text = uploaded.buffer.toString('utf8');
        else throw new FinanceFiscalError(400, 'CSF_FORMAT_UNSUPPORTED', 'La constancia debe ser PDF textual o TXT.');
      }
      if (!text.trim()) throw new FinanceFiscalError(422, 'CSF_TEXT_UNREADABLE', 'No pudimos leer texto de la constancia; captura los datos manualmente.');
      const extracted = extractCsfFields(text);
      return res.json({ success: true, data: { ...extracted, source: 'DETERMINISTIC_TEXT', requiresReview: true } });
    } catch (error) { return fail(res, error, 'No pudimos extraer la constancia fiscal.'); }
  }

  static async documents(req: Request, res: Response) {
    try { return res.json({ success: true, data: await service.listDocuments(actor(req), req.query) }); }
    catch (error) { return fail(res, error, 'No pudimos cargar los CFDI.'); }
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
