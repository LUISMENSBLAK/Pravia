import { Router } from 'express';
import multer from 'multer';
import {
  uploadDocumento, 
  getDocumentoUrl, 
  deleteDocumento,
  desvincularDocumento
} from '../controllers/documentos.controller';
import { requirePermission } from '../middleware/auth.middleware';
import { requireDocumentoObjectAccess } from '../middleware/objectAccess.middleware';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/', upload.single('archivo'), uploadDocumento);
router.get('/:id/url', requireDocumentoObjectAccess, getDocumentoUrl);
router.post('/:id/desvincular', requireDocumentoObjectAccess, requirePermission('documentos.unlink'), desvincularDocumento);
router.delete('/:id', requireDocumentoObjectAccess, requirePermission('documentos.unlink'), deleteDocumento);

export default router;
