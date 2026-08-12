import { Request, Response } from 'express';
import { ComparecienteAltaSessionService } from '../services/comparecienteAltaSession.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUUID(val: any): boolean {
  return typeof val === 'string' && UUID_REGEX.test(val);
}

export class ComparecienteAltaSessionController {
  /**
   * POST /api/comparecientes/altas
   */
  static async iniciarSesion(req: Request, res: Response) {
    try {
      const usuario_id = req.user?.id;
      if (!usuario_id) return res.status(401).json({ success: false, ok: false, error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
      const { tipo_persona, idempotency_key, origen_expediente_id, correlation_id } = req.body;

      const sesion = await ComparecienteAltaSessionService.iniciarOSentarseSesion({
        usuario_id,
        tipo_persona,
        idempotency_key,
        origen_expediente_id,
        correlation_id
      });

      return res.status(201).json({
        success: true,
        ok: true,
        session: {
          id: sesion.id,
          estatus: sesion.estatus,
          tipo_persona: sesion.tipo_persona,
          expires_at: sesion.expires_at,
          cargasTemporales: sesion.cargasTemporales || []
        }
      });
    } catch (err: any) {
      console.error('[AltaSessionController] Error en iniciarSesion:', err);
      return res.status(500).json({ success: false, ok: false, error: err.message });
    }
  }

  /**
   * GET /api/comparecientes/altas/:sessionId
   */
  static async obtenerSesion(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      if (!isUUID(sessionId)) {
        return res.status(400).json({
          success: false,
          ok: false,
          error: 'El identificador de la sesión de alta no es un UUID válido.',
          session_id_recibido: String(sessionId).slice(0, 40)
        });
      }

      const sesion = await ComparecienteAltaSessionService.obtenerSesion(sessionId);

      return res.status(200).json({
        success: true,
        ok: true,
        session: sesion
      });
    } catch (err: any) {
      return res.status(404).json({ success: false, ok: false, error: err.message });
    }
  }

  /**
   * PUT /api/comparecientes/altas/:sessionId/borrador
   */
  static async actualizarBorrador(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      if (!isUUID(sessionId)) {
        return res.status(400).json({
          success: false,
          ok: false,
          error: 'El identificador de la sesión de alta no es un UUID válido.',
          session_id_recibido: String(sessionId).slice(0, 40)
        });
      }

      const sesion = await ComparecienteAltaSessionService.actualizarBorrador(sessionId, req.body);

      return res.status(200).json({
        success: true,
        ok: true,
        session: sesion
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, ok: false, error: err.message });
    }
  }

  /**
   * POST /api/comparecientes/altas/:sessionId/documentos
   */
  static async subirDocumentoTemporal(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      if (!isUUID(sessionId)) {
        return res.status(400).json({
          success: false,
          ok: false,
          error: 'El identificador de la sesión de alta no es un UUID válido.',
          session_id_recibido: String(sessionId).slice(0, 40)
        });
      }

      const archivo = req.file;
      const usuarioId = req.user?.id;
      if (!usuarioId) return res.status(401).json({ success: false, ok: false, error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
      const tipoDocumento = req.body.tipo_documento || 'OTRO';

      if (!archivo) {
        return res.status(400).json({
          success: false,
          ok: false,
          error: 'No se recibió ningún archivo en el campo "archivo"'
        });
      }

      const carga = await ComparecienteAltaSessionService.subirDocumentoTemporal({
        sessionId,
        usuarioId,
        buffer: archivo.buffer,
        nombreOriginal: archivo.originalname,
        mimeType: archivo.mimetype,
        tipoDocumento
      });

      return res.status(201).json({
        success: true,
        ok: true,
        documento: {
          id: carga.id,
          nombre_original: carga.nombre_original,
          tipo_documento: carga.tipo_documento,
          estado: carga.estado,
          tamano_bytes: carga.tamano_bytes,
          created_at: carga.created_at
        }
      });
    } catch (err: any) {
      console.error('[AltaSessionController] Error al subir documento temporal:', err);
      return res.status(500).json({
        success: false,
        ok: false,
        error: err.message || 'Error al persistir documento en el servidor'
      });
    }
  }

  /**
   * DELETE /api/comparecientes/altas/:sessionId/documentos/:cargaId
   */
  static async eliminarDocumentoTemporal(req: Request, res: Response) {
    try {
      const { sessionId, cargaId } = req.params;
      if (!isUUID(sessionId)) {
        return res.status(400).json({
          success: false,
          ok: false,
          error: 'El identificador de la sesión de alta no es un UUID válido.',
          session_id_recibido: String(sessionId).slice(0, 40)
        });
      }

      const resultado = await ComparecienteAltaSessionService.eliminarDocumentoTemporal(cargaId);

      return res.status(200).json({
        success: true,
        ok: true,
        documento: resultado
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, ok: false, error: err.message });
    }
  }

  /**
   * PUT /api/comparecientes/altas/:sessionId/documentos/:cargaId/clasificar
   */
  static async clasificarDocumentoTemporal(req: Request, res: Response) {
    try {
      const { sessionId, cargaId } = req.params;
      if (!isUUID(sessionId)) {
        return res.status(400).json({
          success: false,
          ok: false,
          error: 'El identificador de la sesión de alta no es un UUID válido.',
          session_id_recibido: String(sessionId).slice(0, 40)
        });
      }

      const { tipo_documento } = req.body;
      const resultado = await ComparecienteAltaSessionService.clasificarDocumentoTemporal(cargaId, tipo_documento);

      return res.status(200).json({
        success: true,
        ok: true,
        documento: resultado
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, ok: false, error: err.message });
    }
  }

  /**
   * POST /api/comparecientes/altas/:sessionId/extraer
   */
  static async extraerIA(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      if (!isUUID(sessionId)) {
        return res.status(400).json({
          success: false,
          ok: false,
          error: 'El identificador de la sesión de alta no es un UUID válido.',
          session_id_recibido: String(sessionId).slice(0, 40)
        });
      }

      const { carga_id, documentos } = req.body;
      const file = req.file;

      let documentoIds: string[] = [];
      if (Array.isArray(documentos) && documentos.length > 0) {
        documentoIds = documentos.map((d: any) => (typeof d === 'string' ? d : d.id)).filter((id: string) => isUUID(id));
      } else if (isUUID(carga_id)) {
        documentoIds = [carga_id];
      }

      const resultado = await ComparecienteAltaSessionService.extraerDatosConIA(
        sessionId,
        documentoIds,
        file ? file.buffer : undefined
      );

      return res.status(200).json({
        ok: true,
        ...resultado
      });
    } catch (err: any) {
      console.error('[AltaSessionController] Error en extracción IA:', err);
      return res.status(500).json({
        success: false,
        ok: false,
        error: 'IA_EXTRACTION_ERROR',
        provider: 'OPENAI',
        finishReason: err.finishReason || 'UNKNOWN',
        partsCount: err.partsCount || 0,
        rawLength: err.rawLength || 0,
        mensaje: err.message
      });
    }
  }

