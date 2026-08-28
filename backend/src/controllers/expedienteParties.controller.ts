import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { ExpedientePartiesService, ExpedientePartyError } from '../services/expedienteParties.service';

const service = new ExpedientePartiesService(prisma);
const actor = (req: Request) => {
  if (!req.user) throw new ExpedientePartyError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
  return req.user;
};
const handle = (error: unknown, res: Response) => {
  if (error instanceof ExpedientePartyError) return res.status(error.status).json({ code: error.code, error: error.message });
  return res.status(500).json({ code: 'EXPEDIENTE_PARTY_OPERATION_FAILED', error: 'No pudimos completar el cambio de compareciente.' });
};

export async function listExpedienteParties(req: Request, res: Response) {
  try { return res.json(await service.list(actor(req), req.params.id)); } catch (error) { return handle(error, res); }
}

export async function searchExpedienteParties(req: Request, res: Response) {
  try { return res.json(await service.search(actor(req), req.params.id, String(req.query.search || ''))); } catch (error) { return handle(error, res); }
}

export async function getExpedientePartyCatalogs(req: Request, res: Response) {
  try { return res.json(await service.catalogs(actor(req), req.params.id)); } catch (error) { return handle(error, res); }
}

export async function previewExpedientePartyChange(req: Request, res: Response) {
  try { return res.json(await service.preview(actor(req), req.params.id, req.body)); } catch (error) { return handle(error, res); }
}

export async function applyExpedientePartyChange(req: Request, res: Response) {
  try {
    const result = await service.apply(actor(req), req.params.id, req.body);
    return res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) { return handle(error, res); }
}
