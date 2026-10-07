import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { ArchivoError, ArchivoService } from '../services/archivo.service';

const service = new ArchivoService(prisma);
const handle = (res: Response, error: unknown) => {
  if (error instanceof ArchivoError) return res.status(error.status).json({ code: error.code, error: error.message });
  return res.status(500).json({ code: 'ARCHIVO_OPERATION_FAILED', error: 'No pudimos completar la operación de Archivo.' });
};
const actor = (req: Request) => {
  if (!req.user) throw new ArchivoError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
  return req.user;
};

export const getArchivoOverview = async (req: Request, res: Response) => {
  try { return res.json(await service.overview(actor(req))); } catch (error) { return handle(res, error); }
};
export const getExpedienteArchivo = async (req: Request, res: Response) => {
  try { return res.json(await service.forExpediente(actor(req), req.params.id)); } catch (error) { return handle(res, error); }
};
export const assignArchivo = async (req: Request, res: Response) => {
  try { return res.status(201).json(await service.assign(actor(req), req.body || {}, req.params.id)); } catch (error) { return handle(res, error); }
};
export const updateArchivo = async (req: Request, res: Response) => {
  try { return res.json(await service.update(actor(req), req.params.recordId, req.body || {})); } catch (error) { return handle(res, error); }
};
export const registerUnusedFolios = async (req: Request, res: Response) => {
  try { return res.status(201).json(await service.registerUnused(actor(req), req.body || {})); } catch (error) { return handle(res, error); }
};
export const uploadArchivoAppendix = async (req: Request, res: Response) => {
  try {
    const context = req.body?.context === 'NOTA_ARCHIVO' ? 'NOTA_ARCHIVO' : 'APENDICE_ARCHIVO';
    return res.status(201).json(await service.uploadAppendix(actor(req), req.params.id, req.file!, context));
  } catch (error) { return handle(res, error); }
};
export const generateArchivoNote = async (req: Request, res: Response) => {
  try { return res.status(201).json(await service.generateNote(actor(req), req.params.id, req.body || {})); } catch (error) { return handle(res, error); }
};
export const downloadArchivoAppendix = async (req: Request, res: Response) => {
  try {
    const result = await service.downloadAppendix(actor(req), req.params.id, req.params.itemId);
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`);
    return res.send(result.file);
  } catch (error) { return handle(res, error); }
};
