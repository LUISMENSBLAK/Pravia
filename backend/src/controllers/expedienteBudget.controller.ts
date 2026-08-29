import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { BudgetValidationError } from '../domain/expedienteBudget';
import { ExpedienteBudgetError, ExpedienteBudgetService, type BudgetActor } from '../services/expedienteBudget.service';

const service = new ExpedienteBudgetService(prisma);
const actor = (req: Request): BudgetActor => ({
  id: req.user!.id, organizationId: req.user!.organizationId, sessionId: req.user!.sessionId,
  rol: req.user!.rol, permissions: req.user!.permissions,
});
const fail = (res: Response, error: unknown) => {
  if (error instanceof ExpedienteBudgetError) return res.status(error.status).json({ code: error.code, error: error.message });
  if (error instanceof BudgetValidationError) return res.status(400).json({ code: error.code, error: error.message });
  return res.status(500).json({ code: 'EXP007_OPERATION_FAILED', error: 'No pudimos completar la operación del presupuesto.' });
};

export const getExpedienteBudget = async (req: Request, res: Response) => {
  try { return res.json(await service.read(actor(req), req.params.id)); }
  catch (error) { return fail(res, error); }
};

export const updateExpedienteBudget = async (req: Request, res: Response) => {
  try { return res.json(await service.save(actor(req), req.params.id, { expected_version: Number(req.body.expected_version), concepts: req.body.concepts, distribution: req.body.distribution })); }
  catch (error) { return fail(res, error); }
};

export const generateExpedienteBudgetPdf = async (req: Request, res: Response) => {
  try { return res.status(201).json(await service.generatePdf(actor(req), req.params.id, { expected_version: Number(req.body.expected_version), idempotency_key: req.body.idempotency_key, note: req.body.note })); }
  catch (error) { return fail(res, error); }
};

export const getExpedienteBudgetPdfUrl = async (req: Request, res: Response) => {
  try { return res.json(await service.signedUrl(actor(req), req.params.id, req.params.historyId)); }
  catch (error) { return fail(res, error); }
};

export const deleteExpedienteBudgetPdf = async (req: Request, res: Response) => {
  try { return res.json(await service.deletePdf(actor(req), req.params.id, req.params.historyId, req.body?.reason)); }
  catch (error) { return fail(res, error); }
};
