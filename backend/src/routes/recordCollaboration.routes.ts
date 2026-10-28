import { Router, type Request, type Response } from 'express';
import prisma from '../config/prisma';
import { RecordCollaborationError, RecordCollaborationService, type CollaboratedKind } from '../services/recordCollaboration.service';

const router = Router();
const service = new RecordCollaborationService(prisma);
const kinds = new Set<CollaboratedKind>(['prospecto', 'cotizacion', 'expediente']);
const parseKind = (value: string): CollaboratedKind | null => kinds.has(value as CollaboratedKind) ? value as CollaboratedKind : null;
const respondError = (res: Response, error: unknown) => error instanceof RecordCollaborationError
  ? res.status(error.status).json({ code: error.code, error: error.message })
  : res.status(500).json({ code: 'COLLABORATION_FAILED', error: 'No fue posible actualizar los colaboradores.' });

router.get('/:kind/:id/asistentes', async (req: Request, res: Response) => {
  const kind = parseKind(req.params.kind);
  if (!kind) return res.status(404).json({ code: 'COLLAB_KIND_INVALID' });
  try { return res.json({ data: await service.list(req.user!, kind, req.params.id) }); }
  catch (error) { return respondError(res, error); }
});

router.get('/:kind/:id/asistentes/candidatos', async (req: Request, res: Response) => {
  const kind = parseKind(req.params.kind);
  if (!kind) return res.status(404).json({ code: 'COLLAB_KIND_INVALID' });
  try { return res.json({ data: await service.candidates(req.user!, kind, req.params.id) }); }
  catch (error) { return respondError(res, error); }
});

router.post('/:kind/:id/asistentes', async (req: Request, res: Response) => {
  const kind = parseKind(req.params.kind);
  if (!kind) return res.status(404).json({ code: 'COLLAB_KIND_INVALID' });
  const userId = String(req.body?.user_id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return res.status(400).json({ code: 'COLLAB_USER_INVALID', error: 'Selecciona un usuario válido.' });
  }
  try { const result = await service.assign(req.user!, kind, req.params.id, userId); return res.status(result.idempotent ? 200 : 201).json(result); }
  catch (error) { return respondError(res, error); }
});

router.delete('/:kind/:id/asistentes/:userId', async (req: Request, res: Response) => {
  const kind = parseKind(req.params.kind);
  if (!kind) return res.status(404).json({ code: 'COLLAB_KIND_INVALID' });
  try { return res.json(await service.revoke(req.user!, kind, req.params.id, req.params.userId)); }
  catch (error) { return respondError(res, error); }
});

export default router;
