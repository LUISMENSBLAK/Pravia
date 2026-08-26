import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { actsAndTimesService, CatalogConfigurationError, templatesAndFormatsService } from '../services/configurationCatalog.service';

const actor = (req: Request) => {
  if (!req.user) throw new CatalogConfigurationError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
  return req.user;
};

const multipartBody = (req: Request) => {
  const raw = req.body?.metadata;
  if (typeof raw !== 'string') return req.body || {};
  try { return JSON.parse(raw); } catch { throw new CatalogConfigurationError(400, 'CATALOG_METADATA_INVALID', 'Los datos del formulario no son válidos.'); }
};

export function catalogError(error: unknown) {
  if (error instanceof CatalogConfigurationError) return { status: error.status, body: { code: error.code, error: error.message } };
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { status: 409, body: { code: 'CATALOG_DUPLICATE', error: 'Ya existe un registro con esos datos.' } };
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') return { status: 409, body: { code: 'CATALOG_REFERENCE_IN_USE', error: 'La configuración está en uso y no puede eliminarse.' } };
  return { status: 500, body: { code: 'CATALOG_INTERNAL_ERROR', error: 'No fue posible completar la operación de catálogo.' } };
}

export const configurationCatalogController = {
  listActs: (req: Request) => actsAndTimesService.list(actor(req), String(req.query.search || '').trim()),
  getAct: (req: Request) => actsAndTimesService.get(actor(req), req.params.id),
  createAct: (req: Request) => actsAndTimesService.create(actor(req), req.body),
  ensureActConfiguration: (req: Request) => actsAndTimesService.ensureConfiguration(actor(req), req.params.id),
  updateAct: (req: Request) => actsAndTimesService.update(actor(req), req.params.id, req.body),
  createStage: (req: Request) => actsAndTimesService.createStage(actor(req), req.params.actId, req.body),
  updateStage: (req: Request) => actsAndTimesService.updateStage(actor(req), req.params.stageId, req.body),
  deleteStage: (req: Request) => actsAndTimesService.deleteStage(actor(req), req.params.stageId),
  createActivity: (req: Request) => actsAndTimesService.createActivity(actor(req), req.params.stageId, req.body),
  updateActivity: (req: Request) => actsAndTimesService.updateActivity(actor(req), req.params.activityId, req.body),
  setDependencies: (req: Request) => actsAndTimesService.setDependencies(actor(req), req.params.activityId, req.body),
  createException: (req: Request) => actsAndTimesService.createException(actor(req), req.params.activityId, req.body),
  updateException: (req: Request) => actsAndTimesService.updateException(actor(req), req.params.exceptionId, req.body),
  resolveTiming: (req: Request) => actsAndTimesService.resolveTiming(actor(req), req.params.activityId, { type: String(req.query.type || ''), id: String(req.query.id || '') }),
  artifactsRoot: (req: Request) => templatesAndFormatsService.root(actor(req)),
  supportingCatalogs: (req: Request) => templatesAndFormatsService.supportingCatalogs(actor(req)),
  createInstitution: (req: Request) => templatesAndFormatsService.createInstitution(actor(req), req.body),
  explorer: (req: Request) => templatesAndFormatsService.explorer(actor(req), req.query.owner_type, req.query.owner_id, req.query.type, req.query.folder_id),
  createFolder: (req: Request) => templatesAndFormatsService.createFolder(actor(req), req.body),
  createArtifact: (req: Request) => {
    if (!req.file) throw new CatalogConfigurationError(400, 'MASTER_FILE_REQUIRED', 'Selecciona el archivo maestro.');
    return templatesAndFormatsService.createArtifact(actor(req), multipartBody(req), req.file);
  },
  addArtifactVersion: (req: Request) => {
    if (!req.file) throw new CatalogConfigurationError(400, 'MASTER_FILE_REQUIRED', 'Selecciona el archivo de la nueva versión.');
    return templatesAndFormatsService.addVersion(actor(req), req.params.artifactId, multipartBody(req), req.file);
  },
  updateArtifact: (req: Request) => templatesAndFormatsService.updateArtifact(actor(req), req.params.artifactId, req.body),
  artifactVersionUrl: (req: Request) => templatesAndFormatsService.signedUrl(actor(req), req.params.versionId),
};
