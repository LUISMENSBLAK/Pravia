import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { CotizacionEstado, Prisma } from '@prisma/client';
import { logAudit } from '../utils/auditLogger';
import {
  CotizacionBusinessError,
  evaluateConversionEligibility,
  getAllowedCotizacionTransitions,
  validateCotizacionTransition,
} from '../domain/cotizacionWorkflow';
import { CotizacionConversionService } from '../services/cotizacionConversion.service';
import { canAccessCotizacion, canAccessDocumento, canAccessProspecto, cotizacionObjectWhere } from '../services/objectAccess.service';

const cotizacionConversionService = new CotizacionConversionService(prisma);

export const getCotizaciones = async (req: Request, res: Response) => {
  try {
    const { estado } = req.query;
    const where: any = req.user ? cotizacionObjectWhere(req.user) : {};
    if (estado) {
      where.estado = estado as string;
    }

    const cotizaciones = await prisma.cotizacion.findMany({
      where,
      include: {
        prospecto: { select: { nombre: true, tipo_acto: true } },
        notaria: { select: { nombre: true } },
        creada_por: { select: { nombre: true } },
        versiones: { orderBy: { version: 'desc' } },
        pagos: {
          where: { categoria_ingreso: 'ANTICIPO_NOTARIA' },
          select: { id: true, monto: true, estatus: true, categoria_ingreso: true, fecha_pago: true },
        },
        expediente: true
      },
      orderBy: { created_at: 'desc' }
    });
    res.json(cotizaciones);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener cotizaciones', detail: error.message });
  }
};

export const getCotizacionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cotizacion = await prisma.cotizacion.findUnique({
      where: { id },
      include: {
        prospecto: {
          include: {
            documentos: true
          }
        },
        notaria: true,
        versiones: { orderBy: { version: 'desc' } },
        documentos: true,
        pagos: true,
        expediente: true,
        creada_por: { select: { nombre: true } }
      }
    });

    if (!cotizacion) return res.status(404).json({ error: 'Cotización no encontrada' });
    const safeCotizacion = {
      ...cotizacion,
      versiones: cotizacion.versiones || [],
      documentos: cotizacion.documentos || [],
      pagos: cotizacion.pagos || [],
      transiciones_permitidas: getAllowedCotizacionTransitions(cotizacion.estado),
      conversion: evaluateConversionEligibility(cotizacion),
    };
    res.json(safeCotizacion);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener cotización', detail: error.message });
  }
};

export const createCotizacion = async (req: Request, res: Response) => {
  try {
    const { prospecto_id, notaria_id } = req.body;

    if (!prospecto_id) {
      return res.status(400).json({ error: 'prospecto_id es requerido' });
    }

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
    if (!(await canAccessProspecto(req.user!, String(prospecto_id)))) {
      return res.status(403).json({ error: 'No tienes acceso al prospecto seleccionado.', code: 'PROSPECTO_ACCESS_DENIED' });
    }

    // Get prospecto info for email generation
    const prospecto = await prisma.prospecto.findUnique({
      where: { id: prospecto_id },
      include: { documentos: true }
    });

    if (!prospecto) return res.status(404).json({ error: 'Prospecto no encontrado' });
    const existing = await prisma.cotizacion.findUnique({ where: { prospecto_id } });
    if (existing) {
      return res.status(409).json({
        error: 'Este prospecto ya tiene una cotización vinculada.',
        code: 'PROSPECT_ALREADY_HAS_QUOTE',
        existing_id: existing.id,
      });
    }
    if (notaria_id) {
      const validNotary = await prisma.notaria.findFirst({ where: { id: notaria_id, activa: true }, select: { id: true } });
      if (!validNotary) return res.status(400).json({ error: 'La notaría seleccionada no existe.' });
    }

    // Generate suggested email body
    const docsList = prospecto.documentos.map(d => `- ${d.tipo || 'Documento'} (${d.nombre_original})`).join('\n') || '- No hay documentos cargados';
    const cuerpo_correo_notaria = `Buen día.

Solicitamos atentamente la cotización correspondiente al siguiente acto:

Acto:
${prospecto.tipo_acto || 'No especificado'}

Compareciente o solicitante:
${prospecto.nombre}

Se adjunta la documentación disponible para su revisión:
${docsList}

Quedamos atentos.

PRAVIA`;

    const year = new Date().getFullYear();
    const cotizacion = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cotizacion-folio:${year}`}))`);
      const yearlyFolios = await tx.cotizacion.findMany({
        where: {
          created_at: {
            gte: new Date(`${year}-01-01T00:00:00.000Z`),
            lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
          },
        },
        select: { numero_solicitud: true },
      });
      const nextSequence = yearlyFolios.reduce((highest, quote) => {
        const match = quote.numero_solicitud?.match(new RegExp(`^SOL-${year}-(\\d+)$`));
        return Math.max(highest, match ? Number(match[1]) : 0);
      }, 0) + 1;
      const sequence = String(nextSequence).padStart(3, '0');
      const created = await tx.cotizacion.create({
        data: {
          numero_solicitud: `SOL-${year}-${sequence}`,
          numero_cotizacion: `COT-${year}-${sequence}`,
          prospecto_id,
          user_id: userId,
          notaria_id,
          estado: CotizacionEstado.BORRADOR,
          cuerpo_correo_notaria,
        },
      });
      await tx.prospecto.update({
        where: { id: prospecto_id },
        data: { estado: 'COTIZACION_SOLICITADA' },
      });
      return created;
    });

    await logAudit(userId, 'CREATE', 'Cotizacion', cotizacion.id, { numero_solicitud: cotizacion.numero_solicitud });

    res.status(201).json({
      ...cotizacion,
      versiones: [],
      documentos: [],
      pagos: []
    });
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({
        error: 'La cotización ya existe o el folio fue reservado por otra operación. Recarga la lista para continuar.',
        code: 'DUPLICATE_QUOTE',
      });
    }
    res.status(500).json({ error: 'Error al crear cotización', detail: error.message });
  }
};

