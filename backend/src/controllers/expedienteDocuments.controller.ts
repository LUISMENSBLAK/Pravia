import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { ExpedienteDocumentAppendixError, ExpedienteDocumentAppendixService } from '../services/expedienteDocumentAppendix.service';
import { DocumentArchiveIntakeError, extractDocumentArchive, intakeLooseFiles } from '../services/documentArchiveIntake.service';
import multer from 'multer';

const service = new ExpedienteDocumentAppendixService(prisma);
export const uploadDocumentBatchMulter = multer({ storage: multer.memoryStorage(), limits: { fileSize: 75 * 1024 * 1024, files: 301, fields: 10 } });
const fail = (res: Response, error: unknown) => {
  if (error instanceof ExpedienteDocumentAppendixError) return res.status(error.status).json({ code: error.code, error: error.message });
  if (error instanceof DocumentArchiveIntakeError) return res.status(400).json({ code: error.code, error: error.message });
  return res.status(500).json({ code: 'EXP004_APPENDIX_FAILED', error: 'No pudimos consultar el apéndice documental.' });
};

export const importExpedienteDocumentBatch = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    const multipart = req.files as Record<string, Express.Multer.File[]> | undefined;
    const archives = multipart?.archive || [];
    const files = multipart?.files || [];
    if ((archives.length === 1) === (files.length > 0)) throw new DocumentArchiveIntakeError('DOCUMENT_BATCH_SELECTION_INVALID', 'Selecciona un ZIP/RAR o una carpeta, no ambos.');
    let relativePaths: unknown = [];
    if (files.length) {
      try { relativePaths = JSON.parse(String(req.body?.relative_paths || '[]')); }
      catch { throw new DocumentArchiveIntakeError('DOCUMENT_BATCH_PATHS_INVALID', 'Las rutas de la carpeta no tienen un formato válido.'); }
      if (!Array.isArray(relativePaths) || !relativePaths.every((item) => typeof item === 'string')) {
        throw new DocumentArchiveIntakeError('DOCUMENT_BATCH_PATHS_INVALID', 'Cada archivo necesita una ruta relativa válida.');
      }
    }
    const extracted = archives.length
      ? await extractDocumentArchive(archives[0])
      : intakeLooseFiles(files, relativePaths as string[]);
    const policy = String(req.body?.on_conflict || 'OMITIR').toUpperCase();
    if (!['OMITIR', 'CONSERVAR', 'REEMPLAZAR'].includes(policy)) throw new DocumentArchiveIntakeError('DOCUMENT_CONFLICT_POLICY_INVALID', 'Selecciona cómo resolver documentos con la misma ruta.');
    const folderId = String(req.body?.folder_id || '').trim() || null;
    const summary = await service.importBatch(req.user, req.params.id, extracted, policy as 'OMITIR' | 'CONSERVAR' | 'REEMPLAZAR', folderId);
    return res.status(201).json({ success: true, ...summary });
  } catch (error) { return fail(res, error); }
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

export const getExpedienteDocumentFolderDestinations = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    return res.json(await service.folderDestinations(req.user, req.params.id));
  } catch (error) { return fail(res, error); }
};

export const linkExpedienteDocumentFolder = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    return res.json({ data: await service.linkFolder(req.user, req.params.id, req.params.folderId, {
      target_type: req.body?.target_type || null, target_id: req.body?.target_id || null,
    }) });
  } catch (error) { return fail(res, error); }
};

export const syncExpedienteLinkedDocumentFolders = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    return res.json(await service.syncLinkedFolders(req.user, req.params.id, req.body?.folder_id || null, req.body?.on_conflict || undefined));
  } catch (error) { return fail(res, error); }
};

export const removeExpedienteHistoricalDocument = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    return res.json({ data: await service.removeHistoricalLink(req.user, req.params.id, req.params.itemId) });
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
