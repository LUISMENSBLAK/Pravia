import type { Request, Response, NextFunction } from 'express';
import { tenantConsumptionService } from '../platform/tenantConsumption.service';
import { migrationEngineService } from '../platform/migrationEngine.service';
import { tenantExportService } from '../platform/export.service';
import { platformAdminService } from '../platform/platformAdmin.service';
import { backupOrchestrator } from '../platform/backup.service';

const organization = (req: Request) => req.user!.organizationId;
const respond = (res: Response, next: NextFunction, promise: Promise<unknown>) => promise.then((body) => res.json(body)).catch(next);

export const getTenantConsumptionOverview = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, tenantConsumptionService.overview(organization(req)));

export const getTenantSubscription = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, tenantConsumptionService.subscription(organization(req)));

export const getTenantStorage = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, tenantConsumptionService.storageState(organization(req)));

export const getTenantAiWallet = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, tenantConsumptionService.aiState(organization(req)));

export const getTenantBilling = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, tenantConsumptionService.billing(organization(req)));

export const getTenantMigrations = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, tenantConsumptionService.migrations(organization(req)));

export const getCertifiedMigrationBackups = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, backupOrchestrator.listCertified(organization(req)));

const integerString = (value: unknown, field: string) => {
  if (!/^\d+$/.test(String(value ?? ''))) throw Object.assign(new Error(`${field} debe ser un entero positivo.`), { status: 400, code: 'VALIDATION_ERROR' });
  return BigInt(String(value));
};

export const createTenantMigration = (req: Request, res: Response, next: NextFunction) => {
  try {
    return respond(res.status(201), next, migrationEngineService.createJob({
      organizationId: organization(req), userId: req.user!.id,
      sourceSystem: String(req.body?.source_system || ''),
      declaredBytes: integerString(req.body?.declared_bytes, 'declared_bytes'),
      idempotencyKey: String(req.body?.idempotency_key || ''),
    }));
  } catch (error) { return next(error); }
};

export const createMigrationUploadSession = (req: Request, res: Response, next: NextFunction) => {
  try {
    return respond(res.status(201), next, migrationEngineService.createUploadSession({
      organizationId: organization(req), migrationJobId: req.params.jobId,
      filename: String(req.body?.filename || ''),
      declaredBytes: integerString(req.body?.declared_bytes, 'declared_bytes'),
      partSizeBytes: Number(req.body?.part_size_bytes),
      idempotencyKey: String(req.body?.idempotency_key || ''),
    }));
  } catch (error) { return next(error); }
};

export const uploadMigrationPart = (req: Request, res: Response, next: NextFunction) => {
  if (!req.file) return res.status(400).json({ code: 'MIGRATION_UPLOAD_PART_REQUIRED', error: 'Selecciona la parte que deseas cargar.' });
  return respond(res.status(201), next, migrationEngineService.uploadPart({
    organizationId: organization(req), migrationJobId: req.params.jobId, uploadSessionId: req.params.sessionId,
    partNumber: Number(req.params.partNumber), buffer: req.file.buffer,
    checksumSha256: String(req.header('x-content-sha256') || req.body?.checksum_sha256 || ''),
  }));
};

export const completeMigrationUpload = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, migrationEngineService.completeUpload({
    organizationId: organization(req), migrationJobId: req.params.jobId, uploadSessionId: req.params.sessionId,
    checksumSha256: String(req.body?.checksum_sha256 || ''),
  }));

export const getMigrationUploadProgress = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, migrationEngineService.uploadProgress(organization(req), req.params.jobId, req.params.sessionId));

export const pauseMigrationUpload = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, migrationEngineService.pauseUpload(organization(req), req.params.jobId, req.params.sessionId));

export const resumeMigrationUpload = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, migrationEngineService.resumeUpload(organization(req), req.params.jobId, req.params.sessionId));

export const getMigrationPreview = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, migrationEngineService.preview(organization(req), req.params.jobId));

export const submitMigrationMapping = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, migrationEngineService.submitMapping({
    organizationId: organization(req), migrationJobId: req.params.jobId, userId: req.user!.id,
    entityType: String(req.body?.entity_type || ''),
    fields: Array.isArray(req.body?.fields) ? req.body.fields.map((field: any) => ({
      sourceField: String(field?.source_field || ''), targetField: field?.target_field === null ? null : String(field?.target_field || ''),
    })) : [],
  }));

export const approveMigration = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, migrationEngineService.approve({ organizationId: organization(req), migrationJobId: req.params.jobId, userId: req.user!.id }));

export const executeMigration = (req: Request, res: Response, next: NextFunction) =>
  respond(res.status(202), next, migrationEngineService.queueExecution({
    organizationId: organization(req), migrationJobId: req.params.jobId, backupRunId: String(req.body?.backup_run_id || ''),
  }));

export const createTenantExport = (req: Request, res: Response, next: NextFunction) =>
  respond(res.status(202), next, tenantExportService.create({
    organizationId: organization(req), userId: req.user!.id,
    scope: Array.isArray(req.body?.scope) ? req.body.scope.map(String) : [],
    format: String(req.body?.format || ''), idempotencyKey: String(req.body?.idempotency_key || ''),
  }));

export const listTenantExports = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, tenantExportService.list(organization(req)));

export const getTenantExportDownload = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, tenantExportService.signedDownload({
    organizationId: organization(req), exportJobId: req.params.exportJobId,
  }));

export const getTenantExportStatus = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, tenantExportService.status(organization(req), req.params.exportJobId));

export const revokeTenantExport = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, tenantExportService.revoke({ organizationId: organization(req), exportJobId: req.params.exportJobId }));

export const getPlatformAdminDashboard = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, platformAdminService.dashboard(req.user!.id));

export const getPlatformAdminTenants = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, platformAdminService.tenants(req.user!.id));

export const grantPlatformTenantAccess = (req: Request, res: Response, next: NextFunction) =>
  respond(res.status(201), next, platformAdminService.grantTenantAccess({
    userId: req.user!.id, organizationId: req.params.organizationId,
    scope: Array.isArray(req.body?.scope) ? req.body.scope.map(String) : [],
    reason: String(req.body?.reason || ''), expiresAt: new Date(String(req.body?.expires_at || '')),
    approvalMetadata: req.body?.approval_metadata || {},
    traceId: String(req.correlationId || crypto.randomUUID()),
  }));

export const revokePlatformTenantAccess = (req: Request, res: Response, next: NextFunction) =>
  respond(res, next, platformAdminService.revokeTenantAccess({
    userId: req.user!.id, grantId: req.params.grantId, reason: String(req.body?.reason || ''),
    traceId: String(req.correlationId || crypto.randomUUID()),
  }));