export const updateCotizacionEstado = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const actorUserId = req.user?.id;
    if (!actorUserId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });

    if (!Object.values(CotizacionEstado).includes(estado as CotizacionEstado)) {
      return res.status(400).json({ error: 'Estado de cotización inválido.', code: 'INVALID_COTIZACION_STATE' });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cotizacion-state:${id}`}))`);
      const current = await tx.cotizacion.findUnique({
        where: { id },
        include: { versiones: { select: { aprobada: true } } },
      });
      if (!current) {
        throw new CotizacionBusinessError('Cotización no encontrada.', 'COTIZACION_NOT_FOUND', 404);
      }

      validateCotizacionTransition({
        current: current.estado,
        next: estado as CotizacionEstado,
        hasNotaria: Boolean(current.notaria_id),
        hasApprovedVersion: current.versiones.some((version) => version.aprobada),
      });

      if (current.estado === estado) return { cotizacion: current, changed: false };

      const dataToUpdate: any = { estado };
      if (estado === CotizacionEstado.ENVIADA_NOTARIA) {
        dataToUpdate.fecha_solicitud_notaria = new Date();
        const limit = new Date();
        limit.setDate(limit.getDate() + 5);
        dataToUpdate.fecha_limite_respuesta_notaria = limit;
      } else if (estado === CotizacionEstado.PRESUPUESTO_RECIBIDO || estado === CotizacionEstado.EN_REVISION_ABOGADO) {
        dataToUpdate.fecha_presupuesto_recibido = new Date();
      } else if (estado === CotizacionEstado.ENVIADA_CLIENTE || estado === CotizacionEstado.EN_NEGOCIACION) {
        dataToUpdate.fecha_enviada_cliente = new Date();
      } else if (estado === CotizacionEstado.ACEPTADA) {
        dataToUpdate.fecha_aceptacion_cliente = new Date();
      }

      const cotizacion = await tx.cotizacion.update({ where: { id }, data: dataToUpdate });
      return { cotizacion, changed: true };
    });

    if (result.changed) {
      await logAudit(actorUserId, 'UPDATE_ESTADO', 'Cotizacion', id, { nuevo_estado: estado });
    }

    res.json({
      ...result.cotizacion,
      transiciones_permitidas: getAllowedCotizacionTransitions(result.cotizacion.estado),
    });
  } catch (error: any) {
    if (error instanceof CotizacionBusinessError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    res.status(500).json({ error: 'Error al actualizar estado', detail: error.message });
  }
};

