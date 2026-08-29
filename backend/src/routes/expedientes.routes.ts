import express from 'express';
import {
  getExpedientes,
  getEligibleCotizacionesForExpediente,
  getExpedienteById,
  createExpediente,
  convertCotizacionToExpediente,
  transitionEstatus,
  addMovimientoFinanciero,
  reverseMovimientoFinanciero,
  updateMovimientoAdjunto,
  uploadMulter,
  uploadDocumentoMulter,
  uploadMovimientoAdjuntoFile,
  streamMovimientoAdjunto,
  downloadMovimientoAdjunto,
  archiveExpediente,
  updateExpedienteHeader,
  addExpedienteDocumento,
  deleteExpedienteDocumento,
  updateExpedienteDocumento,
  updateExpedienteRequisito,
  streamExpedienteDocumento,
  downloadExpedienteDocumento,
  getTiposActo,
  registerFinalDelivery,
  createPostfirmaTask,
  updatePostfirmaTask,
  transitionPostfirma,
} from '../controllers/expedientes.controller';

import {
  getProyectoEscritura,
  uploadProyectoMulter,
  uploadProyectoVersion,
  updateProyectoVersion,
  streamProyectoVersion,
  downloadProyectoVersion,
  analizarProyectoConIA,
  streamIAReport,
  downloadIAReport,
  downloadCarpetaZip,
  getDatosDetectadosMatrix,
  generarProyectoConIA
} from '../controllers/proyectos.controller';
import { requireExpedienteAccess, requirePermission } from '../middleware/auth.middleware';
import { applyExpedienteActoChange, listExpedienteActos, previewExpedienteActoChange } from '../controllers/expedienteActos.controller';
import {
  applyExpedientePartyChange,
  getExpedientePartyCatalogs,
  listExpedienteParties,
  previewExpedientePartyChange,
  searchExpedienteParties,
} from '../controllers/expedienteParties.controller';
import {
  applyExpedientePredioChange,
  getExpedientePredioCatalogs,
  listExpedientePredios,
  previewExpedientePredioChange,
  searchExpedientePredios,
} from '../controllers/expedientePredios.controller';
import {
  getExpedienteSeguimiento,
  materializeExpedienteSeguimiento,
  reopenExpedienteSeguimientoActividad,
  updateExpedienteSeguimientoActividad,
} from '../controllers/expedienteSeguimiento.controller';
import {
  getExpedienteAppendixSignedUrl,
  getExpedienteDocumentAppendix,
  syncExpedienteDocumentAppendix,
} from '../controllers/expedienteDocuments.controller';
import {
  generateExpedienteArtifact,
  getExpedienteArtifactUrl,
  getExpedienteArtifacts,
  materializeExpedienteArtifacts,
  previewExpedienteArtifactGeneration,
  uploadExp006Multer,
  uploadExpedienteArtifact,
  validateExpedienteArtifact,
} from '../controllers/expedienteArtifacts.controller';
import {
  deleteExpedienteBudgetPdf,
  generateExpedienteBudgetPdf,
  getExpedienteBudget,
  getExpedienteBudgetPdfUrl,
  updateExpedienteBudget,
} from '../controllers/expedienteBudget.controller';

const router = express.Router();
router.param('id', requireExpedienteAccess);

router.get('/tipos-acto', getTiposActo);
router.get('/cotizaciones-elegibles', requirePermission('expedientes.write'), getEligibleCotizacionesForExpediente);
router.get('/', getExpedientes);
router.get('/:id', getExpedienteById);
router.get('/:id/actos', listExpedienteActos);
router.post('/:id/actos/preview', requirePermission('expedientes.write'), previewExpedienteActoChange);
router.post('/:id/actos/aplicar', requirePermission('expedientes.write'), applyExpedienteActoChange);
router.get('/:id/comparecientes', requirePermission('comparecientes.read'), listExpedienteParties);
router.get('/:id/comparecientes/buscar', requirePermission('comparecientes.read'), searchExpedienteParties);
router.get('/:id/comparecientes/catalogos', requirePermission('comparecientes.read'), getExpedientePartyCatalogs);
router.post('/:id/comparecientes/preview', requirePermission('expedientes.write'), requirePermission('comparecientes.write'), previewExpedientePartyChange);
router.post('/:id/comparecientes/aplicar', requirePermission('expedientes.write'), requirePermission('comparecientes.write'), applyExpedientePartyChange);
router.get('/:id/predios', listExpedientePredios);
router.get('/:id/predios/buscar', searchExpedientePredios);
router.get('/:id/predios/catalogos', getExpedientePredioCatalogs);
router.post('/:id/predios/preview', requirePermission('expedientes.write'), previewExpedientePredioChange);
router.post('/:id/predios/aplicar', requirePermission('expedientes.write'), applyExpedientePredioChange);
router.get('/:id/seguimiento', requirePermission('expedientes.read'), getExpedienteSeguimiento);
router.post('/:id/seguimiento/materializar', requirePermission('expedientes.write'), materializeExpedienteSeguimiento);
router.patch('/:id/seguimiento/actividades/:activityId', requirePermission('expedientes.write'), updateExpedienteSeguimientoActividad);
router.post('/:id/seguimiento/actividades/:activityId/reabrir', requirePermission('expedientes.write'), reopenExpedienteSeguimientoActividad);
router.get('/:id/plantillas-formatos', requirePermission('documentos.read'), getExpedienteArtifacts);
router.post('/:id/plantillas-formatos/materializar', requirePermission('documentos.write'), materializeExpedienteArtifacts);
router.post('/:id/plantillas-formatos/:pendingId/generar/preview', requirePermission('ia.execute'), previewExpedienteArtifactGeneration);
router.post('/:id/plantillas-formatos/:pendingId/generar', requirePermission('ia.execute'), generateExpedienteArtifact);
router.post('/:id/plantillas-formatos/:pendingId/upload', requirePermission('documentos.write'), uploadExp006Multer.single('file'), uploadExpedienteArtifact);
router.post('/:id/plantillas-formatos/:pendingId/validar', requirePermission('documentos.write'), validateExpedienteArtifact);
router.get('/:id/plantillas-formatos/:pendingId/url', requirePermission('documentos.read'), getExpedienteArtifactUrl);
router.get('/:id/presupuesto', requirePermission('expedientes.read'), getExpedienteBudget);
router.put('/:id/presupuesto', requirePermission('expedientes.write'), updateExpedienteBudget);
router.post('/:id/presupuesto/generar', requirePermission('expedientes.write'), requirePermission('documentos.write'), generateExpedienteBudgetPdf);
router.get('/:id/presupuesto/documentos/:historyId/url', requirePermission('documentos.read'), getExpedienteBudgetPdfUrl);
router.delete('/:id/presupuesto/documentos/:historyId', requirePermission('documentos.unlink'), deleteExpedienteBudgetPdf);
router.post('/', createExpediente);
router.patch('/:id', updateExpedienteHeader);
router.post('/convertir-cotizacion', convertCotizacionToExpediente);
router.post('/:id/transicion-estatus', requirePermission('expedientes.write'), transitionEstatus);
router.post('/:id/entrega', registerFinalDelivery);
router.post('/:id/postfirma/tramites', createPostfirmaTask);
router.patch('/:id/postfirma/tramites/:taskId', updatePostfirmaTask);
router.post('/:id/postfirma/transicion', transitionPostfirma);

