import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { MiDiaConfigurationError, MiDiaConfigurationService } from '../services/miDiaConfiguration.service';
import { MiDiaNotebookService } from '../services/miDiaNotebook.service';

const service = new MiDiaConfigurationService(prisma);
const notebook = new MiDiaNotebookService(prisma);

async function respond(req: Request, res: Response, action: (actor: NonNullable<Request['user']>) => Promise<unknown>) {
  if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
  try {
    return res.json({ success: true, data: await action(req.user) });
  } catch (error) {
    if (error instanceof MiDiaConfigurationError) {
      return res.status(error.status).json({ code: error.code, error: error.message });
    }
    console.error('Mi Día configuration error', error);
    return res.status(500).json({ code: 'MIDIA_INTERNAL_ERROR', error: 'No fue posible guardar la configuración de Mi Día.' });
  }
}

const body = (req: Request): Record<string, unknown> => req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};

export class MiDiaConfigurationController {
  static get(req: Request, res: Response) {
    return respond(req, res, (actor) => service.get(actor));
  }

  static saveLayout(req: Request, res: Response) {
    return respond(req, res, (actor) => service.saveLayout(actor, body(req)));
  }

  static resetLayout(req: Request, res: Response) {
    return respond(req, res, (actor) => service.resetLayout(actor));
  }

  static updateTenant(req: Request, res: Response) {
    return respond(req, res, (actor) => service.updateTenant(actor, body(req)));
  }

  static setCardPermission(req: Request, res: Response) {
    return respond(req, res, (actor) => service.setCardPermission(actor, String(req.params.userId), body(req)));
  }

  static listTasks(req: Request, res: Response) {
    return respond(req, res, (actor) => notebook.list(actor, req.query as Record<string, unknown>));
  }

  static createTask(req: Request, res: Response) {
    return respond(req, res, (actor) => notebook.create(actor, body(req)));
  }

  static updateTask(req: Request, res: Response) {
    return respond(req, res, (actor) => notebook.update(actor, String(req.params.taskId), body(req)));
  }
}