export const createCotizacionVersion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      desglose_notaria,
      desglose_pravia,
      total_notaria,
      honorarios_pravia,
      notas,
      aprobada
    } = req.body;
    const actorUserId = req.user?.id;
    if (!actorUserId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });

    // Total cliente equals total notaria (PRAVIA participation is an internal split, NOT an additive fee)
    const totalNotariaVal = Number(total_notaria || 0);
    const totalClienteVal = totalNotariaVal;
    const honorariosPraviaVal = Number(honorarios_pravia || 0);
    if (!Number.isFinite(totalNotariaVal) || totalNotariaVal <= 0) {
      return res.status(400).json({ error: 'El total notarial debe ser mayor que cero.', code: 'INVALID_QUOTE_TOTAL' });
    }
    if (!Number.isFinite(honorariosPraviaVal) || honorariosPraviaVal < 0 || honorariosPraviaVal > totalNotariaVal) {
      return res.status(400).json({
        error: 'Los honorarios PRAVIA deben estar entre cero y el total notarial.',
        code: 'INVALID_PRAVIA_FEE',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cotizacion-version:${id}`}))`);
      const cotizacion = await tx.cotizacion.findUnique({ where: { id } });
      if (!cotizacion) {
        throw new CotizacionBusinessError('Cotización no encontrada.', 'COTIZACION_NOT_FOUND', 404);
      }

      const latestVersion = await tx.cotizacionVersion.findFirst({
        where: { cotizacion_id: id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const newVersionNum = latestVersion ? latestVersion.version + 1 : 1;
      const userId = actorUserId;

      if (aprobada) {
        await tx.cotizacionVersion.updateMany({
          where: { cotizacion_id: id, aprobada: true },
          data: { aprobada: false },
        });
      }

      const version = await tx.cotizacionVersion.create({
        data: {
          cotizacion_id: id,
          version: newVersionNum,
          desglose_notaria,
          desglose_pravia,
          total_notaria: totalNotariaVal,
          honorarios_pravia: honorariosPraviaVal,
          total_cliente: totalClienteVal,
          creada_por_id: userId,
          aprobada: aprobada ?? false,
          notas
        }
      });
      const updatedCotizacion = await tx.cotizacion.update({
        where: { id },
        data: {
          version_actual: newVersionNum,
          total_notaria: totalNotariaVal,
          honorarios_pravia: honorariosPraviaVal,
          total_cliente: totalClienteVal,
          cuerpo_correo_cliente: `Estimado(a) cliente,

Adjunto encontrará la propuesta económica de honorarios y gastos notariales para su trámite de ${cotizacion.numero_cotizacion}.

Total Presupuesto Notarial y Gastos: $${totalClienteVal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}

Quedamos a su entera disposición para cualquier duda.
Saludos cordiales,
Equipo PRAVIA OS`,
          ...(aprobada ? { fecha_aprobacion_version: new Date() } : {})
        }
      });
      return { version, updatedCotizacion, userId, newVersionNum };
    });

    await logAudit(result.userId, 'CREATE_VERSION', 'Cotizacion', id, {
      version: result.newVersionNum,
      aprobada: Boolean(aprobada),
    });

    res.status(201).json({ version: result.version, cotizacion: result.updatedCotizacion });
  } catch (error: any) {
    if (error instanceof CotizacionBusinessError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({
        error: 'Otra operación creó esta versión al mismo tiempo. Recarga la cotización para continuar.',
        code: 'QUOTE_VERSION_CONFLICT',
      });
    }
    res.status(500).json({ error: 'Error al crear versión', detail: error.message });
  }
};

export const aprobarVersion = async (req: Request, res: Response) => {
  try {
    const { versionId } = req.params;
    const actorUserId = req.user?.id;
    if (!actorUserId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });

    const target = await prisma.cotizacionVersion.findUnique({ where: { id: versionId } });
    if (!target) return res.status(404).json({ error: 'Versión de cotización no encontrada.' });
    if (!(await canAccessCotizacion(req.user!, target.cotizacion_id))) {
      return res.status(403).json({ error: 'No tienes acceso a esta cotización.', code: 'COTIZACION_ACCESS_DENIED' });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cotizacion-version:${target.cotizacion_id}`}))`);
      const version = await tx.cotizacionVersion.findUnique({ where: { id: versionId } });
      if (!version) {
        throw new CotizacionBusinessError('Versión de cotización no encontrada.', 'QUOTE_VERSION_NOT_FOUND', 404);
      }

      await tx.cotizacionVersion.updateMany({
        where: { cotizacion_id: version.cotizacion_id, aprobada: true, NOT: { id: version.id } },
        data: { aprobada: false },
      });
      const approvedVersion = await tx.cotizacionVersion.update({
        where: { id: version.id },
        data: { aprobada: true },
      });
      const cotizacion = await tx.cotizacion.update({
        where: { id: version.cotizacion_id },
        data: {
          version_actual: version.version,
          total_notaria: version.total_notaria,
          honorarios_pravia: version.honorarios_pravia,
          total_cliente: version.total_cliente,
          fecha_aprobacion_version: new Date(),
        },
      });
      return { version: approvedVersion, cotizacion };
    });

    await logAudit(actorUserId, 'APPROVE_VERSION', 'CotizacionVersion', versionId, { version: result.version.version });

    res.json(result.version);
  } catch (error: any) {
    if (error instanceof CotizacionBusinessError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    res.status(500).json({ error: 'Error al aprobar versión', detail: error.message });
  }
};

