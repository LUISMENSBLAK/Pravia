import express from 'express';
import {
  applyPredioProposal, createPredio, getPredio, getPredioDocumentoUrl, listPredios, proposePredioFromDocument,
  unlinkPredioDocumento, updatePredio, uploadPredioDocumento, uploadPredioDocumentoMulter,
} from '../controllers/predios.controller';
import { requirePermission } from '../middleware/auth.middleware';
import { requirePredioObjectAccess } from '../middleware/objectAccess.middleware';

const router = express.Router();
router.get('/', listPredios);
router.post('/', requirePermission('expedientes.write'), createPredio);
router.get('/:id', requirePredioObjectAccess, getPredio);
router.patch('/:id', requirePermission('expedientes.write'), requirePredioObjectAccess, updatePredio);
router.post('/:id/documentos', requirePermission('documentos.write'), requirePredioObjectAccess, uploadPredioDocumentoMulter.single('file'), uploadPredioDocumento);
router.get('/:id/documentos/:documentoId/url', requirePermission('documentos.read'), requirePredioObjectAccess, getPredioDocumentoUrl);
router.post('/:id/documentos/:documentoId/desvincular', requirePermission('documentos.unlink'), requirePredioObjectAccess, unlinkPredioDocumento);
router.post('/:id/extracciones/preview', requirePermission('documentos.read'), requirePermission('ia.execute'), requirePredioObjectAccess, proposePredioFromDocument);
router.post('/:id/extracciones/:extraccionId/aplicar', requirePermission('expedientes.write'), requirePermission('ia.execute'), requirePredioObjectAccess, applyPredioProposal);
export default router;
