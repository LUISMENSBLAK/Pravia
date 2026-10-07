import express from 'express';
import { assignArchivo, getArchivoOverview, registerUnusedFolios, updateArchivo } from '../controllers/archivo.controller';
import { requirePermission } from '../middleware/auth.middleware';

const router = express.Router();
router.get('/', requirePermission('expedientes.read'), getArchivoOverview);
router.post('/', requirePermission('expedientes.write'), assignArchivo);
router.post('/folios-inutilizados', requirePermission('expedientes.write'), registerUnusedFolios);
router.patch('/:recordId', requirePermission('expedientes.write'), updateArchivo);
export default router;