export const extractPresupuesto = async (req: Request, res: Response) => {
  try {
    let pdfBuffer: Buffer | null = null;

    if (req.file) {
      pdfBuffer = req.file.buffer;
    } else {
      const documentoId = req.body?.documentoId || req.body?.documento_id;
      const cotizacionId = req.params?.id || req.body?.cotizacionId || req.body?.cotizacion_id;

      let doc = null;
      if (documentoId) {
        if (!req.user || !(await canAccessDocumento(req.user, String(documentoId)))) {
          return res.status(403).json({ error: 'No tienes acceso al documento solicitado.', code: 'DOCUMENTO_ACCESS_DENIED' });
        }
        doc = await prisma.documento.findUnique({ where: { id: documentoId } });
      } else if (cotizacionId) {
        if (!req.user || !(await canAccessCotizacion(req.user, String(cotizacionId)))) {
          return res.status(403).json({ error: 'No tienes acceso a esta cotización.', code: 'COTIZACION_ACCESS_DENIED' });
        }
        doc = await prisma.documento.findFirst({
          where: {
            cotizacion_id: cotizacionId,
            OR: [
              { tipo: 'PRESUPUESTO_NOTARIA' },
              { categoria: 'PROYECTO' }
            ]
          },
          orderBy: { fecha_carga: 'desc' }
        });
      }

      if (!doc) {
        return res.status(400).json({ error: 'No se encontró el documento PDF de presupuesto cargado para esta cotización.' });
      }

      const { downloadFile } = await import('../services/supabase.service');
      pdfBuffer = await downloadFile(doc.storage_key);
    }

    if (!pdfBuffer) {
      return res.status(400).json({ error: 'No se pudo obtener el contenido del archivo PDF' });
    }

    const { extractPresupuestoData } = await import('../services/claude.service');
    const filename = req.file?.originalname || 'Documento_Cotizacion.pdf';
    const extraction = await extractPresupuestoData(pdfBuffer, filename);
    res.json(extraction);
  } catch (error: any) {
    console.error('Error en extractPresupuesto:', error);
    res.status(500).json({ error: 'Error al extraer montos del PDF', detail: error.message });
  }
};

export const registrarAnticipo = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { monto, fecha, comprobante_url, notas } = req.body;
    const actorUserId = req.user?.id;
    if (!actorUserId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });

    if (!monto || Number(monto) <= 0) {
      return res.status(400).json({ error: 'El monto del anticipo debe ser mayor a 0.' });
    }

    const cotizacion = await prisma.cotizacion.findUnique({ where: { id }, include: { expediente: true } });
    if (!cotizacion) return res.status(404).json({ error: 'Cotización no encontrada.' });
    if (cotizacion.expediente || cotizacion.estado === CotizacionEstado.CONVERTIDA_EXPEDIENTE) {
      return res.status(409).json({ error: 'La cotización ya fue convertida; registra nuevos pagos desde el expediente.' });
    }
    if (cotizacion.estado !== CotizacionEstado.ACEPTADA) {
      return res.status(400).json({
        error: 'El anticipo sólo puede registrarse después de que el cliente acepte la cotización.',
        code: 'QUOTE_MUST_BE_ACCEPTED',
      });
    }

    const pago = await prisma.pago.create({
      data: {
        cotizacion_id: id,
        categoria_ingreso: 'ANTICIPO_NOTARIA',
        concepto: 'Anticipo de cliente para trámite notarial',
        monto: Number(monto),
        fecha_pago: fecha ? new Date(fecha) : new Date(),
        estatus: 'RECIBIDO',
        comprobante_url,
        notas
      }
    });

    await logAudit(actorUserId, 'REGISTRAR_ANTICIPO', 'Pago', pago.id, { monto });

    res.status(201).json(pago);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al registrar anticipo', detail: error.message });
  }
};

