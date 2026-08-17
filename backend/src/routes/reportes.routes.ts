import { Router } from 'express';
import { ReportesController } from '../controllers/reportes.controller';
import { requirePermission } from '../middleware/auth.middleware';

const router = Router();
router.get('/catalogos', ReportesController.catalogs);
router.get('/resumen', ReportesController.summary);
router.get('/finanzas', ReportesController.finance);
router.get('/cobranza', ReportesController.collections);
router.get('/abogados', requirePermission('expedientes.read'), ReportesController.lawyers);
router.get('/firmas', requirePermission('agenda.read'), ReportesController.signatures);
router.get('/80-20', requirePermission('expedientes.read'), ReportesController.eightyTwenty);
router.get('/clientes-potenciales', ReportesController.potentialClients);
router.post('/metas', requirePermission('reportes.targets.manage'), ReportesController.createTarget);
router.patch('/metas/:id', requirePermission('reportes.targets.manage'), ReportesController.updateTarget);
router.post('/metas/:id/cerrar', requirePermission('reportes.targets.manage'), ReportesController.closeTarget);
export default router;
