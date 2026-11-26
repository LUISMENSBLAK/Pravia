import type { Request, Response } from 'express';
import { knowledgeService, KnowledgeValidationError } from '../services/knowledge.service';
import { knowledgeRadarService, KnowledgeRadarError } from '../services/knowledgeRadar.service';
import multer from 'multer';
import prisma from '../config/prisma';
import { DOCUMENT_UPLOAD_MAX_BYTES } from '../config/uploadLimits';
import { KnowledgeDocumentService } from '../services/knowledgeDocument.service';
import { PlatformDomainError } from '../platform/platform.errors';

const documents = new KnowledgeDocumentService(prisma);
export const knowledgeUpload = multer({storage:multer.memoryStorage(),limits:{fileSize:DOCUMENT_UPLOAD_MAX_BYTES,files:1,fieldSize:5_000_000,fields:12}});
export const uploadKnowledgeDocument = async(req:Request,res:Response)=>{try{if(!req.file)throw new KnowledgeValidationError('KNOW_FILE_REQUIRED','Selecciona un archivo.');return res.status(201).json(await documents.upload(actor(req),req.body||{},req.file));}catch(error){return fail(res,error);}};
export const readKnowledgeDocument = async(req:Request,res:Response)=>{try{return res.json(await documents.detail(actor(req),req.params.sourceId,req.params.versionId));}catch(error){return fail(res,error);}};

const actor = (req: Request) => ({ id: req.user!.id, organizationId: req.user!.organizationId });
const fail = (res: Response, error: unknown) => error instanceof KnowledgeValidationError
  ? res.status(error.status).json({ code: error.code, error: error.message })
  : error instanceof KnowledgeRadarError
  ? res.status(error.status).json({ code: error.code, error: error.message })
  : error instanceof PlatformDomainError
  ? res.status(error.status).json({code:error.code,error:error.message})
  : res.status(500).json({ code: 'KNOW_OPERATION_FAILED', error: 'No fue posible completar la operación de Biblioteca.' });

export const listKnowledgeSources = async (req: Request, res: Response) => { try { return res.json(await knowledgeService.list(actor(req), req.query)); } catch (error) { return fail(res, error); } };
export const listKnowledgeCriteria = async (req: Request, res: Response) => { try { return res.json(await knowledgeService.listCriteria(actor(req), req.query)); } catch (error) { return fail(res, error); } };
export const createKnowledgeCriterion = async (req: Request, res: Response) => { try { return res.status(201).json({ data: await knowledgeService.createCriterion(actor(req), req.body || {}) }); } catch (error) { return fail(res, error); } };
export const updateKnowledgeCriterion = async (req: Request, res: Response) => { try { return res.json({ data: await knowledgeService.updateCriterion(actor(req), req.params.criterionId, req.body || {}) }); } catch (error) { return fail(res, error); } };
export const importKnowledgeInventory = async (req: Request, res: Response) => { try { return res.status(201).json(await knowledgeService.importInventory(actor(req), req.body?.rows, req.body?.expected_count === undefined ? undefined : Number(req.body.expected_count))); } catch (error) { return fail(res, error); } };
export const addKnowledgeVersion = async (req: Request, res: Response) => { try { return res.status(201).json({ data: await knowledgeService.addVersion(actor(req), req.params.sourceId, req.body || {}) }); } catch (error) { return fail(res, error); } };
export const verifyKnowledgeVersion = async (req: Request, res: Response) => { try { return res.json({ data: await knowledgeService.verifyVersion(actor(req), req.params.sourceId, req.params.versionId, req.body?.effective_from) }); } catch (error) { return fail(res, error); } };
export const retrieveKnowledge = async (req: Request, res: Response) => { try { return res.json(await knowledgeService.retrieve(actor(req), req.body || {})); } catch (error) { return fail(res, error); } };
export const detectKnowledgeVersion = async (req: Request, res: Response) => { try { return res.status(201).json({ data: await knowledgeRadarService.detect(actor(req), req.params.sourceId, req.body || {}) }); } catch (error) { return fail(res, error); } };
export const registerKnowledgeImpact = async (req: Request, res: Response) => { try { return res.status(201).json({ data: await knowledgeRadarService.registerImpact(actor(req), req.params.runId, req.body || {}) }); } catch (error) { return fail(res, error); } };