  /**
   * POST /api/comparecientes/altas/:sessionId/confirmar
   */
  static async confirmarAlta(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      if (!isUUID(sessionId)) {
        return res.status(400).json({
          success: false,
          ok: false,
          error: 'El identificador de la sesión de alta no es un UUID válido.',
          session_id_recibido: String(sessionId).slice(0, 40)
        });
      }

      const usuarioId = req.user?.id;
      if (!usuarioId) return res.status(401).json({ success: false, ok: false, error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
      const resultado = await ComparecienteAltaSessionService.confirmarAltaDefinitiva({
        sessionId,
        usuarioId,
        datosFormulario: req.body,
        documentosIntegrarIds: req.body.documentos_integrar || []
      });

      return res.status(200).json({
        success: true,
        ok: true,
        ...resultado
      });
    } catch (err: any) {
      console.error('[AltaSessionController] Error en confirmarAlta:', err);
      return res.status(500).json({ success: false, ok: false, error: err.message });
    }
  }

  /**
   * GET /api/comparecientes/altas/:sessionId/documentos/:cargaId/stream
   * Sirve el archivo directamente como blob para el visor interno
   */
  static async streamDocumentoTemporal(req: Request, res: Response) {
    try {
      const { sessionId, cargaId } = req.params;
      if (!isUUID(sessionId)) {
        return res.status(400).json({ success: false, error: 'Session ID inválido' });
      }

      const resultado = await ComparecienteAltaSessionService.streamDocumentoTemporal(cargaId);

      res.set('Content-Type', resultado.mimeType);
      res.set('Content-Disposition', `inline; filename="${encodeURIComponent(resultado.fileName)}"`);
      res.set('Content-Length', String(resultado.buffer.length));
      res.set('Cache-Control', 'private, max-age=3600');
      res.set('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(resultado.buffer);
    } catch (err: any) {
      console.error('[AltaSessionController] Error al servir documento:', err);
      return res.status(404).json({ success: false, error: err.message });
    }
  }

  /**
   * DELETE /api/comparecientes/altas/:sessionId
   */
  static async cancelarSesion(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      if (!isUUID(sessionId)) {
        return res.status(400).json({
          success: false,
          ok: false,
          error: 'El identificador de la sesión de alta no es un UUID válido.',
          session_id_recibido: String(sessionId).slice(0, 40)
        });
      }

      await ComparecienteAltaSessionService.cancelarSesion(sessionId);

      return res.status(200).json({
        success: true,
        ok: true,
        mensaje: 'Sesión de alta cancelada'
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, ok: false, error: err.message });
    }
  }
}
