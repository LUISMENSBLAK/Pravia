import type { Request, Response } from 'express';
import { ComplianceError } from '../domain/compliance';
import { QuestionnaireError } from '../domain/questionnaire';
import { questionnaireCatalogService } from '../services/questionnaireCatalog.service';

const actor = (req: Request) => {
  if (!req.user) throw new QuestionnaireError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
  return req.user;
};
const respond = (handler: (req: Request) => Promise<unknown>, success = 200) => async (req: Request, res: Response) => {
  try { return res.status(success).json({ success: true, data: await handler(req) }); }
  catch (error) {
    if (error instanceof QuestionnaireError || error instanceof ComplianceError) {
      return res.status(error.status).json({ code: error.code, error: error.message });
    }
    console.error('Expediente questionnaire error', error);
    return res.status(500).json({ code: 'QUESTIONNAIRE_INTERNAL_ERROR', error: 'No fue posible completar la operación del cuestionario.' });
  }
};

export const listExpedienteQuestionnaires = respond((req) => questionnaireCatalogService.listApplicable(actor(req), req.params.id));
export const ensureExpedienteQuestionnaires = respond((req) => questionnaireCatalogService.ensureApplicable(actor(req), req.params.id), 201);
export const listExpedienteQuestionnaireAnswers = respond((req) => questionnaireCatalogService.listAnswers(actor(req), req.params.id));
export const saveExpedienteQuestionnaireAnswers = respond((req) => questionnaireCatalogService.saveAnswers(actor(req), req.params.id, req.body), 201);
