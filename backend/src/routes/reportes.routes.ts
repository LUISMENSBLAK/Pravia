import { Router } from 'express';
import { ReportesController } from '../controllers/reportes.controller';

const router = Router();
router.get('/catalogos', ReportesController.catalogs);
router.get('/resumen', ReportesController.summary);
export default router;

