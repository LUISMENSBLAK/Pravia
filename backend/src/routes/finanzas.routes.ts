import { Router } from 'express';
import { FinanzasController } from '../controllers/finanzas.controller';

const router = Router();

router.get('/resumen', FinanzasController.getResumenFinanciero);
router.get('/movimientos', FinanzasController.getMovimientosGlobales);
router.get('/cobranza', FinanzasController.getCobranza);
router.get('/egresos', FinanzasController.getEgresosGlobales);
router.get('/honorarios', FinanzasController.getHonorariosPravia);
router.get('/catalogos', FinanzasController.getCatalogosFiltro);

export default router;
