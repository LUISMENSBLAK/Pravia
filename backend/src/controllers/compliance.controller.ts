import { Request, Response } from 'express';
import { ComplianceError } from '../domain/compliance';
import { ComplianceReviewService } from '../services/complianceReview.service';

const actor = (req: Request) => req.user?.id;
const correlation = (req: Request) => (req as any).correlationId;

const sendError = (res: Response, error: any, fallback: string) => {
  const status = error instanceof ComplianceError ? error.status : error.code === 'P2002' ? 409 : 500;
  const message = error.code === 'P2002' ? 'El registro ya existe.' : error instanceof ComplianceError ? error.message : 'No fue posible completar la operación de cumplimiento.';
  return res.status(status).json({ success: false, error: message, code: error instanceof ComplianceError ? error.code : error.code === 'P2002' ? 'COMPLIANCE_CONFLICT' : fallback });
};

export class ComplianceController {
  static async catalogs(req: Request, res: Response) {
    try { return res.json({ success: true, ...(await ComplianceReviewService.catalogs(req.user!)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_CATALOGS_FAILED'); }
  }

  static async list(req: Request, res: Response) {
    try { return res.json({ success: true, ...(await ComplianceReviewService.list(req.user!, req.query)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_LIST_FAILED'); }
  }

  static async detail(req: Request, res: Response) {
    try { return res.json({ success: true, ...(await ComplianceReviewService.detail(req.user!, req.params.id)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_DETAIL_FAILED'); }
  }

  static async create(req: Request, res: Response) {
    try { return res.status(201).json({ success: true, revision: await ComplianceReviewService.create(req.user!, actor(req), req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_CREATE_FAILED'); }
  }

  static async evaluate(req: Request, res: Response) {
    try { return res.json({ success: true, revision: await ComplianceReviewService.evaluate(req.user!, actor(req), req.params.id, req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_EVALUATE_FAILED'); }
  }

  static async review(req: Request, res: Response) {
    try { return res.json({ success: true, revision: await ComplianceReviewService.decide(req.user!, actor(req), req.params.id, req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_REVIEW_FAILED'); }
  }

  static async reevaluate(req: Request, res: Response) {
    try { return res.status(201).json({ success: true, revision: await ComplianceReviewService.reevaluate(req.user!, actor(req), req.params.id, req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_REEVALUATE_FAILED'); }
  }

  static async addEvidence(req: Request, res: Response) {
    try { return res.status(201).json({ success: true, evidencia: await ComplianceReviewService.addEvidence(req.user!, actor(req), req.params.id, req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_EVIDENCE_FAILED'); }
  }
}
