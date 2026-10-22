import type { NextFunction, Request, Response } from 'express';
import { platformAdminService, type PlatformPermission } from '../platform/platformAdmin.service';

export const requirePlatformAdministrator = (permission: PlatformPermission) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      await platformAdminService.authorize(req.user.id, permission);
      return next();
    } catch (error) {
      return next(error);
    }
  };
