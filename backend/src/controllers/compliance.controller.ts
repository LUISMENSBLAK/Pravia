import { Request, Response } from 'express';
import { ComplianceError } from '../domain/compliance';
import { ComplianceReviewService } from '../services/complianceReview.service';
import { ComplianceLegalEngineService } from '../services/complianceLegalEngine.service';
import { downloadFile } from '../services/supabase.service';

const actor = (req: Request) => req.user?.id;
const correlation = (req: Request) => (req as any).correlationId;

const sendError = (res: Response, error: any, fallback: string) => {
  const status = error instanceof ComplianceError ? error.status : error.code === 'P2002' ? 409 : 500;
  const message = error.code === 'P2002' ? 'El registro ya existe.' : error instanceof ComplianceError ? error.message : 'No fue posible completar la operación de cumplimiento.';
  return res.status(status).json({ success: false, error: message, code: error instanceof ComplianceError ? error.code : error.code === 'P2002' ? 'COMPLIANCE_CONFLICT' : fallback });
};

export class ComplianceController {
  static async publishAlertLead(req: Request, res: Response) {
    try { return res.status(201).json({ success: true, revision: await ComplianceLegalEngineService.publishAlertLead(req.user!, req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_ALERT_LEAD_PUBLISH_FAILED'); }
  }

  static async createLegalRule(req: Request, res: Response) {
    try { return res.status(201).json({ success: true, rule: await ComplianceLegalEngineService.createRule(req.user!, req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_LEGAL_RULE_CREATE_FAILED'); }
  }

  static async createLegalRuleRevision(req: Request, res: Response) {
    try { return res.status(201).json({ success: true, revision: await ComplianceLegalEngineService.createRevision(req.user!, req.params.ruleId, req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_LEGAL_RULE_REVISION_CREATE_FAILED'); }
  }

  static async verifyLegalRuleRevision(req: Request, res: Response) {
    try { return res.json({ success: true, revision: await ComplianceLegalEngineService.verifyRevision(req.user!, req.params.ruleId, req.params.revisionId, req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_LEGAL_RULE_REVISION_VERIFY_FAILED'); }
  }

  static async activateLegalRuleRevision(req: Request, res: Response) {
    try { return res.json({ success: true, revision: await ComplianceLegalEngineService.activateRevision(req.user!, req.params.ruleId, req.params.revisionId, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_LEGAL_RULE_REVISION_ACTIVATE_FAILED'); }
  }

  static async evaluateLegalCase(req: Request, res: Response) {
    try { return res.status(201).json({ success: true, evaluation: await ComplianceLegalEngineService.evaluateCase(req.user!, req.params.expedienteId, req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_LEGAL_EVALUATION_FAILED'); }
  }

  static async legalCaseState(req: Request, res: Response) {
    try { return res.json({ success: true, ...(await ComplianceLegalEngineService.readState(req.user!, req.params.expedienteId)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_LEGAL_STATE_FAILED'); }
  }
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

  static async addPayment(req: Request, res: Response) {
    try { return res.status(201).json({ success: true, payment: await ComplianceReviewService.addPayment(req.user!, actor(req), req.params.id, req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_PAYMENT_FAILED'); }
  }

  static async saveBeneficialOwner(req: Request, res: Response) {
    try { return res.status(201).json({ success: true, beneficialOwner: await ComplianceReviewService.saveBeneficialOwner(req.user!, actor(req), req.params.id, req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_BENEFICIAL_OWNER_FAILED'); }
  }

  static async savePepReview(req: Request, res: Response) {
    try { return res.json({ success: true, pepReview: await ComplianceReviewService.savePepReview(req.user!, actor(req), req.params.id, req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_PEP_REVIEW_FAILED'); }
  }

  static async confirmExternalNotice(req: Request, res: Response) {
    try { return res.json({ success: true, obligation: await ComplianceReviewService.confirmExternalNotice(req.user!, actor(req), req.params.id, req.params.obligationId, req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_NOTICE_CONFIRM_FAILED'); }
  }

  static async retireEvidence(req: Request, res: Response) {
    try { return res.json({ success: true, evidence: await ComplianceReviewService.retireEvidence(req.user!, actor(req), req.params.id, req.params.evidenceId, req.body, correlation(req)) }); }
    catch (error) { return sendError(res, error, 'COMPLIANCE_EVIDENCE_RETIRE_FAILED'); }
  }

  static async viewEvidence(req: Request, res: Response) {
    try {
      const document = await ComplianceReviewService.evidenceDocument(req.user!, req.params.id, req.params.evidenceId);
      const buffer = await downloadFile(document.storage_key);
      res.setHeader('Content-Type', document.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(document.nombre_original)}`);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.send(buffer);
    } catch (error) { return sendError(res, error, 'COMPLIANCE_EVIDENCE_VIEW_FAILED'); }
  }
}
