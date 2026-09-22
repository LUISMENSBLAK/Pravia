import express from 'express';
import multer from 'multer';
import {
  getCotizaciones, 
  getCotizacionById, 
  createCotizacion, 
  updateCotizacionEstado, 
  extractPresupuesto,
  generateCotizacionDocument,
  updateCotizacionPresupuesto,
  registrarAnticipo,
  validarAnticipo,
  convertToExpediente,
  getCotizacionSeguimientos,
  createCotizacionSeguimiento,
  registerCotizacionDelivery,
  actCotizacionContract,
  getCotizacionDocumentos,
  unlinkCotizacionDocumento,
  viewCotizacionDocumento,
  downloadCotizacionDocumento,
} from '../controllers/cotizaciones.controller';
import { requirePermission } from '../middleware/auth.middleware';
import { requireCotizacionObjectAccess, requireDocumentoObjectAccess } from '../middleware/objectAccess.middleware';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
router.param('id', requireCotizacionObjectAccess);

router.get('/', getCotizaciones);
router.get('/:id', getCotizacionById);
router.post('/', createCotizacion);
router.put('/:id/estado', updateCotizacionEstado);
router.post('/extraer-presupuesto', upload.single('archivo'), extractPresupuesto);
router.put('/:id/presupuesto', updateCotizacionPresupuesto);
router.post('/:id/generar-documento', generateCotizacionDocument);
router.post('/:id/anticipo', requirePermission('finanzas.write'), registrarAnticipo);
router.post('/pago/:pagoId/validar', requirePermission('finanzas.validate'), validarAnticipo);
router.post('/:id/convertir', requirePermission('expedientes.write'), convertToExpediente);
router.get('/:id/seguimientos', getCotizacionSeguimientos);
router.post('/:id/seguimientos', createCotizacionSeguimiento);
router.post('/:id/registrar-envio', registerCotizacionDelivery);
router.post('/:id/acciones', actCotizacionContract);
// Documentos de Cotización (Heredados de Prospecto + Subidos en Cotización)
router.get('/:id/documentos', getCotizacionDocumentos);
router.get('/:id/documentos/:documentoId/ver', requireDocumentoObjectAccess, requirePermission('documentos.read'), viewCotizacionDocumento);
router.get('/:id/documentos/:documentoId/descargar', requireDocumentoObjectAccess, requirePermission('documentos.read'), downloadCotizacionDocumento);
router.delete('/:id/documentos/:documentoId', requireDocumentoObjectAccess, requirePermission('documentos.unlink'), unlinkCotizacionDocumento);

export default router;
