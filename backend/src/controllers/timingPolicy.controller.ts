import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { timingPolicyService, timingSourceService, TimingPolicyError } from '../services/timingPolicy.service';

const actor = (req: Request) => {
  if (!req.user) throw new TimingPolicyError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
  return req.user;
};

const failure = (res: Response, error: unknown) => {
  if (error instanceof TimingPolicyError) return res.status(error.status).json({ code: error.code, error: error.message });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ code: 'TIMING_POLICY_CONFLICT', error: 'La configuración cambió al mismo tiempo. Actualiza la sección y vuelve a intentarlo.' });
  if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2003', 'P2010'].includes(error.code)) return res.status(409).json({ code: 'TIMING_POLICY_INTEGRITY', error: 'La operación no es compatible con el historial vigente.' });
  console.error('G0-C timing policy error', error);
  return res.status(500).json({ code: 'TIMING_POLICY_INTERNAL_ERROR', error: 'No fue posible completar la operación temporal.' });
};

export const listTimingPolicies = async (req: Request, res: Response) => {
  try { return res.json({ success: true, data: await timingPolicyService.list(actor(req)) }); }
  catch (error) { return failure(res, error); }
};

export const publishTimingPolicy = async (req: Request, res: Response) => {
  try {
    const idempotencyKey = req.header('idempotency-key') || req.body?.idempotencyKey;
    return res.status(201).json({ success: true, data: await timingPolicyService.publish(actor(req), { ...req.body, idempotencyKey }) });
  } catch (error) { return failure(res, error); }
};

export const readTimingSource = async (req: Request, res: Response) => {
  try { return res.json({ success: true, data: await timingSourceService.read(actor(req), req.params.type, req.params.sourceId) }); }
  catch (error) { return failure(res, error); }
};
