import type { Request, Response } from 'express';
import multer from 'multer';
import prisma from '../config/prisma';
import { ExpedienteFinanceError, ExpedienteFinanceService } from '../services/expedienteFinance.service';
import { ExpedienteFinanceValidationError } from '../domain/expedienteFinance';

const service = new ExpedienteFinanceService(prisma);
export const uploadExp008 = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 2 } });
const actor = (req: Request) => req.user!;
const fail = (res: Response, error: unknown) => {
  if (error instanceof ExpedienteFinanceError) return res.status(error.status).json({ code: error.code, error: error.message });
  if (error instanceof ExpedienteFinanceValidationError) return res.status(400).json({ code: error.code, error: error.message });
  return res.status(500).json({ code: 'EXP008_OPERATION_FAILED', error: 'No pudimos completar la operación financiera.' });
};
const file = (req: Request) => req.file as Express.Multer.File | undefined;

export const getExpedienteFinance = async (req: Request, res: Response) => { try { return res.json(await service.read(actor(req), req.params.id)); } catch (error) { return fail(res, error); } };
export const reportExpedienteIncome = async (req: Request, res: Response) => { try { if (!file(req)) throw new ExpedienteFinanceError(400, 'EXP008_FILE_REQUIRED', 'Selecciona un comprobante.'); return res.status(201).json(await service.reportIncome(actor(req), req.params.id, req.body, file(req)!)); } catch (error) { return fail(res, error); } };
export const createInternalPaymentRequest = async (req: Request, res: Response) => { try { return res.status(201).json(await service.createInternalRequest(actor(req), req.params.id, req.body)); } catch (error) { return fail(res, error); } };
export const createExternalPaymentRequest = async (req: Request, res: Response) => { try { if (!file(req)) throw new ExpedienteFinanceError(400, 'EXP008_FILE_REQUIRED', 'Selecciona la ficha origen.'); return res.status(201).json(await service.createExternalRequest(actor(req), req.params.id, req.body, file(req)!)); } catch (error) { return fail(res, error); } };
export const proposeExpedienteFinanceAI = async (req: Request, res: Response) => { try { return res.status(201).json(await service.proposeFromDocument(actor(req), req.params.id, req.body)); } catch (error) { return fail(res, error); } };
export const validateExpedienteFinanceAI = async (req: Request, res: Response) => { try { return res.json(await service.validateProposal(actor(req), req.params.id, req.params.proposalId, req.body)); } catch (error) { return fail(res, error); } };
export const applyExpedienteIncome = async (req: Request, res: Response) => { try { return res.json(await service.applyIncome(actor(req), req.params.id, req.params.incomeId, req.body)); } catch (error) { return fail(res, error); } };
export const payExpedienteRequest = async (req: Request, res: Response) => { try { const files = req.files as Record<string, Express.Multer.File[]> | undefined; return res.json(await service.payRequest(actor(req), req.params.id, req.params.requestId, req.body, { payment: files?.payment_proof?.[0], fiscal: files?.fiscal_document?.[0] })); } catch (error) { return fail(res, error); } };
export const generateExpedientePraviaReceipt = async (req: Request, res: Response) => { try { return res.status(201).json(await service.generatePraviaReceipt(actor(req), req.params.id, req.params.movementId, req.body)); } catch (error) { return fail(res, error); } };
export const verifyExpedientePraviaReceipt = async (req: Request, res: Response) => { try { return res.json(await service.verifyReceipt(actor(req), req.params.token)); } catch (error) { return fail(res, error); } };
export const getExpedienteFinanceDocumentUrl = async (req: Request, res: Response) => { try { return res.json(await service.signedUrl(actor(req), req.params.id, req.params.linkId)); } catch (error) { return fail(res, error); } };
export const retireExpedienteFinanceDocument = async (req: Request, res: Response) => { try { return res.json(await service.retireDocument(actor(req), req.params.id, req.params.linkId, req.body?.reason)); } catch (error) { return fail(res, error); } };
export const voidExpedienteIncome = async (req: Request, res: Response) => { try { return res.json(await service.voidRecord(actor(req), req.params.id, 'income', req.params.incomeId, req.body?.reason)); } catch (error) { return fail(res, error); } };
export const voidExpedientePaymentRequest = async (req: Request, res: Response) => { try { return res.json(await service.voidRecord(actor(req), req.params.id, 'request', req.params.requestId, req.body?.reason)); } catch (error) { return fail(res, error); } };
