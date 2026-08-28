import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { ExpedientePrediosService } from '../services/expedientePredios.service';
import { PredioError } from '../services/predios.service';

const service = new ExpedientePrediosService(prisma);
const actor = (req: Request) => { if (!req.user) throw new PredioError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.'); return req.user; };
const error = (res: Response, cause: unknown) => cause instanceof PredioError
  ? res.status(cause.status).json({ code: cause.code, error: cause.message })
  : res.status(500).json({ code: 'PREDIO_RELATION_FAILED', error: 'No fue posible completar la relación del inmueble.' });

export const listExpedientePredios = async (req: Request, res: Response) => { try { return res.json(await service.list(actor(req), req.params.id)); } catch (cause) { return error(res, cause); } };
export const searchExpedientePredios = async (req: Request, res: Response) => { try { return res.json(await service.search(actor(req), req.params.id, String(req.query.search || ''))); } catch (cause) { return error(res, cause); } };
export const getExpedientePredioCatalogs = async (req: Request, res: Response) => { try { return res.json({ data: await service.catalogs(actor(req), req.params.id) }); } catch (cause) { return error(res, cause); } };
export const previewExpedientePredioChange = async (req: Request, res: Response) => { try { return res.json(await service.preview(actor(req), req.params.id, req.body || {})); } catch (cause) { return error(res, cause); } };
export const applyExpedientePredioChange = async (req: Request, res: Response) => { try { return res.json(await service.apply(actor(req), req.params.id, req.body || {})); } catch (cause) { return error(res, cause); } };
