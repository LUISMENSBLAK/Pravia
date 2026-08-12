import express from 'express';
import multer from 'multer';
import {
  getCotizaciones, 
  getCotizacionById, 
  createCotizacion, 
  updateCotizacionEstado, 
  createCotizacionVersion,
  aprobarVersion,
  extractPresupuesto,
  registrarAnticipo,
  validarAnticipo,
  convertToExpediente,
  getCotizacionSeguimientos,
  createCotizacionSeguimiento,
  updateParticipacionPravia,
  getCotizacionDocumentos,
  unlinkCotizacionDocumento
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
router.post('/:id/versiones', createCotizacionVersion);
router.post('/version/:versionId/aprobar', aprobarVersion);
router.post('/extraer-presupuesto', upload.single('archivo'), extractPresupuesto);
router.post('/:id/anticipo', requirePermission('finanzas.write'), registrarAnticipo);
router.post('/pago/:pagoId/validar', requirePermission('finanzas.validate'), validarAnticipo);
router.post('/:id/convertir', requirePermission('expedientes.write'), convertToExpediente);
router.get('/:id/seguimientos', getCotizacionSeguimientos);
router.post('/:id/seguimientos', createCotizacionSeguimiento);
router.put('/:id/participacion-pravia', requirePermission('finanzas.write'), updateParticipacionPravia);
router.patch('/:id/participacion-pravia', requirePermission('finanzas.write'), updateParticipacionPravia);

// Documentos de Cotización (Heredados de Prospecto + Subidos en Cotización)
router.get('/:id/documentos', getCotizacionDocumentos);
router.delete('/:id/documentos/:documentoId', requireDocumentoObjectAccess, requirePermission('documentos.unlink'), unlinkCotizacionDocumento);

export default router;
