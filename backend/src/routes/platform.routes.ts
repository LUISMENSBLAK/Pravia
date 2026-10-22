import { Router } from 'express';
import multer from 'multer';
import { requirePermission } from '../middleware/auth.middleware';
import { requirePlatformAdministrator } from '../middleware/platformAdmin.middleware';
import {
  completeMigrationUpload, createMigrationUploadSession, createTenantExport, createTenantMigration, getMigrationPreview,
  getPlatformAdminDashboard, getPlatformAdminTenants, getTenantExportDownload, grantPlatformTenantAccess,
  revokePlatformTenantAccess,
  getTenantAiWallet, getTenantBilling, getTenantConsumptionOverview, getTenantMigrations,
  getCertifiedMigrationBackups,
  getTenantStorage, getTenantSubscription, uploadMigrationPart,
  getMigrationUploadProgress, pauseMigrationUpload, resumeMigrationUpload,
  submitMigrationMapping, approveMigration, executeMigration, getTenantExportStatus, revokeTenantExport,
  listTenantExports,
} from '../controllers/platform.controller';

const router = Router();
const migrationPartUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024, files: 1, fields: 4 } });

router.get('/admin/dashboard', requirePlatformAdministrator('platform.dashboard.read'), getPlatformAdminDashboard);
router.get('/admin/tenants', requirePlatformAdministrator('platform.tenants.read'), getPlatformAdminTenants);
router.post('/admin/tenants/:organizationId/access-grants', requirePlatformAdministrator('platform.tenant_access.grant'), grantPlatformTenantAccess);
router.post('/admin/access-grants/:grantId/revoke', requirePlatformAdministrator('platform.tenant_access.grant'), revokePlatformTenantAccess);

router.get('/consumption', requirePermission('platform.subscription.read'), requirePermission('platform.storage.read'), requirePermission('platform.ai.read'), getTenantConsumptionOverview);
router.get('/subscription', requirePermission('platform.subscription.read'), getTenantSubscription);
router.get('/storage', requirePermission('platform.storage.read'), getTenantStorage);
router.get('/ai', requirePermission('platform.ai.read'), getTenantAiWallet);
router.get('/billing', requirePermission('platform.billing.read'), getTenantBilling);
router.get('/migrations', requirePermission('platform.migrations.read'), getTenantMigrations);
router.get('/migrations/backups/certified', requirePermission('platform.migrations.read'), getCertifiedMigrationBackups);
router.post('/migrations', requirePermission('platform.migrations.manage'), createTenantMigration);
router.get('/migrations/:jobId/preview', requirePermission('platform.migrations.read'), getMigrationPreview);
router.put('/migrations/:jobId/mapping', requirePermission('platform.migrations.manage'), submitMigrationMapping);
router.post('/migrations/:jobId/approve', requirePermission('platform.migrations.manage'), approveMigration);
router.post('/migrations/:jobId/execute', requirePermission('platform.migrations.manage'), executeMigration);
router.post('/migrations/:jobId/uploads', requirePermission('platform.migrations.manage'), createMigrationUploadSession);
router.get('/migrations/:jobId/uploads/:sessionId', requirePermission('platform.migrations.read'), getMigrationUploadProgress);
router.post('/migrations/:jobId/uploads/:sessionId/pause', requirePermission('platform.migrations.manage'), pauseMigrationUpload);
router.post('/migrations/:jobId/uploads/:sessionId/resume', requirePermission('platform.migrations.manage'), resumeMigrationUpload);
router.put('/migrations/:jobId/uploads/:sessionId/parts/:partNumber', requirePermission('platform.migrations.manage'), migrationPartUpload.single('part'), uploadMigrationPart);
router.post('/migrations/:jobId/uploads/:sessionId/complete', requirePermission('platform.migrations.manage'), completeMigrationUpload);
router.post('/exports', requirePermission('platform.exports.manage'), createTenantExport);
router.get('/exports', requirePermission('platform.exports.read'), listTenantExports);
router.get('/exports/:exportJobId', requirePermission('platform.exports.read'), getTenantExportStatus);
router.get('/exports/:exportJobId/download', requirePermission('platform.exports.read'), getTenantExportDownload);
router.post('/exports/:exportJobId/revoke', requirePermission('platform.exports.manage'), revokeTenantExport);

export default router;
