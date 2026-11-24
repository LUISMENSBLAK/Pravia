import express from 'express';
import { assignArchivo, configureArchivoProtocol, getArchivoOverview, listArchivoRecords, registerUnusedFolios, updateArchivo } from '../controllers/archivo.controller';
import { requirePermission } from '../middleware/auth.middleware';

const router = express.Router();
router.get('/', requirePermission('expedientes.read'), getArchivoOverview);
router.get('/escrituras', requirePermission('expedientes.read'), listArchivoRecords);
router.put('/protocolo/configuracion', requirePermission('configuracion.actos_tiempos.manage'), configureArchivoProtocol);
router.post('/', requirePermission('expedientes.write'), assignArchivo);
router.post('/folios-inutilizados', requirePermission('expedientes.write'), registerUnusedFolios);
router.patch('/:recordId', requirePermission('expedientes.write'), updateArchivo);
export default router;
