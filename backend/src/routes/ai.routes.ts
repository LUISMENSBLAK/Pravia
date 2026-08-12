import { Router } from 'express';
import { AIController } from '../controllers/ai.controller';
import { requirePermission } from '../middleware/auth.middleware';

const router = Router();
router.get('/assistant/tools', requirePermission('ai.use'), AIController.tools);
router.post('/assistant/tools/:tool', requirePermission('ai.use'), AIController.executeTool);
router.post('/assistant/confirmations', requirePermission('ai.use'), AIController.confirmPreparedAction);
router.get('/dashboard', requirePermission('ai.admin.read'), AIController.dashboard);
export default router;
