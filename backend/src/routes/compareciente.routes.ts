import { Router } from 'express';
import multer from 'multer';
import { ComparecienteController } from '../controllers/compareciente.controller';
import { requireComparecienteObjectAccess } from '../middleware/objectAccess.middleware';

const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } });
const router = Router();
router.param('id', requireComparecienteObjectAccess);

// Endpoints de consulta y duplicados
router.get('/duplicados', ComparecienteController.buscarDuplicados);
router.get('/catalogos', ComparecienteController.obtenerCatalogos);
router.get('/', ComparecienteController.listarMaster);
router.get('/:id', ComparecienteController.obtenerPorId);

// Archivo Documental del Compareciente
router.get('/:id/documentos', ComparecienteController.obtenerArchivoDocumental);
router.post('/:id/documentos', upload.single('file'), ComparecienteController.subirDocumentoMaster);

// Endpoints de creación
router.post('/persona-fisica', ComparecienteController.crearPersonaFisica);
router.post('/persona-moral', ComparecienteController.crearPersonaMoral);

// Endpoints de vinculación contextual en Expedientes
router.post('/vincular-expediente', ComparecienteController.vincularAExpediente);
router.patch('/vincular-expediente/:vinculoId/validacion', ComparecienteController.validarVinculoExpediente);
router.delete('/vincular-expediente/:vinculoId', ComparecienteController.desvincularDeExpediente);

// Archivar / Eliminar compareciente
router.patch('/:id/archivar', ComparecienteController.archivarCompareciente);

export default router;
