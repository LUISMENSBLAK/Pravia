import express from 'express';
import { 
  getProspectos, 
  createProspecto, 
  getProspectoById, 
  updateProspecto, 
  deleteProspecto,
  addSeguimiento,
  getProspectCatalogs,
  getProspectWorkflow, getProspectTransition, actProspectWorkflow
} from '../controllers/prospectos.controller';
import { getProspectoDocumentos, unlinkProspectoDocumento } from '../controllers/documentos.controller';
import { requireProspectoObjectAccess } from '../middleware/objectAccess.middleware';
import { requireDocumentoObjectAccess } from '../middleware/objectAccess.middleware';
import { requirePermission } from '../middleware/auth.middleware';
import { getProspectDocumentReview, runProspectDocumentReview } from '../controllers/prospectDocumentReview.controller';

const router = express.Router();
router.param('id', requireProspectoObjectAccess);

router.get('/', getProspectos);
router.post('/', createProspecto);
router.get('/catalogos', getProspectCatalogs);
router.get('/:id', getProspectoById);
router.get('/:id/operacion', getProspectWorkflow);
router.get('/:id/transiciones/:transitionId', getProspectTransition);
router.post('/:id/transiciones', actProspectWorkflow);
router.put('/:id', updateProspecto);
router.delete('/:id', deleteProspecto);
router.post('/:id/seguimientos', addSeguimiento);
router.get('/:id/documentos', getProspectoDocumentos);
router.get('/:id/revision-documental-ia', requirePermission('prospectos.read'), requirePermission('documentos.read'), getProspectDocumentReview);
router.post('/:id/revision-documental-ia', requirePermission('prospectos.write'), requirePermission('documentos.read'), requirePermission('ia.execute'), runProspectDocumentReview);
router.delete('/:id/documentos/:documentoId', requireDocumentoObjectAccess, requirePermission('documentos.unlink'), unlinkProspectoDocumento);

export default router;
