import express from 'express';
import { 
  getProspectos, 
  createProspecto, 
  getProspectoById, 
  updateProspecto, 
  deleteProspecto,
  addSeguimiento
} from '../controllers/prospectos.controller';
import { getProspectoDocumentos, unlinkProspectoDocumento } from '../controllers/documentos.controller';
import { requireProspectoObjectAccess } from '../middleware/objectAccess.middleware';
import { requireDocumentoObjectAccess } from '../middleware/objectAccess.middleware';
import { requirePermission } from '../middleware/auth.middleware';

const router = express.Router();
router.param('id', requireProspectoObjectAccess);

router.get('/', getProspectos);
router.post('/', createProspecto);
router.get('/:id', getProspectoById);
router.put('/:id', updateProspecto);
router.delete('/:id', deleteProspecto);
router.post('/:id/seguimientos', addSeguimiento);
router.get('/:id/documentos', getProspectoDocumentos);
router.delete('/:id/documentos/:documentoId', requireDocumentoObjectAccess, requirePermission('documentos.unlink'), unlinkProspectoDocumento);

export default router;
