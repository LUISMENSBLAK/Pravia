import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { ExpedienteActivityError, ExpedienteActivityService } from '../services/expedienteActivity.service';

const service = new ExpedienteActivityService(prisma);
const handle = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof ExpedienteActivityError) return res.status(error.status).json({ error: error.message, code: error.code });
  return res.status(500).json({ error: fallback, code: 'EXP009_ACTIVITY_FAILED' });
};

export const listExpedienteActivity = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Inicia sesión para continuar.', code: 'AUTH_REQUIRED' });
    return res.json(await service.list(req.user, req.params.id, req.query));
  } catch (error) { return handle(res, error, 'No pudimos cargar la actividad del expediente.'); }
};

export const addExpedienteActivityNote = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Inicia sesión para continuar.', code: 'AUTH_REQUIRED' });
    const result = await service.addNote(req.user, req.params.id, req.body || {});
    return res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) { return handle(res, error, 'No pudimos guardar la nota.'); }
};
