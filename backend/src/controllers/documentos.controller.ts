import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { uploadFile, getSignedUrl, deleteFile } from '../services/supabase.service';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { canAttachDocumento } from '../services/objectAccess.service';

/**
 * Subir un documento a Supabase Storage y crear registro en DB
 */
export const uploadDocumento = async (req: Request, res: Response) => {
  let nombre_interno = '';
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No se envió ningún archivo' });
    }

    const {
      tipo,
      categoria,
      prospecto_id,
      cotizacion_id,
      expediente_id,
      compareciente_id,
      observaciones
    } = req.body;

    if (!tipo) {
      return res.status(400).json({ error: 'tipo de documento es requerido' });
    }

    const actorUserId = req.user?.id;
    if (!actorUserId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
    const targetAccess = await canAttachDocumento(req.user!, {
      prospecto_id,
      cotizacion_id,
      expediente_id,
      compareciente_id,
    });
    if (!targetAccess) {
      return res.status(403).json({ error: 'No tienes acceso al expediente o catálogo de destino.', code: 'DOCUMENT_TARGET_ACCESS_DENIED' });
    }

    // Validate enum DocCategoria ('PROYECTO' | 'FIRMA')
    const validCategoria: 'PROYECTO' | 'FIRMA' = categoria === 'FIRMA' ? 'FIRMA' : 'PROYECTO';

    // Generate unique internal name
    const ext = path.extname(file.originalname) || '.bin';
    nombre_interno = `${uuidv4()}${ext}`;

    // Upload to Supabase Storage
    const storage_key = await uploadFile(file.buffer, nombre_interno, file.mimetype);

    const documentoData = {
      nombre_original: file.originalname,
      nombre_interno,
      tipo,
      categoria: validCategoria,
      storage_key,
      mime_type: file.mimetype,
      size_bytes: file.size,
      observaciones: observaciones || null,
      subido_por_id: actorUserId,
      prospecto_id: prospecto_id || null,
      cotizacion_id: cotizacion_id || null,
      expediente_id: expediente_id || null,
      compareciente_id: compareciente_id || null,
    };

    console.log('DOCUMENTO DATA:', documentoData);

    try {
      // Documento maestro + vínculos canónicos en una sola transacción.
      const documento = await prisma.$transaction(async (tx) => {
        const created = await tx.documento.create({ data: documentoData });
        const common = { documento_id: created.id, creado_por_id: actorUserId, tipo_vinculo: tipo, estatus: 'ACTIVO' as const };
        if (prospecto_id) await tx.prospectoDocumento.create({ data: { ...common, prospecto_id } });
        if (cotizacion_id) await tx.cotizacionDocumento.create({ data: { ...common, cotizacion_id } });
        if (expediente_id) await tx.expedienteDocumento.create({ data: { ...common, expediente_id } });
        if (compareciente_id) await tx.comparecienteDocumento.create({
          data: { compareciente_id, documento_id: created.id, categoria: 'OTROS', creado_por_id: actorUserId, estatus: 'ACTIVO' },
        });
        return tx.documento.findUniqueOrThrow({
          where: { id: created.id },
          include: { subido_por: { select: { nombre: true } } },
        });
      });

      res.status(201).json(documento);
    } catch (dbError: any) {
      console.error('DOCUMENTO CREATE ERROR');
      console.error(dbError);
      console.error(JSON.stringify(dbError, null, 2));

      // Clean up orphan file from Supabase Storage
      if (nombre_interno) {
        await deleteFile(nombre_interno).catch(delErr => console.error('Error al limpiar archivo huérfano:', delErr));
      }

      res.status(500).json({ error: 'No se pudo registrar el documento. El archivo no fue guardado. Intenta nuevamente.' });
    }
  } catch (error: any) {
    console.error('Error en uploadDocumento:', error);
    res.status(500).json({ error: 'No se pudo registrar el documento. El archivo no fue guardado. Intenta nuevamente.' });
  }
};

/**
 * Obtener una URL firmada temporal (2h) para un documento
 */
export const getDocumentoUrl = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const doc = await prisma.documento.findUnique({ where: { id } });
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    const url = await getSignedUrl(doc.storage_key);
    res.json({ url });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener URL del documento', detail: error.message });
  }
};

/**
 * Obtener todos los documentos de un prospecto
 */
export const getProspectoDocumentos = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const documentos = await prisma.documento.findMany({
      where: { prospecto_id: id },
      orderBy: { fecha_carga: 'desc' },
      include: { subido_por: { select: { nombre: true, id: true } } }
    });
    res.json(documentos);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al listar documentos', detail: error.message });
  }
};

export const unlinkProspectoDocumento = async (req: Request, res: Response) => {
  try {
    const { id, documentoId } = req.params;
    await prisma.$transaction([
      prisma.prospectoDocumento.updateMany({
        where: { prospecto_id: id, documento_id: documentoId, estatus: 'ACTIVO' },
        data: { estatus: 'INACTIVO', inactivado_at: new Date(), inactivado_por_id: req.user?.id },
      }),
      prisma.documento.updateMany({ where: { id: documentoId, prospecto_id: id }, data: { prospecto_id: null } }),
    ]);
    return res.json({ success: true, mensaje: 'Documento desvinculado del prospecto; el archivo maestro se conserva.' });
  } catch (error: any) {
    return res.status(500).json({ error: 'No fue posible desvincular el documento.', detail: error.message });
  }
};

export const desvincularDocumento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const doc = await prisma.documento.findUnique({ where: { id } });
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    // Desvincular de la cotización
    const updatedDoc = await prisma.documento.update({
      where: { id },
      data: { cotizacion_id: null }
    });

    const hasOtherRelations = Boolean(doc.prospecto_id || doc.expediente_id || doc.compareciente_id);

    res.json({
      desvinculado: true,
      documento: updatedDoc,
      hasOtherRelations,
      mensaje: hasOtherRelations 
        ? 'El documento fue desvinculado de la cotización.'
        : 'El documento fue desvinculado.'
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al desvincular el documento', detail: error.message });
  }
};

/**
 * Eliminar un documento (físico + registro DB)
 */
export const deleteDocumento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const doc = await prisma.documento.findUnique({ where: { id } });
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    if (doc.cotizacion_id) {
      await prisma.$transaction([
        prisma.cotizacionDocumento.updateMany({
          where: { cotizacion_id: doc.cotizacion_id, documento_id: id, estatus: 'ACTIVO' },
          data: { estatus: 'INACTIVO', inactivado_at: new Date(), inactivado_por_id: req.user?.id },
        }),
        prisma.documento.update({ where: { id }, data: { cotizacion_id: null } }),
      ]);
      return res.status(200).json({ success: true, mensaje: 'Documento desvinculado de la cotización; el archivo maestro se conserva.' });
    }
    return res.status(409).json({
      error: 'Para proteger archivos compartidos, desvincula el documento desde el expediente o catálogo correspondiente.',
      code: 'DOCUMENT_CONTEXT_REQUIRED',
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al eliminar documento', detail: error.message });
  }
};
