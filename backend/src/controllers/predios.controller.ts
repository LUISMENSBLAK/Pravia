import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { PredioError, PrediosService } from '../services/predios.service';
import { deleteFile, getSignedUrl, uploadFile } from '../services/supabase.service';

const service = new PrediosService(prisma);
export const uploadPredioDocumentoMulter = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const actor = (req: Request) => {
  if (!req.user) throw new PredioError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
  return req.user;
};
const respondError = (res: Response, error: unknown) => {
  if (error instanceof PredioError) return res.status(error.status).json({ code: error.code, error: error.message });
  const code = (error as { code?: string })?.code;
  if (code === 'P2002') return res.status(409).json({ code: 'PREDIO_DUPLICATE_IDENTIFIER', error: 'Ya existe un inmueble con ese identificador registral o catastral.' });
  return res.status(500).json({ code: 'PREDIO_OPERATION_FAILED', error: 'No fue posible completar la operación del inmueble.' });
};

export const listPredios = async (req: Request, res: Response) => {
  try { return res.json(await service.list(actor(req), String(req.query.search || ''), Number(req.query.limit || 30))); }
  catch (error) { return respondError(res, error); }
};
export const getPredio = async (req: Request, res: Response) => {
  try { return res.json({ data: await service.get(actor(req), req.params.id) }); }
  catch (error) { return respondError(res, error); }
};
export const createPredio = async (req: Request, res: Response) => {
  try { return res.status(201).json({ data: await service.create(actor(req), req.body || {}) }); }
  catch (error) { return respondError(res, error); }
};
export const updatePredio = async (req: Request, res: Response) => {
  try { return res.json({ data: await service.update(actor(req), req.params.id, req.body || {}, req.body?.expected_version) }); }
  catch (error) { return respondError(res, error); }
};

export const uploadPredioDocumento = async (req: Request, res: Response) => {
  let storageKey: string | null = null;
  let documentId: string | null = null;
  try {
    const user = actor(req);
    await service.get(user, req.params.id);
    const file = req.file;
    if (!file) throw new PredioError(400, 'PREDIO_DOCUMENT_REQUIRED', 'Selecciona un documento.');
    const accepted = ['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml'];
    if (!accepted.includes(file.mimetype)) throw new PredioError(400, 'PREDIO_DOCUMENT_TYPE_INVALID', 'Carga un PDF, imagen o documento Word compatible.');
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    storageKey = `organizations/${user.organizationId}/documentos/${crypto.randomUUID()}${ext}`;
    await uploadFile(file.buffer, storageKey, file.mimetype);
    const document = await prisma.documento.create({ data: {
      organization_id: user.organizationId, nombre_original: file.originalname, nombre_interno: storageKey, storage_key: storageKey,
      tipo: String(req.body.tipo || 'DOCUMENTO_INMUEBLE').slice(0, 120), categoria: 'OTROS', mime_type: file.mimetype, size_bytes: file.size,
      observaciones: String(req.body.observaciones || '').trim() || null, subido_por_id: user.id,
    } });
    documentId = document.id;
    await service.addDocument(user, req.params.id, document.id, req.body.tipo || 'DOCUMENTO_INMUEBLE', req.body.observaciones);
    return res.status(201).json({ data: await service.get(user, req.params.id) });
  } catch (error) {
    if (documentId) await prisma.documento.deleteMany({ where: { id: documentId } }).catch(() => undefined);
    if (storageKey) await deleteFile(storageKey).catch(() => undefined);
    return respondError(res, error);
  }
};

export const getPredioDocumentoUrl = async (req: Request, res: Response) => {
  try {
    const property = await service.get(actor(req), req.params.id);
    const link = property.documentos.find((item) => item.documento_id === req.params.documentoId && item.estatus === 'ACTIVO');
    if (!link) throw new PredioError(404, 'PREDIO_DOCUMENT_NOT_FOUND', 'El documento ya no está vinculado a este inmueble.');
    return res.json({ url: await getSignedUrl(link.documento.storage_key) });
  } catch (error) { return respondError(res, error); }
};

export const unlinkPredioDocumento = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    await service.get(user, req.params.id);
    const link = await prisma.predioDocumento.findFirst({ where: { organization_id: user.organizationId, predio_id: req.params.id, documento_id: req.params.documentoId, estatus: 'ACTIVO' } });
    if (!link) throw new PredioError(404, 'PREDIO_DOCUMENT_NOT_FOUND', 'El documento ya no está vinculado a este inmueble.');
    const reason = String(req.body?.reason || '').trim();
    if (!reason) throw new PredioError(400, 'PREDIO_DOCUMENT_REASON_REQUIRED', 'Indica el motivo de la desvinculación.');
    await prisma.$transaction([
      prisma.predioDocumento.update({ where: { id: link.id }, data: { estatus: 'INACTIVO', inactivado_at: new Date(), inactivado_por_id: user.id, motivo_inactivacion: reason } }),
      prisma.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id, accion: 'UNLINK_PROPERTY_DOCUMENT', entidad: 'PredioDocumento', entidad_id: link.id, valores_nuevos: { predio_id: req.params.id, documento_id: req.params.documentoId, archivo_maestro_conservado: true }, correlation_id: crypto.randomUUID(), session_id: user.sessionId } }),
    ]);
    return res.json({ success: true, master_document_preserved: true });
  } catch (error) { return respondError(res, error); }
};

export const proposePredioFromDocument = async (req: Request, res: Response) => {
  try { return res.json({ data: await service.proposeFromDocument(actor(req), req.params.id, String(req.body?.documento_id || '')) }); }
  catch (error) { return respondError(res, error); }
};
export const applyPredioProposal = async (req: Request, res: Response) => {
  try { return res.json({ data: await service.applyProposal(actor(req), req.params.id, req.params.extraccionId, req.body || {}) }); }
  catch (error) { return respondError(res, error); }
};
