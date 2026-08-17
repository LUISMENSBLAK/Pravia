import path from 'path';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { deleteFile, downloadFile, uploadFile } from '../services/supabase.service';
import { isrService } from '../services/isr.service';
import { ISRValidationError } from '../domain/isrTaxEngine';

const actor = (req: Request) => req.user!;
const sendError = (res: Response, error: unknown) => {
  if (error instanceof ISRValidationError) return res.status(error.code.endsWith('NOT_FOUND') ? 404 : error.code.includes('ACCESS') ? 403 : 422).json({ code: error.code, error: error.message, field: error.field });
  console.error('ISR operation failed', error);
  return res.status(500).json({ code: 'ISR_OPERATION_FAILED', error: 'No fue posible completar la operación de ISR. Intenta nuevamente.' });
};

export const listISR = async (req: Request, res: Response) => { try { return res.json(await isrService.list(actor(req), req.query)); } catch (error) { return sendError(res, error); } };
export const getISR = async (req: Request, res: Response) => { try { return res.json({ data: await isrService.get(actor(req), req.params.id) }); } catch (error) { return sendError(res, error); } };
export const createISR = async (req: Request, res: Response) => { try { return res.status(201).json({ data: await isrService.create(actor(req), req.body || {}) }); } catch (error) { return sendError(res, error); } };
export const updateISR = async (req: Request, res: Response) => { try { return res.json({ data: await isrService.update(actor(req), req.params.id, req.body || {}) }); } catch (error) { return sendError(res, error); } };
export const calculateISRRecord = async (req: Request, res: Response) => { try { return res.status(201).json({ data: await isrService.calculate(actor(req), req.params.id) }); } catch (error) { return sendError(res, error); } };
export const extractISR = async (req: Request, res: Response) => { try { return res.json({ data: await isrService.extract(actor(req), req.params.id) }); } catch (error) { return sendError(res, error); } };
export const reviewISRProposal = async (req: Request, res: Response) => { try { const action = req.body?.action; if (!['ACEPTADA', 'RECHAZADA'].includes(action)) throw new ISRValidationError('INVALID_REVIEW_ACTION', 'Selecciona aceptar o rechazar la propuesta.'); return res.json({ data: await isrService.reviewProposal(actor(req), req.params.id, req.params.proposalId, action) }); } catch (error) { return sendError(res, error); } };
export const auditISRExport = async (req: Request, res: Response) => { try { const current = await isrService.get(actor(req), req.params.id); await prisma.auditLog.create({ data: { user_id: actor(req).id, accion: 'EXPORTAR_RESUMEN_ISR', entidad: 'CalculoISR', entidad_id: current.id, detalles: { version: current.ultima_version, formato: 'IMPRESION' } } }); return res.json({ success: true }); } catch (error) { return sendError(res, error); } };

export const uploadISRDocument = async (req: Request, res: Response) => {
  let storageKey = '';
  try {
    const current = await isrService.get(actor(req), req.params.id);
    if (!req.file) throw new ISRValidationError('DOCUMENT_REQUIRED', 'Selecciona un documento para cargar.');
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'];
    if (!allowed.includes(req.file.mimetype)) throw new ISRValidationError('DOCUMENT_TYPE_NOT_ALLOWED', 'Este formato no está permitido. Usa PDF, imagen, DOC o DOCX.');
    const extension = path.extname(req.file.originalname).toLowerCase() || '.bin';
    storageKey = `isr/${current.id}/${crypto.randomUUID()}${extension}`;
    await uploadFile(req.file.buffer, storageKey, req.file.mimetype);
    const document = await prisma.$transaction(async (tx) => {
      const created = await tx.documento.create({ data: { nombre_original: req.file!.originalname, nombre_interno: path.basename(storageKey), tipo: 'ISR_SOPORTE', categoria: 'SAT', storage_key: storageKey, mime_type: req.file!.mimetype, size_bytes: req.file!.size, subido_por_id: actor(req).id } });
      await tx.calculoISRDocumento.create({ data: { calculo_id: current.id, documento_id: created.id, creado_por_id: actor(req).id } });
      await tx.auditLog.create({ data: { user_id: actor(req).id, accion: 'CARGAR_DOCUMENTO_ISR', entidad: 'CalculoISR', entidad_id: current.id, detalles: { documento_id: created.id, nombre: created.nombre_original } } });
      return created;
    });
    return res.status(201).json({ data: document });
  } catch (error) {
    if (storageKey) await deleteFile(storageKey).catch(() => undefined);
    return sendError(res, error);
  }
};

const streamISRDocument = (download: boolean) => async (req: Request, res: Response) => {
  try {
    const current = await isrService.get(actor(req), req.params.id);
    const link = current.documentos.find((item) => item.documento_id === req.params.documentId);
    if (!link) throw new ISRValidationError('DOCUMENT_NOT_FOUND', 'El documento no existe o ya no está vinculado.');
    const buffer = await downloadFile(link.documento.storage_key);
    await prisma.auditLog.create({ data: { user_id: actor(req).id, accion: download ? 'DESCARGAR_DOCUMENTO_ISR' : 'VISUALIZAR_DOCUMENTO_ISR', entidad: 'CalculoISR', entidad_id: current.id, detalles: { documento_id: link.documento_id } } });
    res.setHeader('Content-Type', link.documento.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(link.documento.nombre_original)}`);
    return res.send(buffer);
  } catch (error) { return sendError(res, error); }
};

export const previewISRDocument = streamISRDocument(false);
export const downloadISRDocument = streamISRDocument(true);

export const unlinkISRDocument = async (req: Request, res: Response) => {
  try {
    const current = await isrService.get(actor(req), req.params.id);
    const link = current.documentos.find((item) => item.documento_id === req.params.documentId);
    if (!link) throw new ISRValidationError('DOCUMENT_NOT_FOUND', 'El documento no existe o ya no está vinculado.');
    await prisma.$transaction([
      prisma.calculoISRDocumento.update({ where: { id: link.id }, data: { estatus: 'INACTIVO', inactivado_at: new Date(), inactivado_por_id: actor(req).id, motivo_inactivacion: 'Desvinculado por usuario' } }),
      prisma.auditLog.create({ data: { user_id: actor(req).id, accion: 'DESVINCULAR_DOCUMENTO_ISR', entidad: 'CalculoISR', entidad_id: current.id, detalles: { documento_id: link.documento_id } } }),
    ]);
    return res.json({ success: true, message: 'El documento se desvinculó; el archivo maestro se conserva.' });
  } catch (error) { return sendError(res, error); }
};
