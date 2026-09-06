import { Router } from 'express';
import { MiDiaController } from '../controllers/miDia.controller';

const router = Router();
router.get('/sources', MiDiaController.sources);
router.get('/', MiDiaController.dashboard);
export default router;
