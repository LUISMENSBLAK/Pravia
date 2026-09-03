import { Router } from 'express';
import multer from 'multer';
import { ComparecienteController } from '../controllers/compareciente.controller';
import { requireComparecienteObjectAccess } from '../middleware/objectAccess.middleware';
import { requirePermission } from '../middleware/auth.middleware';
import { BeneficialControllerController } from '../controllers/beneficialController.controller';

const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } });
const router = Router();
router.param('id', requireComparecienteObjectAccess);

// Endpoints de consulta y duplicados
router.get('/duplicados', ComparecienteController.buscarDuplicados);
router.get('/catalogos', ComparecienteController.obtenerCatalogos);
router.get('/', ComparecienteController.listarMaster);
router.get('/:id', ComparecienteController.obtenerPorId);
router.patch('/:id', ComparecienteController.actualizarMaster);
router.patch('/:id/provenance/:sourceId/resolve', ComparecienteController.resolverConflictoDato);
router.get('/:id/estructura-propiedad', requirePermission('comparecientes.read'), requirePermission('compliance.read'), BeneficialControllerController.current);
router.put('/:id/estructura-propiedad', requirePermission('comparecientes.write'), requirePermission('compliance.write'), BeneficialControllerController.save);
router.post('/:id/estructura-propiedad/vinculos/preview', requirePermission('comparecientes.write'), requirePermission('compliance.write'), BeneficialControllerController.previewLinks);
router.post('/:id/estructura-propiedad/reconciliaciones/:proposalId/decision', requirePermission('comparecientes.write'), requirePermission('compliance.write'), BeneficialControllerController.reconcile);
router.post('/:id/estructura-propiedad/reconciliaciones/:proposalId/preview', requirePermission('comparecientes.write'), requirePermission('compliance.write'), BeneficialControllerController.previewReconciliation);
router.post('/:id/estructura-propiedad/propuestas-ia', requirePermission('ia.execute'), requirePermission('comparecientes.write'), requirePermission('compliance.write'), BeneficialControllerController.proposeAi);
router.get('/:id/estructura-propiedad/propuestas-ia/:proposalId', requirePermission('comparecientes.read'), requirePermission('compliance.read'), BeneficialControllerController.readAi);
router.post('/:id/estructura-propiedad/propuestas-ia/:proposalId/decision', requirePermission('comparecientes.write'), requirePermission('compliance.write'), BeneficialControllerController.decideAi);

// Archivo Documental del Compareciente
router.get('/:id/documentos', requirePermission('documentos.read'), ComparecienteController.obtenerArchivoDocumental);
router.get('/:id/documentos/:documentoId/descargar', requirePermission('documentos.read'), ComparecienteController.descargarDocumentoMaster);
router.get('/:id/documentos/:documentoId/visualizar', requirePermission('documentos.read'), ComparecienteController.visualizarDocumentoMaster);
router.post('/:id/documentos', requirePermission('documentos.write'), upload.single('file'), ComparecienteController.subirDocumentoMaster);
router.delete('/:id/documentos/:documentoId', requirePermission('documentos.unlink'), ComparecienteController.eliminarDocumentoMaster);
router.post('/:id/extraer-ia', requirePermission('documentos.read'), requirePermission('ia.execute'), ComparecienteController.extraerDocumentosConIA);

// Endpoints de creación
router.post('/persona-fisica', ComparecienteController.crearPersonaFisica);
router.post('/persona-moral', ComparecienteController.crearPersonaMoral);

// Archivar / Eliminar compareciente
router.patch('/:id/archivar', ComparecienteController.archivarCompareciente);

export default router;
