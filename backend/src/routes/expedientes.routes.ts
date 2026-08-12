import express from 'express';
import {
  getExpedientes,
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

const router = express.Router();
router.param('id', requireExpedienteAccess);

router.get('/tipos-acto', getTiposActo);
router.get('/', getExpedientes);
router.get('/:id', getExpedienteById);
router.post('/', createExpediente);
router.patch('/:id', updateExpedienteHeader);
router.post('/convertir-cotizacion', convertCotizacionToExpediente);
router.post('/:id/transicion-estatus', transitionEstatus);
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
router.post('/:id/documentos', uploadDocumentoMulter.single('file'), addExpedienteDocumento);
router.patch('/:id/documentos/:documentoId', updateExpedienteDocumento);
router.delete('/:id/documentos/:documentoId', deleteExpedienteDocumento);
router.get('/:id/documentos/:documentoId/visualizar', streamExpedienteDocumento);
router.get('/:id/documentos/:documentoId/descargar', downloadExpedienteDocumento);

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
