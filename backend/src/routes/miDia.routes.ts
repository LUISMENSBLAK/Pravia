import { Router } from 'express';
import { MiDiaController } from '../controllers/miDia.controller';
import { MiDiaConfigurationController } from '../controllers/miDiaConfiguration.controller';
import { requirePermission } from '../middleware/auth.middleware';

const router = Router();
router.get('/sources', MiDiaController.sources);
router.get('/config', MiDiaConfigurationController.get);
router.put('/layout', MiDiaConfigurationController.saveLayout);
router.delete('/layout', MiDiaConfigurationController.resetLayout);
router.put('/tenant-config', requirePermission('mi_dia.configure'), MiDiaConfigurationController.updateTenant);
router.put('/users/:userId/cards', requirePermission('mi_dia.permissions.manage'), MiDiaConfigurationController.setCardPermission);
router.get('/notebook', MiDiaConfigurationController.listTasks);
router.post('/notebook', MiDiaConfigurationController.createTask);
router.patch('/notebook/:taskId', MiDiaConfigurationController.updateTask);
router.get('/cards/:key/detail', MiDiaController.cardDetail);
router.get('/', MiDiaController.dashboard);
export default router;
