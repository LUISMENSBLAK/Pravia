import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { ExpedienteActoError, ExpedienteActosService } from '../services/expedienteActos.service';

const service = new ExpedienteActosService(prisma);
const actor = (req: Request) => {
  if (!req.user) throw new ExpedienteActoError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
  return req.user;
};
const handle = (error: unknown, res: Response) => {
  if (error instanceof ExpedienteActoError) return res.status(error.status).json({ code: error.code, error: error.message });
  return res.status(500).json({ code: 'EXPEDIENTE_ACT_OPERATION_FAILED', error: 'No pudimos completar el cambio de acto.' });
};

export async function listExpedienteActos(req: Request, res: Response) {
  try { return res.json(await service.list(actor(req), req.params.id)); } catch (error) { return handle(error, res); }
}

export async function previewExpedienteActoChange(req: Request, res: Response) {
  try { return res.json(await service.preview(actor(req), req.params.id, req.body)); } catch (error) { return handle(error, res); }
}

export async function applyExpedienteActoChange(req: Request, res: Response) {
  try {
    const result = await service.apply(actor(req), req.params.id, req.body);
    return res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) { return handle(error, res); }
}
