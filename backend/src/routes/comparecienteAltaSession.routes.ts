import { Router } from 'express';
import multer from 'multer';
import { ComparecienteAltaSessionController } from '../controllers/comparecienteAltaSession.controller';
import { requirePermission } from '../middleware/auth.middleware';
import { requireAltaCargaObjectAccess, requireAltaSessionObjectAccess } from '../middleware/objectAccess.middleware';

const upload = multer({
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB max limit
});

const router = Router();
router.param('sessionId', requireAltaSessionObjectAccess);
router.param('cargaId', requireAltaCargaObjectAccess);

// 1. GESTIÓN DE SESIONES (Soporta /, /altas, /session)
router.post('/', ComparecienteAltaSessionController.iniciarSesion);
router.post('/altas', ComparecienteAltaSessionController.iniciarSesion);
router.post('/session', ComparecienteAltaSessionController.iniciarSesion);

router.get('/:sessionId', ComparecienteAltaSessionController.obtenerSesion);
router.get('/altas/:sessionId', ComparecienteAltaSessionController.obtenerSesion);
router.get('/session/:sessionId', ComparecienteAltaSessionController.obtenerSesion);

router.put('/:sessionId/borrador', ComparecienteAltaSessionController.actualizarBorrador);
router.put('/altas/:sessionId/borrador', ComparecienteAltaSessionController.actualizarBorrador);
router.put('/session/:sessionId/borrador', ComparecienteAltaSessionController.actualizarBorrador);

router.delete('/:sessionId', ComparecienteAltaSessionController.cancelarSesion);
router.delete('/altas/:sessionId', ComparecienteAltaSessionController.cancelarSesion);
router.delete('/session/:sessionId', ComparecienteAltaSessionController.cancelarSesion);

// 2. DOCUMENTOS TEMPORALES (Soporta /:sessionId/documentos, /altas/:sessionId/documentos, /session/:sessionId/documentos)
router.post(
  '/:sessionId/documentos',
  upload.single('archivo'),
  ComparecienteAltaSessionController.subirDocumentoTemporal
);
router.post(
  '/altas/:sessionId/documentos',
  upload.single('archivo'),
  ComparecienteAltaSessionController.subirDocumentoTemporal
);
router.post(
  '/session/:sessionId/documentos',
  upload.single('archivo'),
  ComparecienteAltaSessionController.subirDocumentoTemporal
);

router.delete(
  '/:sessionId/documentos/:cargaId',
  ComparecienteAltaSessionController.eliminarDocumentoTemporal
);
router.delete(
  '/altas/:sessionId/documentos/:cargaId',
  ComparecienteAltaSessionController.eliminarDocumentoTemporal
);
router.delete(
  '/session/:sessionId/documentos/:cargaId',
  ComparecienteAltaSessionController.eliminarDocumentoTemporal
);

// STREAMING DE DOCUMENTOS PARA VISOR INTERNO (PDF Viewer)
router.get(
  '/:sessionId/documentos/:cargaId/stream',
  ComparecienteAltaSessionController.streamDocumentoTemporal
);
router.get(
  '/altas/:sessionId/documentos/:cargaId/stream',
  ComparecienteAltaSessionController.streamDocumentoTemporal
);
router.get(
  '/session/:sessionId/documentos/:cargaId/stream',
  ComparecienteAltaSessionController.streamDocumentoTemporal
);

router.put(
  '/:sessionId/documentos/:cargaId/clasificar',
  ComparecienteAltaSessionController.clasificarDocumentoTemporal
);
router.put(
  '/altas/:sessionId/documentos/:cargaId/clasificar',
  ComparecienteAltaSessionController.clasificarDocumentoTemporal
);
router.put(
  '/session/:sessionId/documentos/:cargaId/clasificar',
  ComparecienteAltaSessionController.clasificarDocumentoTemporal
);

// 3. EXTRACCIÓN MEDIANTE IA
router.post(
  '/:sessionId/extraer-ia',
  requirePermission('ia.execute'),
  ComparecienteAltaSessionController.extraerIA
);
router.post(
  '/altas/:sessionId/extraer-ia',
  requirePermission('ia.execute'),
  ComparecienteAltaSessionController.extraerIA
);
router.post(
  '/session/:sessionId/extraer-ia',
  requirePermission('ia.execute'),
  ComparecienteAltaSessionController.extraerIA
);

router.post(
  '/:sessionId/extraer',
  requirePermission('ia.execute'),
  ComparecienteAltaSessionController.extraerIA
);
router.post(
  '/altas/:sessionId/extraer',
  requirePermission('ia.execute'),
  ComparecienteAltaSessionController.extraerIA
);
router.post(
  '/session/:sessionId/extraer',
  requirePermission('ia.execute'),
  ComparecienteAltaSessionController.extraerIA
);

// 4. CONFIRMAR ALTA DEFINITIVA
router.post(
  '/:sessionId/confirmar',
  ComparecienteAltaSessionController.confirmarAlta
);
router.post(
  '/altas/:sessionId/confirmar',
  ComparecienteAltaSessionController.confirmarAlta
);
router.post(
  '/session/:sessionId/confirmar',
  ComparecienteAltaSessionController.confirmarAlta
);

export default router;
