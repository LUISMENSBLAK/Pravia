import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { ExpedienteDocumentAppendixError, ExpedienteDocumentAppendixService } from '../services/expedienteDocumentAppendix.service';

const service = new ExpedienteDocumentAppendixService(prisma);
const fail = (res: Response, error: unknown) => {
  if (error instanceof ExpedienteDocumentAppendixError) return res.status(error.status).json({ code: error.code, error: error.message });
  return res.status(500).json({ code: 'EXP004_APPENDIX_FAILED', error: 'No pudimos consultar el apéndice documental.' });
};

export const getExpedienteDocumentAppendix = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    return res.json(await service.read(req.user, req.params.id));
  } catch (error) { return fail(res, error); }
};

export const syncExpedienteDocumentAppendix = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    return res.json(await service.sync(req.user, req.params.id));
  } catch (error) { return fail(res, error); }
};

export const importExpedienteDocuments = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const origin = String(req.params.origin || '').toUpperCase();
    if (origin !== 'COMPARECIENTE' && origin !== 'PREDIO') throw new ExpedienteDocumentAppendixError(400, 'EXP004_IMPORT_ORIGIN_INVALID', 'Selecciona comparecientes o predios.');
    return res.json(await service.importCurrent(req.user, req.params.id, origin));
  } catch (error) { return fail(res, error); }
};

export const createExpedienteDocumentFolder = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    return res.status(201).json({ data: await service.createFolder(req.user, req.params.id, String(req.body?.name || ''), req.body?.parent_id || null) });
  } catch (error) { return fail(res, error); }
};

export const renameExpedienteDocumentFolder = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    return res.json({ data: await service.renameFolder(req.user, req.params.id, req.params.folderId, String(req.body?.name || '')) });
  } catch (error) { return fail(res, error); }
};

export const archiveExpedienteDocumentFolder = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    return res.json({ data: await service.archiveFolder(req.user, req.params.id, req.params.folderId) });
  } catch (error) { return fail(res, error); }
};

export const moveExpedienteDocumentItems = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    return res.json({ data: await service.move(req.user, req.params.id, req.body || {}) });
  } catch (error) { return fail(res, error); }
};

export const downloadExpedienteAppendixFile = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const file = await service.file(req.user, req.params.id, req.params.itemId);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return res.send(file.buffer);
  } catch (error) { return fail(res, error); }
};

export const downloadExpedienteAppendixZip = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const archive = await service.archive(req.user, req.params.id, { folder_id: req.body?.folder_id || null, folder_ids: Array.isArray(req.body?.folder_ids) ? req.body.folder_ids : [], item_ids: Array.isArray(req.body?.item_ids) ? req.body.item_ids : [] });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(archive.name)}`);
    return res.send(archive.buffer);
  } catch (error) { return fail(res, error); }
};

export const getExpedienteAppendixSignedUrl = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    return res.json(await service.signedUrl(req.user, req.params.id, req.params.itemId));
  } catch (error) { return fail(res, error); }
};
