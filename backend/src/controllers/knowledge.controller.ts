import type { Request, Response } from 'express';
import { knowledgeService, KnowledgeValidationError } from '../services/knowledge.service';
import { knowledgeRadarService, KnowledgeRadarError } from '../services/knowledgeRadar.service';

const actor = (req: Request) => ({ id: req.user!.id, organizationId: req.user!.organizationId });
const fail = (res: Response, error: unknown) => error instanceof KnowledgeValidationError
  ? res.status(error.status).json({ code: error.code, error: error.message })
  : error instanceof KnowledgeRadarError
  ? res.status(error.status).json({ code: error.code, error: error.message })
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
