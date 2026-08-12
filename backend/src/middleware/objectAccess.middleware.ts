import type { NextFunction, Request, Response } from 'express';
import {
  canAccessAltaSession,
  canAccessAltaCarga,
  canAccessCompareciente,
  canAccessCotizacion,
  canAccessDocumento,
  canAccessProspecto,
} from '../services/objectAccess.service';

const deny = (res: Response, code: string, resource: string) =>
  res.status(403).json({ code, error: `No tienes acceso a ${resource}.` });

export async function requireProspectoObjectAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return deny(res, 'AUTH_REQUIRED', 'este prospecto');
  const id = req.params.id || req.body?.prospecto_id;
  if (!id || await canAccessProspecto(req.user, String(id))) return next();
  return deny(res, 'PROSPECTO_ACCESS_DENIED', 'este prospecto');
}

export async function requireCotizacionObjectAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return deny(res, 'AUTH_REQUIRED', 'esta cotización');
  const id = req.params.id || req.body?.cotizacion_id;
  if (!id || await canAccessCotizacion(req.user, String(id))) return next();
  return deny(res, 'COTIZACION_ACCESS_DENIED', 'esta cotización');
}

export async function requireComparecienteObjectAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return deny(res, 'AUTH_REQUIRED', 'este compareciente');
  const id = req.params.id || req.body?.compareciente_id;
  if (!id || await canAccessCompareciente(req.user, String(id))) return next();
  return deny(res, 'COMPARECIENTE_ACCESS_DENIED', 'este compareciente');
}

export async function requireDocumentoObjectAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return deny(res, 'AUTH_REQUIRED', 'este documento');
  const id = req.params.documentoId || req.params.id || req.body?.documento_id;
  if (!id || await canAccessDocumento(req.user, String(id))) return next();
  return deny(res, 'DOCUMENTO_ACCESS_DENIED', 'este documento');
}

export async function requireAltaSessionObjectAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return deny(res, 'AUTH_REQUIRED', 'esta sesión de alta');
  const id = req.params.sessionId;
  if (!id || await canAccessAltaSession(req.user, String(id))) return next();
  return deny(res, 'ALTA_SESSION_ACCESS_DENIED', 'esta sesión de alta');
}

export async function requireAltaCargaObjectAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return deny(res, 'AUTH_REQUIRED', 'este documento temporal');
  const { sessionId, cargaId } = req.params;
  if (!sessionId || !cargaId || await canAccessAltaCarga(req.user, sessionId, cargaId)) return next();
  return deny(res, 'ALTA_DOCUMENT_ACCESS_DENIED', 'este documento temporal');
}
