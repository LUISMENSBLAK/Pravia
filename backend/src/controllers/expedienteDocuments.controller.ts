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

export const getExpedienteAppendixSignedUrl = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    return res.json(await service.signedUrl(req.user, req.params.id, req.params.itemId));
  } catch (error) { return fail(res, error); }
};
