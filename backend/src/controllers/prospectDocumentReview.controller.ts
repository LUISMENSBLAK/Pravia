import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { ProspectDocumentReviewError, ProspectDocumentReviewService } from '../services/prospectDocumentReview.service';

const service = new ProspectDocumentReviewService(prisma);
const failed = (res: Response, error: unknown) => {
  if (error instanceof ProspectDocumentReviewError) return res.status(error.status).json({ error: error.message, code: error.code });
  console.error('Prospect document review failed:', error);
  return res.status(500).json({ error: 'No pudimos completar la revisión documental. No se guardó ningún resultado.', code: 'PROSPECT_REVIEW_FAILED' });
};

export const getProspectDocumentReview = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
  try { return res.json(await service.latest(req.user, req.params.id)); }
  catch (error) { return failed(res, error); }
};

export const runProspectDocumentReview = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
  try { return res.status(201).json(await service.run(req.user, req.params.id)); }
  catch (error) { return failed(res, error); }
};