export const validarAnticipo = async (req: Request, res: Response) => {
  try {
    const { pagoId } = req.params;
    const actor = req.user;
    if (!actor) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });

    const pagoActual = await prisma.pago.findUnique({ where: { id: pagoId } });
    if (!pagoActual || !pagoActual.cotizacion_id || pagoActual.categoria_ingreso !== 'ANTICIPO_NOTARIA') {
      return res.status(404).json({ error: 'Anticipo de cotización no encontrado.' });
    }
    if (!(await canAccessCotizacion(actor, pagoActual.cotizacion_id))) {
      return res.status(403).json({ error: 'No tienes acceso a esta cotización.', code: 'COTIZACION_ACCESS_DENIED' });
    }
    if (pagoActual.estatus === 'VALIDADO') return res.json(pagoActual);
    if (!['PENDIENTE', 'RECIBIDO'].includes(pagoActual.estatus)) {
      return res.status(409).json({ error: `No se puede validar un anticipo en estado ${pagoActual.estatus}.` });
    }

    if (!['DIRECCION', 'ADMINISTRACION'].includes(actor.rol)) {
      return res.status(403).json({
        error: 'La validación del anticipo requiere un usuario activo de Dirección o Administración.',
        code: 'ADVANCE_VALIDATION_FORBIDDEN',
      });
    }
    const userId = actor.id;

    const pago = await prisma.pago.update({
      where: { id: pagoId },
      data: {
        estatus: 'VALIDADO',
        validado_por_id: userId,
        fecha_validacion: new Date()
      }
    });

    if (userId) {
      await logAudit(userId, 'VALIDAR_ANTICIPO', 'Pago', pagoId, { monto: pago.monto });
    }

    res.json(pago);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al validar anticipo por administración', detail: error.message });
  }
};

export const convertToExpediente = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tipo_acto_id, abogado_id } = req.body;
    if (!req.user || !(await canAccessCotizacion(req.user, id))) {
      return res.status(403).json({ error: 'No tienes acceso a esta cotización.', code: 'COTIZACION_ACCESS_DENIED' });
    }
    const result = await cotizacionConversionService.convert({
      cotizacionId: id,
      actorUserId: req.user?.id,
      tipoActoId: tipo_acto_id,
      abogadoId: abogado_id,
      correlationId: (req as any).correlationId,
    });
    res.status(result.alreadyConverted ? 200 : 201).json({
      ...result.expediente,
      idempotent: result.alreadyConverted,
      correlation_id: result.correlationId,
      anticipo_validado: result.validatedAdvanceTotal,
    });
  } catch (error: any) {
    if (error instanceof CotizacionBusinessError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    res.status(500).json({ error: 'Error al convertir a expediente', code: 'CONVERSION_FAILED' });
  }
};

export const getCotizacionSeguimientos = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const seguimientos = await prisma.cotizacionSeguimiento.findMany({
      where: { cotizacion_id: id },
      include: { usuario: { select: { nombre: true, apellido: true } } },
      orderBy: { created_at: 'desc' }
    });
    res.json(seguimientos);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener seguimientos', detail: error.message });
  }
};

export const createCotizacionSeguimiento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tipo, destinatario, resumen, resultado, proxima_accion, responsable, fecha_proximo_seguimiento } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });

    if (!resumen) {
      return res.status(400).json({ error: 'El resumen del seguimiento es obligatorio.' });
    }

    const seguimiento = await prisma.cotizacionSeguimiento.create({
      data: {
        cotizacion_id: id,
        usuario_id: userId,
        tipo: tipo || 'llamada',
        destinatario: destinatario || 'cliente',
        resumen,
        resultado: resultado || null,
        proxima_accion: proxima_accion || null,
        responsable: responsable || null,
        fecha_proximo_seguimiento: fecha_proximo_seguimiento ? new Date(fecha_proximo_seguimiento) : null
      },
      include: {
        usuario: { select: { nombre: true, apellido: true } }
      }
    });

    if (userId) {
      await logAudit(userId, 'CREATE_SEGUIMIENTO', 'CotizacionSeguimiento', seguimiento.id, { tipo, resumen });
    }

    res.status(201).json(seguimiento);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al registrar seguimiento', detail: error.message });
  }
};

