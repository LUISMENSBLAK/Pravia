import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { ExpedienteSeguimientoError, ExpedienteSeguimientoService } from '../services/expedienteSeguimiento.service';

const service = new ExpedienteSeguimientoService(prisma);
const actor = (req: Request) => {
  if (!req.user) throw new ExpedienteSeguimientoError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
  return req.user;
};
const failure = (res: Response, error: unknown) => {
  if (error instanceof ExpedienteSeguimientoError) return res.status(error.status).json({ code: error.code, error: error.message });
  return res.status(500).json({ code: 'EXP005_OPERATION_FAILED', error: 'No pudimos completar la operación de seguimiento.' });
};

export const getExpedienteSeguimiento = async (req: Request, res: Response) => {
  try { return res.json(await service.read(actor(req), req.params.id)); } catch (error) { return failure(res, error); }
};
export const materializeExpedienteSeguimiento = async (req: Request, res: Response) => {
  try { return res.json(await service.materialize(actor(req), req.params.id)); } catch (error) { return failure(res, error); }
};
export const updateExpedienteSeguimientoActividad = async (req: Request, res: Response) => {
  try { return res.json(await service.update(actor(req), req.params.id, req.params.activityId, req.body)); } catch (error) { return failure(res, error); }
};
export const reopenExpedienteSeguimientoActividad = async (req: Request, res: Response) => {
  try { return res.json(await service.reopen(actor(req), req.params.id, req.params.activityId, req.body)); } catch (error) { return failure(res, error); }
};
