import type { Request, Response } from 'express';
import multer from 'multer';
import prisma from '../config/prisma';
import { ExpedienteArtifactsError, ExpedienteArtifactsService } from '../services/expedienteArtifacts.service';

const service = new ExpedienteArtifactsService(prisma);
export const uploadExp006Multer = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const actor = (req: Request) => req.user!;
const fail = (res: Response, error: unknown) => {
  if (error instanceof ExpedienteArtifactsError) return res.status(error.status).json({ code: error.code, error: error.message });
  const code = typeof error === 'object' && error && 'code' in error ? String((error as any).code) : 'EXP006_OPERATION_FAILED';
  if (code === 'EXP006_FRONTEND_SOURCE_INJECTION' || code === 'EXP006_INDIVIDUAL_SUBJECT_REQUIRED') return res.status(400).json({ code, error: (error as Error).message });
  return res.status(500).json({ code: 'EXP006_OPERATION_FAILED', error: 'No pudimos completar la operación de Plantillas y formatos.' });
};
const requireAuth = (req: Request, res: Response) => req.user ? true : (res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' }), false);

export const getExpedienteArtifacts = async (req: Request, res: Response) => { try { if (!requireAuth(req, res)) return; return res.json(await service.read(actor(req), req.params.id)); } catch (error) { return fail(res, error); } };
export const materializeExpedienteArtifacts = async (req: Request, res: Response) => { try { if (!requireAuth(req, res)) return; return res.json(await service.materialize(actor(req), req.params.id, String(req.body?.expected_revision || ''))); } catch (error) { return fail(res, error); } };
export const previewExpedienteArtifactGeneration = async (req: Request, res: Response) => { try { if (!requireAuth(req, res)) return; return res.json(await service.generationPreview(actor(req), req.params.id, req.params.pendingId, req.body?.document_ids)); } catch (error) { return fail(res, error); } };
export const generateExpedienteArtifact = async (req: Request, res: Response) => { try { if (!requireAuth(req, res)) return; return res.json(await service.generate(actor(req), req.params.id, req.params.pendingId, req.body)); } catch (error) { return fail(res, error); } };
export const uploadExpedienteArtifact = async (req: Request, res: Response) => { try { if (!requireAuth(req, res)) return; if (!req.file) throw new ExpedienteArtifactsError(400, 'EXP006_FILE_REQUIRED', 'Selecciona un archivo.'); return res.json(await service.uploadExternal(actor(req), req.params.id, req.params.pendingId, { expected_version: Number(req.body?.expected_version), idempotency_key: String(req.body?.idempotency_key || '') }, req.file)); } catch (error) { return fail(res, error); } };
export const validateExpedienteArtifact = async (req: Request, res: Response) => { try { if (!requireAuth(req, res)) return; return res.json(await service.validate(actor(req), req.params.id, req.params.pendingId, req.body)); } catch (error) { return fail(res, error); } };
export const getExpedienteArtifactUrl = async (req: Request, res: Response) => { try { if (!requireAuth(req, res)) return; return res.json(await service.signedUrl(actor(req), req.params.id, req.params.pendingId)); } catch (error) { return fail(res, error); } };