export const updateParticipacionPravia = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { monto } = req.body;
    const actorUserId = req.user?.id;
    if (!actorUserId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });

    const cotizacion = await prisma.cotizacion.findUnique({
      where: { id },
      include: { versiones: { orderBy: { version: 'desc' }, take: 1 } }
    });

    if (!cotizacion) return res.status(404).json({ error: 'Cotización no encontrada' });

    const praviaMontoVal = Number(monto || 0);

    // Update Cotizacion
    const updatedCotizacion = await prisma.cotizacion.update({
      where: { id },
      data: {
        honorarios_pravia: praviaMontoVal
      }
    });

    // Update latest version if exists
    if (cotizacion.versiones.length > 0) {
      await prisma.cotizacionVersion.update({
        where: { id: cotizacion.versiones[0].id },
        data: {
          honorarios_pravia: praviaMontoVal
        }
      });
    }

    await logAudit(actorUserId, 'UPDATE_PRAVIA_PARTICIPATION', 'Cotizacion', id, { monto: praviaMontoVal });

    res.json(updatedCotizacion);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al actualizar participación PRAVIA', detail: error.message });
  }
};

// GET DOCUMENTOS DE COTIZACIÓN (HEREDA PROSPECTO SIN DUPLICAR)
export const getCotizacionDocumentos = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cotizacion = await prisma.cotizacion.findUnique({
      where: { id },
      select: { id: true, prospecto_id: true }
    });

    if (!cotizacion) {
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }

    const [cDocs, cVinculos, pDocs, pVinculos] = await Promise.all([
      prisma.documento.findMany({ where: { cotizacion_id: id }, include: { subido_por: { select: { nombre: true } } } }),
      prisma.cotizacionDocumento.findMany({ where: { cotizacion_id: id, estatus: 'ACTIVO' }, include: { documento: { include: { subido_por: { select: { nombre: true } } } } } }),
      cotizacion.prospecto_id ? prisma.documento.findMany({ where: { prospecto_id: cotizacion.prospecto_id }, include: { subido_por: { select: { nombre: true } } } }) : [],
      cotizacion.prospecto_id ? prisma.prospectoDocumento.findMany({ where: { prospecto_id: cotizacion.prospecto_id, estatus: 'ACTIVO' }, include: { documento: { include: { subido_por: { select: { nombre: true } } } } } }) : []
    ]);

    const resultDocsMap = new Map<string, any>();

    // 1. Add Prospecto documents tagged as 'PROSPECTO'
    pDocs.forEach(d => {
      resultDocsMap.set(d.id, {
        ...d,
        origen_modulo: 'PROSPECTO',
        origen_etiqueta: 'Prospecto'
      });
    });

    pVinculos.forEach(v => {
      if (v.documento && !resultDocsMap.has(v.documento.id)) {
        resultDocsMap.set(v.documento.id, {
          ...v.documento,
          origen_modulo: 'PROSPECTO',
          origen_etiqueta: 'Prospecto'
        });
      }
    });

    // 2. Add Cotización documents tagged as 'COTIZACION' (overriding or appending)
    cDocs.forEach(d => {
      resultDocsMap.set(d.id, {
        ...d,
        origen_modulo: resultDocsMap.has(d.id) ? 'PROSPECTO' : 'COTIZACION',
        origen_etiqueta: resultDocsMap.has(d.id) ? 'Prospecto' : 'Cotización'
      });
    });

    cVinculos.forEach(v => {
      if (v.documento) {
        resultDocsMap.set(v.documento.id, {
          ...v.documento,
          origen_modulo: resultDocsMap.has(v.documento.id) ? 'PROSPECTO' : 'COTIZACION',
          origen_etiqueta: resultDocsMap.has(v.documento.id) ? 'Prospecto' : 'Cotización'
        });
      }
    });

    const docs = Array.from(resultDocsMap.values());
    res.json(docs);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al consultar documentos de cotización', detail: error.message });
  }
};

// DESVINCULAR DOCUMENTO DE COTIZACIÓN (SIN BORRAR DEL PROSPECTO NI STORAGE)
export const unlinkCotizacionDocumento = async (req: Request, res: Response) => {
  try {
    const { id, documentoId } = req.params;

    // Desvincular de tabla junction CotizacionDocumento
    await prisma.cotizacionDocumento.updateMany({
      where: { cotizacion_id: id, documento_id: documentoId },
      data: { estatus: 'INACTIVO', inactivado_at: new Date(), inactivado_por_id: req.user?.id }
    });

    // Desvincular cotizacion_id directo si existe
    await prisma.documento.updateMany({
      where: { id: documentoId, cotizacion_id: id },
      data: { cotizacion_id: null }
    });

    res.json({ message: 'Documento desvinculado de la cotización exitosamente' });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al desvincular documento de cotización', detail: error.message });
  }
};
