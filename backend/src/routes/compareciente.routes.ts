import { Router } from 'express';
import multer from 'multer';
import { ComparecienteController } from '../controllers/compareciente.controller';
import { requireComparecienteObjectAccess } from '../middleware/objectAccess.middleware';
import { requireExpedienteAccess, requirePermission } from '../middleware/auth.middleware';

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

// Endpoints de vinculación contextual en Expedientes
router.post('/vincular-expediente', requireComparecienteObjectAccess, requireExpedienteAccess, ComparecienteController.vincularAExpediente);
router.patch('/vincular-expediente/:vinculoId/validacion', ComparecienteController.validarVinculoExpediente);
router.delete('/vincular-expediente/:vinculoId', ComparecienteController.desvincularDeExpediente);

// Archivar / Eliminar compareciente
router.patch('/:id/archivar', ComparecienteController.archivarCompareciente);

export default router;