// Financial movements
router.post('/:id/movimientos', requirePermission('finanzas.write'), addMovimientoFinanciero);
router.post('/:id/movimientos/:movimientoId/revertir', requirePermission('finanzas.write'), reverseMovimientoFinanciero);
router.patch('/:id/movimientos/:movimientoId/adjunto', requirePermission('finanzas.write'), updateMovimientoAdjunto);
router.post('/:id/movimientos/:movimientoId/adjuntos/upload', requirePermission('finanzas.write'), uploadMulter.single('file'), uploadMovimientoAdjuntoFile);
router.get('/:id/movimientos/:movimientoId/adjuntos/:tipo/visualizar', requirePermission('finanzas.read'), streamMovimientoAdjunto);
router.get('/:id/movimientos/:movimientoId/adjuntos/:tipo/descargar', requirePermission('finanzas.read'), downloadMovimientoAdjunto);

// Archivo Documental & Folder ZIP Downloads
router.post('/:id/archivar', requirePermission('expedientes.archive'), archiveExpediente);
router.get('/:id/documentos/descargar-zip', downloadCarpetaZip);
router.get('/:id/carpetas/:carpeta/zip', downloadCarpetaZip);
router.get('/:id/documentos/apendice', requirePermission('documentos.read'), getExpedienteDocumentAppendix);
router.post('/:id/documentos/sincronizar', requirePermission('documentos.write'), syncExpedienteDocumentAppendix);
router.get('/:id/documentos/apendice/:itemId/url', requirePermission('documentos.read'), getExpedienteAppendixSignedUrl);
router.post('/:id/documentos', requirePermission('documentos.write'), uploadDocumentoMulter.single('file'), addExpedienteDocumento);
router.patch('/:id/requisitos/:requisitoId', updateExpedienteRequisito);
router.patch('/:id/documentos/:documentoId', requirePermission('documentos.write'), updateExpedienteDocumento);
router.delete('/:id/documentos/:documentoId', requirePermission('documentos.unlink'), deleteExpedienteDocumento);
router.get('/:id/documentos/:documentoId/visualizar', requirePermission('documentos.read'), streamExpedienteDocumento);
router.get('/:id/documentos/:documentoId/descargar', requirePermission('documentos.read'), downloadExpedienteDocumento);

// Proyecto de Escritura & IA Analysis Reports
router.get('/:id/proyecto', requirePermission('expedientes.project.read'), getProyectoEscritura);
router.get('/:id/proyecto/matriz-datos', requirePermission('expedientes.project.read'), getDatosDetectadosMatrix);
router.post('/:id/proyecto/generar-ia', requirePermission('ia.execute'), generarProyectoConIA);
router.post('/:id/proyecto/upload', uploadProyectoMulter.single('file'), uploadProyectoVersion);
router.patch('/:id/proyecto/versions/:versionId', updateProyectoVersion);
router.get('/:id/proyecto/versions/:versionId/visualizar', requirePermission('expedientes.project.read'), streamProyectoVersion);
router.get('/:id/proyecto/versions/:versionId/descargar', requirePermission('expedientes.project.read'), downloadProyectoVersion);
router.post('/:id/proyecto/analizar-ia', requirePermission('ia.execute'), analizarProyectoConIA);
router.get('/:id/proyecto/reporte-ia/visualizar', requirePermission('expedientes.project.read'), streamIAReport);
router.get('/:id/proyecto/reporte-ia/descargar', requirePermission('expedientes.project.read'), downloadIAReport);

export default router;
