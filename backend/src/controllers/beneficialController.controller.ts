import type { NextFunction, Request, Response } from 'express';
import { BeneficialControllerError, BeneficialControllerService } from '../services/beneficialController.service';

const service = new BeneficialControllerService();

const handle = (error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof BeneficialControllerError) return res.status(error.status).json({ success: false, code: error.code, error: error.message });
  return next(error);
};

const operation = (run: (req: Request & { user: NonNullable<Request['user']> }) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ success: false, error: 'Tu sesión no es válida.' });
      return res.json({ success: true, data: await run(req as Request & { user: NonNullable<Request['user']> }) });
    } catch (error) { return handle(error, req, res, next); }
  };

export class BeneficialControllerController {
  static previewLinks = operation(req => service.previewLinks(req.user, req.params.id, req.body));
  static reconcile = operation(req => service.decideReconciliation(req.user, req.params.id, req.params.proposalId, req.body));
  static previewReconciliation = operation(req => service.previewReconciliation(req.user, req.params.id, req.params.proposalId));
  static proposeAi = operation(req => service.proposeAi(req.user, req.params.id, req.body));
  static readAi = operation(req => service.readAi(req.user, req.params.id, req.params.proposalId));
  static decideAi = operation(req => service.decideAi(req.user, req.params.id, req.params.proposalId, req.body));
  static ensureSociety = operation(req => service.ensureSociety(req.user, req.params.expedienteId, req.body));
  static formatPort = operation(req => service.formatPort(req.user, req.params.expedienteId, req.params.requirementId));
  static async current(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json({ success: false, error: 'Tu sesión no es válida.' });
      return res.json({ success: true, data: await service.current(req.user, req.params.id) });
    } catch (error) { return handle(error, req, res, next); }
  }

  static async save(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json({ success: false, error: 'Tu sesión no es válida.' });
      return res.json({ success: true, data: await service.save(req.user, req.params.id, req.body) });
    } catch (error) { return handle(error, req, res, next); }
  }

  static async caseSummary(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json({ success: false, error: 'Tu sesión no es válida.' });
      return res.json({ success: true, data: await service.caseSummary(req.user, req.params.expedienteId) });
    } catch (error) { return handle(error, req, res, next); }
  }
}
