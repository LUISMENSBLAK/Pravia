import { Request, Response } from "express";
import { ComplianceError } from "../domain/compliance";
import { ComplianceReviewService } from "../services/complianceReview.service";
import { ComplianceLegalEngineService } from "../services/complianceLegalEngine.service";
import { ComplianceDocumentService } from "../services/complianceDocument.service";
import { downloadFile } from "../services/supabase.service";
import {
  complianceScreeningService,
  ScreeningError,
} from "../services/complianceScreening.service";
import { ComplianceH5Service } from "../services/complianceH5.service";

const actor = (req: Request) => req.user?.id;
const correlation = (req: Request) => (req as any).correlationId;

const sendError = (res: Response, error: any, fallback: string) => {
  const controlled =
    error instanceof ComplianceError || error instanceof ScreeningError;
  const status = controlled ? error.status : error.code === "P2002" ? 409 : 500;
  const message =
    error.code === "P2002"
      ? "El registro ya existe."
      : controlled
        ? error.message
        : "No fue posible completar la operación de cumplimiento.";
  return res
    .status(status)
    .json({
      success: false,
      error: message,
      code: controlled
        ? error.code
        : error.code === "P2002"
          ? "COMPLIANCE_CONFLICT"
          : fallback,
    });
};

export class ComplianceController {
  static async h5Workspace(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        data: await ComplianceH5Service.readWorkspace(req.user!, req.params.id),
      });
    } catch (error) {
      return sendError(res, error, "H5_WORKSPACE_FAILED");
    }
  }

  static async publishH5QuestionnaireDefinition(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          data: await ComplianceH5Service.publishQuestionnaireDefinition(
            req.user!,
            req.params.artifactId,
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "H5_QUESTIONNAIRE_DEFINITION_FAILED");
    }
  }

  static async ensureH5Questionnaires(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          data: await ComplianceH5Service.ensureQuestionnaires(
            req.user!,
            req.params.id,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "H5_QUESTIONNAIRE_ENSURE_FAILED");
    }
  }

  static async saveH5Questionnaire(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          data: await ComplianceH5Service.saveQuestionnaire(
            req.user!,
            req.params.assessmentId,
            req.body,
            false,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "H5_QUESTIONNAIRE_SAVE_FAILED");
    }
  }

  static async finalizeH5Questionnaire(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          data: await ComplianceH5Service.saveQuestionnaire(
            req.user!,
            req.params.assessmentId,
            req.body,
            true,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "H5_QUESTIONNAIRE_FINALIZE_FAILED");
    }
  }

  static async h5QuestionnairePdf(req: Request, res: Response) {
    try {
      const result = await ComplianceH5Service.questionnairePdf(
        req.user!,
        req.params.assessmentId,
        req.method === "POST",
      );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      );
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(result.buffer);
    } catch (error) {
      return sendError(res, error, "H5_QUESTIONNAIRE_PDF_FAILED");
    }
  }

  static async publishH5Methodology(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          data: await ComplianceH5Service.publishMethodology(
            req.user!,
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "H5_METHODOLOGY_PUBLISH_FAILED");
    }
  }

  static async saveH5Payment(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          data: await ComplianceH5Service.createPaymentRevision(
            req.user!,
            req.params.id,
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "H5_PAYMENT_SAVE_FAILED");
    }
  }

  static async verifyH5Payment(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          data: await ComplianceH5Service.verifyPayment(
            req.user!,
            req.params.paymentRevisionId,
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "H5_PAYMENT_VERIFICATION_FAILED");
    }
  }

  static async confirmH5Provider(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          data: await ComplianceH5Service.confirmProvider(
            req.user!,
            req.params.paymentRevisionId,
            req.params.relationId,
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "H5_PROVIDER_CONFIRMATION_FAILED");
    }
  }

  static async prepareH5PaymentProposal(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          data: await ComplianceH5Service.preparePaymentProposal(
            req.user!,
            req.params.id,
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "H5_PAYMENT_PROPOSAL_FAILED");
    }
  }

  static async confirmH5PaymentProposal(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          data: await ComplianceH5Service.confirmPaymentProposal(
            req.user!,
            req.params.proposalId,
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "H5_PAYMENT_PROPOSAL_CONFIRM_FAILED");
    }
  }

  static async rejectH5PaymentProposal(req: Request, res: Response) {
    try {
      return res.status(200).json({
        success: true,
        data: await ComplianceH5Service.rejectPaymentProposal(
          req.user!,
          req.params.proposalId,
          req.body,
          correlation(req),
        ),
      });
    } catch (error) {
      return sendError(res, error, "H5_PAYMENT_PROPOSAL_REJECT_FAILED");
    }
  }
  static async screeningCurrent(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        ...(await complianceScreeningService.current(
          req.user!,
          req.params.comparecienteId,
        )),
      });
    } catch (error) {
      return sendError(res, error, "SCREENING_CURRENT_FAILED");
    }
  }

  static async screeningRerun(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          data: await complianceScreeningService.manualRerun(
            req.user!,
            req.params.comparecienteId,
            String(
              req.body.idempotency_key || req.header("idempotency-key") || "",
            ),
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "SCREENING_RERUN_FAILED");
    }
  }

  static async screeningTechnicalRetry(req: Request, res: Response) {
    try {
      return res
        .status(200)
        .json({
          success: true,
          data: await complianceScreeningService.technicalRetry(
            req.user!,
            req.params.comparecienteId,
            req.params.queryId,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "SCREENING_TECHNICAL_RETRY_FAILED");
    }
  }

  static async screeningResolve(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          resolution: await complianceScreeningService.resolve(
            req.user!,
            req.params.comparecienteId,
            req.params.queryId,
            req.params.candidateId,
            String(req.body.decision || ""),
            String(req.body.rationale || ""),
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "SCREENING_RESOLUTION_FAILED");
    }
  }

  static async screeningReport(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          ...(await complianceScreeningService.generateReport(
            req.user!,
            req.params.comparecienteId,
            req.params.queryId,
            String(
              req.body.idempotency_key || req.header("idempotency-key") || "",
            ),
            correlation(req),
          )),
        });
    } catch (error) {
      return sendError(res, error, "SCREENING_REPORT_FAILED");
    }
  }

  static async screeningFree(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          data: await complianceScreeningService.freeSearch(
            req.user!,
            req.body.identity,
            String(
              req.body.idempotency_key || req.header("idempotency-key") || "",
            ),
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "SCREENING_FREE_FAILED");
    }
  }

  static async screeningOperation(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        ...(await complianceScreeningService.operationStatus(
          req.user!,
          req.params.expedienteId,
        )),
      });
    } catch (error) {
      return sendError(res, error, "SCREENING_OPERATION_FAILED");
    }
  }

  static async screeningSources(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        data: await complianceScreeningService.listSources(req.user!),
      });
    } catch (error) {
      return sendError(res, error, "SCREENING_SOURCES_FAILED");
    }
  }

  static async createScreeningSource(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          data: await complianceScreeningService.createSource(
            req.user!,
            req.body,
          ),
        });
    } catch (error) {
      return sendError(res, error, "SCREENING_SOURCE_CREATE_FAILED");
    }
  }

  static async createScreeningSourceVersion(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          data: await complianceScreeningService.createSourceVersion(
            req.user!,
            req.params.sourceId,
            req.body,
          ),
        });
    } catch (error) {
      return sendError(res, error, "SCREENING_SOURCE_VERSION_CREATE_FAILED");
    }
  }

  static async activateScreeningSourceVersion(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        data: await complianceScreeningService.activateSourceVersion(
          req.user!,
          req.params.sourceId,
          req.params.versionId,
        ),
      });
    } catch (error) {
      return sendError(res, error, "SCREENING_SOURCE_VERSION_ACTIVATE_FAILED");
    }
  }
  static async documentStructure(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        ...(await ComplianceDocumentService.read(
          req.user!,
          req.params.expedienteId,
        )),
      });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_DOCUMENT_STRUCTURE_FAILED");
    }
  }

  static async linkDocumentEvidence(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          ...(await ComplianceDocumentService.linkExisting(
            req.user!,
            req.params.expedienteId,
            req.params.requirementId,
            String(req.body.document_id || ""),
            correlation(req),
          )),
        });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_DOCUMENT_LINK_FAILED");
    }
  }

  static async uploadSignedEvidence(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          ...(await ComplianceDocumentService.uploadSigned(
            req.user!,
            req.params.expedienteId,
            req.params.requirementId,
            req.file!,
            correlation(req),
          )),
        });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_SIGNED_UPLOAD_FAILED");
    }
  }

  static async validateDocumentEvidence(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        evidence: await ComplianceDocumentService.validate(
          req.user!,
          req.params.expedienteId,
          req.params.evidenceId,
          req.body,
          correlation(req),
        ),
      });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_DOCUMENT_VALIDATION_FAILED");
    }
  }

  static async exportDocumentPackage(req: Request, res: Response) {
    try {
      const exported = await ComplianceDocumentService.exportPackage(
        req.user!,
        req.params.expedienteId,
        correlation(req),
      );
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`,
      );
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(exported.buffer);
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_DOCUMENT_EXPORT_FAILED");
    }
  }

  static async publishAlertLead(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          revision: await ComplianceLegalEngineService.publishAlertLead(
            req.user!,
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_ALERT_LEAD_PUBLISH_FAILED");
    }
  }

  static async createLegalRule(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          rule: await ComplianceLegalEngineService.createRule(
            req.user!,
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_LEGAL_RULE_CREATE_FAILED");
    }
  }

  static async createLegalRuleRevision(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          revision: await ComplianceLegalEngineService.createRevision(
            req.user!,
            req.params.ruleId,
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(
        res,
        error,
        "COMPLIANCE_LEGAL_RULE_REVISION_CREATE_FAILED",
      );
    }
  }

  static async verifyLegalRuleRevision(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        revision: await ComplianceLegalEngineService.verifyRevision(
          req.user!,
          req.params.ruleId,
          req.params.revisionId,
          req.body,
          correlation(req),
        ),
      });
    } catch (error) {
      return sendError(
        res,
        error,
        "COMPLIANCE_LEGAL_RULE_REVISION_VERIFY_FAILED",
      );
    }
  }

  static async activateLegalRuleRevision(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        revision: await ComplianceLegalEngineService.activateRevision(
          req.user!,
          req.params.ruleId,
          req.params.revisionId,
          correlation(req),
        ),
      });
    } catch (error) {
      return sendError(
        res,
        error,
        "COMPLIANCE_LEGAL_RULE_REVISION_ACTIVATE_FAILED",
      );
    }
  }

  static async evaluateLegalCase(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          evaluation: await ComplianceLegalEngineService.evaluateCase(
            req.user!,
            req.params.expedienteId,
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_LEGAL_EVALUATION_FAILED");
    }
  }

  static async legalCaseState(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        ...(await ComplianceLegalEngineService.readState(
          req.user!,
          req.params.expedienteId,
        )),
      });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_LEGAL_STATE_FAILED");
    }
  }
  static async catalogs(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        ...(await ComplianceReviewService.catalogs(req.user!)),
      });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_CATALOGS_FAILED");
    }
  }

  static async list(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        ...(await ComplianceReviewService.list(req.user!, req.query)),
      });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_LIST_FAILED");
    }
  }

  static async detail(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        ...(await ComplianceReviewService.detail(req.user!, req.params.id)),
      });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_DETAIL_FAILED");
    }
  }

  static async create(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          revision: await ComplianceReviewService.create(
            req.user!,
            actor(req),
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_CREATE_FAILED");
    }
  }

  static async evaluate(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        revision: await ComplianceReviewService.evaluate(
          req.user!,
          actor(req),
          req.params.id,
          req.body,
          correlation(req),
        ),
      });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_EVALUATE_FAILED");
    }
  }

  static async review(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        revision: await ComplianceReviewService.decide(
          req.user!,
          actor(req),
          req.params.id,
          req.body,
          correlation(req),
        ),
      });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_REVIEW_FAILED");
    }
  }

  static async reevaluate(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          revision: await ComplianceReviewService.reevaluate(
            req.user!,
            actor(req),
            req.params.id,
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_REEVALUATE_FAILED");
    }
  }

  static async addEvidence(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          evidencia: await ComplianceReviewService.addEvidence(
            req.user!,
            actor(req),
            req.params.id,
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_EVIDENCE_FAILED");
    }
  }

  static async addPayment(req: Request, res: Response) {
    try {
      return ComplianceH5Service.legacyPaymentGone();
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_PAYMENT_FAILED");
    }
  }

  static async saveBeneficialOwner(req: Request, res: Response) {
    try {
      return res
        .status(201)
        .json({
          success: true,
          beneficialOwner: await ComplianceReviewService.saveBeneficialOwner(
            req.user!,
            actor(req),
            req.params.id,
            req.body,
            correlation(req),
          ),
        });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_BENEFICIAL_OWNER_FAILED");
    }
  }

  static async savePepReview(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        pepReview: await ComplianceReviewService.savePepReview(
          req.user!,
          actor(req),
          req.params.id,
          req.body,
          correlation(req),
        ),
      });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_PEP_REVIEW_FAILED");
    }
  }

  static async confirmExternalNotice(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        obligation: await ComplianceReviewService.confirmExternalNotice(
          req.user!,
          actor(req),
          req.params.id,
          req.params.obligationId,
          req.body,
          correlation(req),
        ),
      });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_NOTICE_CONFIRM_FAILED");
    }
  }

  static async retireEvidence(req: Request, res: Response) {
    try {
      return res.json({
        success: true,
        evidence: await ComplianceReviewService.retireEvidence(
          req.user!,
          actor(req),
          req.params.id,
          req.params.evidenceId,
          req.body,
          correlation(req),
        ),
      });
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_EVIDENCE_RETIRE_FAILED");
    }
  }

  static async viewEvidence(req: Request, res: Response) {
    try {
      const document = await ComplianceReviewService.evidenceDocument(
        req.user!,
        req.params.id,
        req.params.evidenceId,
      );
      const buffer = await downloadFile(document.storage_key);
      res.setHeader(
        "Content-Type",
        document.mime_type || "application/octet-stream",
      );
      res.setHeader(
        "Content-Disposition",
        `${req.query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(document.nombre_original)}`,
      );
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(buffer);
    } catch (error) {
      return sendError(res, error, "COMPLIANCE_EVIDENCE_VIEW_FAILED");
    }
  }
}
