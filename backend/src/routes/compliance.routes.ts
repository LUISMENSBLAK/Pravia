import { Router } from 'express';
import { ComplianceController } from '../controllers/compliance.controller';
import { requireExpedienteAccess, requirePermission } from '../middleware/auth.middleware';

const router = Router();
router.get('/catalogos', ComplianceController.catalogs);
router.get('/revisiones', ComplianceController.list);
router.post('/revisiones', requireExpedienteAccess, ComplianceController.create);
router.post('/revisiones/:id/evaluar', ComplianceController.evaluate);
router.post('/revisiones/:id/revisar', requirePermission('cumplimiento.confirm'), ComplianceController.review);
router.post('/revisiones/:id/evidencias', ComplianceController.addEvidence);
export default router;
