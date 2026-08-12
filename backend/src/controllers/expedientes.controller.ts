import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { ExpedienteEstatus, TipoMovimiento, NaturalezaMovimiento, DocEstatus, DocCategoria, Prisma, TareaExternaEstatus, TipoTareaExterna } from '@prisma/client';
import { ExpedienteWorkflowService, TransicionPayload } from '../services/expedienteWorkflow.service';
import { calculateExpedienteProgress } from '../services/expedienteProgress.service';
import { downloadFile, uploadFile, deleteFile } from '../services/supabase.service';
import prisma from '../config/prisma';
import { CotizacionConversionService } from '../services/cotizacionConversion.service';
import { CotizacionBusinessError } from '../domain/cotizacionWorkflow';
import {
  EXPEDIENTE_STATUS_LABELS,
  ExpedienteWorkflowError,
  getAllowedExpedienteTransitions,
} from '../domain/expedienteWorkflow';
import {
  FinancialLedgerError,
  normalizeFinancialCategory,
  validateMovementSemantics,
} from '../domain/financialLedger';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { reserveExpedienteFolio } from '../services/expedienteFolio.service';
import { canAccessCotizacion } from '../services/objectAccess.service';

const cotizacionConversionService = new CotizacionConversionService(prisma);

async function assertRequestExpedienteScope(req: Request, expedienteId: string) {
  if (!req.user) throw new ExpedienteUpdateError('Inicia sesión para continuar.', 'AUTH_REQUIRED', 401);
  const scoped = await prisma.expediente.findFirst({
    where: { id: expedienteId, archived_at: null, ...expedienteAccessWhere(req.user) },
    select: { id: true, estatus: true, version: true },
  });
  if (!scoped) throw new ExpedienteUpdateError('No tienes acceso a este expediente.', 'EXPEDIENTE_ACCESS_DENIED', 403);
  return scoped;
}

async function resolveNextFrozenStage(expedienteId: string, target: ExpedienteEstatus) {
  const current = await prisma.expediente.findUnique({
    where: { id: expedienteId },
    select: { flujoVersion: { select: { etapas_json: true } }, etapaActual: { select: { orden_snapshot: true } } },
  });
  const stages = Array.isArray(current?.flujoVersion?.etapas_json)
    ? current.flujoVersion.etapas_json as Array<Record<string, any>>
    : [];
  const stage = stages
    .filter((candidate) => String(candidate.estado || candidate.estado_general_relacionado || '') === target
      && Number(candidate.orden || 0) > (current?.etapaActual?.orden_snapshot || 0))
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0))[0];
  return stage?.clave ? String(stage.clave) : undefined;
}

function parseOperationalDate(value: unknown, label: string, required = false) {
  if (!value && !required) return undefined;
  const parsed = new Date(String(value || ''));
  if (Number.isNaN(parsed.getTime())) throw new ExpedienteUpdateError(`${label} no es válida.`, 'EXPEDIENTE_DATE_INVALID');
  return parsed;
}

class ExpedienteUpdateError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// 1. Listar Expedientes con Filtros y Paginación
export const getExpedientes = async (req: Request, res: Response) => {
  try {
    const { estatus, abogado_id, tipo_acto_id, search, limit = 50, page = 1 } = req.query;

    const where: any = {
      archived_at: null,
      AND: req.user ? [expedienteAccessWhere(req.user)] : [],
    };

    if (estatus) {
      where.estatus = estatus as ExpedienteEstatus;
    }

    if (abogado_id) {
      where.abogado_id = String(abogado_id);
    }

    if (tipo_acto_id) {
      where.tipo_acto_id = String(tipo_acto_id);
    }

    if (search) {
      const searchStr = String(search).trim();
      where.AND.push({ OR: [
        { numero_pravia: { contains: searchStr, mode: 'insensitive' } },
        { numero_notaria: { contains: searchStr, mode: 'insensitive' } },
        { cliente_alias: { contains: searchStr, mode: 'insensitive' } }
      ] });
    }

    const take = Number(limit);
    const skip = (Number(page) - 1) * take;

    const [expedientes, total] = await Promise.all([
      prisma.expediente.findMany({
        where,
        take,
        skip,
        orderBy: { updated_at: 'desc' },
        include: {
          tipo_acto: { select: { id: true, nombre: true } },
          abogado: { select: { id: true, nombre: true, apellido: true } },
          etapaActual: { select: { id: true, nombre_snapshot: true, fecha_inicio: true } },
          _count: {
            select: {
              comparecientes: true,
              requisitos_docs: true,
              movimientosFinancieros: true
            }
          }
        }
      }),
      prisma.expediente.count({ where })
    ]);

    const canReadFinance = req.user?.permissions.includes('finanzas.read');
    const operationalRole = req.user && ['RECEPCION', 'GESTORIA'].includes(req.user.rol);
    res.json({
      data: expedientes.map((item) => operationalRole ? {
        id: item.id,
        numero_pravia: item.numero_pravia,
        numero_notaria: item.numero_notaria,
        cliente_alias: item.cliente_alias,
        estatus: item.estatus,
        version: item.version,
        etapa_actual_nombre: item.etapa_actual_nombre,
        proxima_accion: item.proxima_accion,
        fecha_limite_accion: item.fecha_limite_accion,
        updated_at: item.updated_at,
        tipo_acto: item.tipo_acto,
        etapaActual: item.etapaActual,
        requisitos_count: item._count.requisitos_docs,
      } : canReadFinance ? item : { ...item, valor_operacion: null, _count: { ...item._count, movimientosFinancieros: 0 } }),
      meta: {
        total,
        page: Number(page),
        limit: take,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al listar expedientes', detail: error.message });
  }
};

// 2. Obtener Detalle Completo de Expediente
export const getExpedienteById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const expediente = await prisma.expediente.findUnique({
      where: { id },
      include: {
        tipo_acto: true,
        flujoVersion: true,
        abogado: { select: { id: true, nombre: true, apellido: true, email: true } },
        gestor: { select: { id: true, nombre: true, apellido: true } },
        creador: { select: { id: true, nombre: true, apellido: true } },
        notaria: true,
        cotizacion: {
          include: {
            versiones: true,
            prospecto: true
          }
        },
        etapaActual: true,
        etapas: { orderBy: { orden_snapshot: 'asc' } },
        comparecientes: {
          include: {
            compareciente: {
              include: {
                personaFisica: true,
                personaMoral: true
              }
            },
            caracter: true
          }
        },
        requisitos_docs: {
          include: {
            documentoVinculos: {
              include: { documento: true }
            }
          }
        },
        expedienteDocumentos: {
          where: { estatus: 'ACTIVO' },
          include: { documento: true }
        },
        movimientosFinancieros: {
          where: { estatus: { notIn: ['CANCELADO', 'REVERTIDO'] } },
          orderBy: { fecha_movimiento: 'desc' },
          include: {
            capturado_por: { select: { id: true, nombre: true, apellido: true } },
            validado_por: { select: { id: true, nombre: true, apellido: true } },
            movimientoDocumentos: {
              where: { estatus: 'ACTIVO' },
              include: { documento: true },
              orderBy: { fecha_vinculo: 'desc' },
            },
          }
        },
        actividades: {
          take: 20,
          orderBy: { created_at: 'desc' },
          include: { usuario: { select: { id: true, nombre: true, apellido: true } } }
        },
        tareas: {
          where: { estatus: { not: 'CANCELADA' } },
          include: { asignado_a: { select: { id: true, nombre: true, apellido: true } } }
        },
        tareas_externas: { orderBy: { updated_at: 'desc' } },
        entrega: true,
      }
    });

    if (!expediente) {
      return res.status(404).json({ error: 'Expediente no encontrado' });
    }

    const currentStageOrder = expediente.etapaActual?.orden_snapshot || 0;
    const frozenStages = Array.isArray(expediente.flujoVersion?.etapas_json)
      ? expediente.flujoVersion.etapas_json as Array<Record<string, any>>
      : [];
    const workflowStages = frozenStages
      .map((stage) => ({
        clave: String(stage.clave || ''),
        nombre: String(stage.nombre || ''),
        orden: Number(stage.orden || 0),
        obligatoria: stage.obligatoria !== false,
        se_puede_omitir: stage.se_puede_omitir === true,
        duracion_esperada_dias: Number(stage.duracion ?? stage.duracion_esperada_dias ?? 0) || null,
        estado_general_relacionado: String(stage.estado || stage.estado_general_relacionado || ''),
      }))
      .sort((a, b) => a.orden - b.orden);
    const allowedStatuses = getAllowedExpedienteTransitions(expediente.estatus);
    const transitions = allowedStatuses.map((status) => ({
      status,
      label: EXPEDIENTE_STATUS_LABELS[status],
      stage: workflowStages.find((stage) => stage.estado_general_relacionado === status && stage.orden > currentStageOrder) || null,
      requires_signature_data: status === 'FIRMA_PROGRAMADA',
      requires_effective_date: status === 'FIRMADO' || status === 'ENTREGADO',
      requires_notes: status === 'ENTREGADO' || status === 'CANCELADO' || status === 'SUSPENDIDO',
    }));
    const nextStage = workflowStages.find(
      (stage) => stage.estado_general_relacionado === expediente.estatus && stage.orden > currentStageOrder,
    ) || null;

    const canReadFinance = req.user?.permissions.includes('finanzas.read');
    const progress = await calculateExpedienteProgress(id);
    if (req.user && ['RECEPCION', 'GESTORIA'].includes(req.user.rol)) {
      const isReception = req.user.rol === 'RECEPCION';
      const permittedTransitions = transitions.filter((item) => isReception
        ? item.status === 'ENTREGADO'
        : ['POST_FIRMA', 'LISTO_ENTREGA'].includes(item.status));
      return res.json({
        id: expediente.id,
        numero_pravia: expediente.numero_pravia,
        numero_notaria: expediente.numero_notaria,
        cliente_alias: expediente.cliente_alias,
        estatus: expediente.estatus,
        version: expediente.version,
        etapa_actual_nombre: expediente.etapa_actual_nombre,
        proxima_accion: expediente.proxima_accion,
        fecha_limite_accion: expediente.fecha_limite_accion,
        updated_at: expediente.updated_at,
        tipo_acto: { id: expediente.tipo_acto.id, nombre: expediente.tipo_acto.nombre },
        notaria: isReception || !expediente.notaria ? null : {
          id: expediente.notaria.id,
          nombre: expediente.notaria.nombre,
          numero_notaria: expediente.notaria.numero_notaria,
          contacto_principal: expediente.notaria.contacto_principal,
          telefono: expediente.notaria.telefono,
        },
        requisitos_docs: expediente.requisitos_docs.map((item) => ({
          id: item.id, nombre: item.nombre, categoria: item.categoria, obligatorio: item.obligatorio, estatus: item.estatus,
        })),
        documentos_autorizados: expediente.expedienteDocumentos.map((link) => ({
          id: link.documento.id,
          nombre: link.documento.nombre_original,
          tipo: link.documento.tipo,
          categoria: link.documento.categoria,
          estatus: link.documento.estatus,
          tipo_vinculo: link.tipo_vinculo,
        })),
        tareas_postfirma: isReception ? [] : expediente.tareas_externas,
        entrega: expediente.entrega,
        workflow: {
          current_status_label: EXPEDIENTE_STATUS_LABELS[expediente.estatus],
          transitions: permittedTransitions,
          next_stage: nextStage,
        },
        progress: { documental: progress.documental, operativo: progress.operativo, general: progress.general },
      });
    }
    res.json({
      ...expediente,
      ...(canReadFinance ? {} : { valor_operacion: null, movimientosFinancieros: [], financial_access: false }),
      workflow: {
        current_status_label: EXPEDIENTE_STATUS_LABELS[expediente.estatus],
        transitions,
        next_stage: nextStage,
        stages: workflowStages,
      },
      progress,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener detalle del expediente', detail: error.message });
  }
};

// 3. Creación Directa de Expediente
export const createExpediente = async (req: Request, res: Response) => {
  try {
    const {
      tipo_acto_id,
      abogado_id,
      cliente_alias,
      descripcion,
      valor_operacion,
      notaria_id,
      datos_operacion
    } = req.body;

    const creador_id = req.user?.id;
    if (!creador_id) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
    const assignedLawyerId = req.user?.rol === 'ABOGADO' ? req.user.id : abogado_id;

    if (!tipo_acto_id || !assignedLawyerId || !cliente_alias) {
      return res.status(400).json({ error: 'Campos obligatorios requeridos: tipo_acto_id, abogado_id, cliente_alias' });
    }

    // Buscar versiones vigentes del TipoActo
    const [tipoActo, formVer, flujoVer, plantDocVer] = await Promise.all([
      prisma.tipoActo.findUnique({ where: { id: tipo_acto_id } }),
      prisma.formularioVersion.findFirst({ where: { tipo_acto_id }, orderBy: { version: 'desc' } }),
      prisma.flujoVersion.findFirst({ where: { tipo_acto_id }, orderBy: { version: 'desc' } }),
      prisma.plantillaDocumentalVersion.findFirst({ where: { tipo_acto_id }, orderBy: { version: 'desc' } })
    ]);

    if (!tipoActo) {
      return res.status(404).json({ error: 'TipoActo no encontrado' });
    }

    const expediente = await prisma.$transaction(async (tx) => {
      const numero_pravia = await reserveExpedienteFolio(tx);
      const exp = await tx.expediente.create({
        data: {
          numero_pravia,
          tipo_acto_id,
          formulario_version_id: formVer?.id,
          flujo_version_id: flujoVer?.id,
          plantilla_doc_version_id: plantDocVer?.id,
          abogado_id: assignedLawyerId,
          creador_id,
          cliente_alias,
          descripcion,
          valor_operacion: valor_operacion ? Number(valor_operacion) : null,
          notaria_id,
          datos_operacion,
          estatus: 'ABIERTO'
        }
      });

      // Crear primera etapa del flujo si existe versión
      if (flujoVer && Array.isArray(flujoVer.etapas_json) && flujoVer.etapas_json.length > 0) {
        const primera = (flujoVer.etapas_json as any[])[0];
        const etapaInstancia = await tx.expedienteEtapa.create({
          data: {
            expediente_id: exp.id,
            flujo_version_id: flujoVer.id,
            clave_snapshot: primera.clave,
            nombre_snapshot: primera.nombre,
            orden_snapshot: primera.orden || 1,
            duracion_esperada_snapshot: primera.dias || 3,
            responsable_id: assignedLawyerId
          }
        });

        await tx.expediente.update({
          where: { id: exp.id },
          data: {
            expediente_etapa_actual_id: etapaInstancia.id,
            etapa_actual_nombre: primera.nombre
          }
        });
      }

      // Crear requisitos documentales iniciales si existen
      if (plantDocVer && Array.isArray(plantDocVer.requisitos_json)) {
        for (const reqItem of (plantDocVer.requisitos_json as any[])) {
          await tx.expedienteRequisitoDoc.create({
            data: {
              expediente_id: exp.id,
              nombre: reqItem.nombre,
              categoria: reqItem.categoria || 'PROYECTO',
              obligatorio: reqItem.obligatorio ?? true
            }
          });
        }
      }

      // Registrar Actividad
      await tx.expedienteActividad.create({
        data: {
          expediente_id: exp.id,
          usuario_id: creador_id,
          tipo: 'CAMBIO_ESTATUS',
          titulo: 'Apertura de Expediente',
          descripcion: `Expediente aperturado exitosamente con folio ${exp.numero_pravia}`
        }
      });

      return exp;
    });

    res.status(201).json(expediente);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al crear expediente', detail: error.message });
  }
};

// 4. Conversión de Cotización Aceptada a Expediente
export const convertCotizacionToExpediente = async (req: Request, res: Response) => {
  try {
    const { cotizacion_id, abogado_id, tipo_acto_id } = req.body;
    if (!req.user || !(await canAccessCotizacion(req.user, String(cotizacion_id)))) {
      return res.status(403).json({ error: 'No tienes acceso a esta cotización.', code: 'COTIZACION_ACCESS_DENIED' });
    }
    const result = await cotizacionConversionService.convert({
      cotizacionId: cotizacion_id,
      abogadoId: abogado_id,
      tipoActoId: tipo_acto_id,
      actorUserId: req.user?.id,
      correlationId: (req as any).correlationId,
    });
    res.status(result.alreadyConverted ? 200 : 201).json({
      ...result.expediente,
      idempotent: result.alreadyConverted,
      correlation_id: result.correlationId,
      anticipo_validado: result.validatedAdvanceTotal,
    });
  } catch (error: any) {
    console.error('[CONVERT_COTIZACION_ERROR]', error);
    if (error instanceof CotizacionBusinessError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    res.status(500).json({ error: 'No fue posible convertir la cotización a expediente.', code: 'CONVERSION_FAILED' });
  }
};

// 5. Transición de Estado con Control de Concurrencia Optimista
export const transitionEstatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { expected_version, nuevo_estatus, nueva_etapa_clave, notas, datos_firma, fecha_efectiva } = req.body;
    const actor_user_id = req.user?.id;

    if (!actor_user_id) {
      return res.status(401).json({ error: 'Usuario no autenticado en la sesión' });
    }

    if (expected_version === undefined || (!nuevo_estatus && !nueva_etapa_clave)) {
      return res.status(400).json({ error: 'Campos requeridos: expected_version y un nuevo estado o etapa' });
    }

    const current = await prisma.expediente.findUnique({
      where: { id },
      select: {
        tipo_acto_id: true,
        estatus: true,
        flujoVersion: { select: { etapas_json: true } },
        etapaActual: { select: { orden_snapshot: true } },
      }
    });
    if (!current) return res.status(404).json({ error: 'Expediente no encontrado' });

    let resolvedStageKey = nueva_etapa_clave || undefined;
    const shouldResolveStage = nuevo_estatus && (
      nuevo_estatus === 'EN_INTEGRACION'
      || (current.estatus === 'EN_INTEGRACION' && nuevo_estatus === 'EN_PROCESO')
      || ['PENDIENTE_NOTARIA', 'FIRMA_PROGRAMADA', 'FIRMADO', 'POST_FIRMA', 'ENTREGADO'].includes(nuevo_estatus)
    );
    if (!resolvedStageKey && shouldResolveStage) {
      const frozenStages = Array.isArray(current.flujoVersion?.etapas_json)
        ? current.flujoVersion.etapas_json as Array<Record<string, any>>
        : [];
      const stage = frozenStages
        .filter((candidate) =>
          String(candidate.estado || candidate.estado_general_relacionado || '') === nuevo_estatus
          && Number(candidate.orden || 0) > (current.etapaActual?.orden_snapshot || 0),
        )
        .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0))[0];
      resolvedStageKey = stage?.clave ? String(stage.clave) : undefined;
    }

    let signatureData: TransicionPayload['datosFirma'];
    if (datos_firma) {
      const signatureDate = new Date(datos_firma.fecha_firma);
      if (Number.isNaN(signatureDate.getTime())) {
        return res.status(400).json({ error: 'La fecha de firma no es válida.' });
      }
      signatureData = {
        fechaFirma: signatureDate,
        lugar: String(datos_firma.lugar || '').trim(),
        autorizaSaldoPendiente: Boolean(datos_firma.autoriza_saldo_pendiente),
      };
    }
    let effectiveDate: Date | undefined;
    if (fecha_efectiva) {
      effectiveDate = new Date(fecha_efectiva);
      if (Number.isNaN(effectiveDate.getTime())) return res.status(400).json({ error: 'La fecha efectiva no es válida.' });
      if (effectiveDate.getTime() > Date.now() + 5 * 60_000) {
        return res.status(400).json({ error: 'La fecha efectiva de un hecho concluido no puede estar en el futuro.' });
      }
    }

    const workflowService = new ExpedienteWorkflowService(prisma);
    const expedienteActualizado = await workflowService.ejecutarTransicion({
      expedienteId: id,
      versionActual: Number(expected_version),
      nuevoEstatus: nuevo_estatus as ExpedienteEstatus,
      nuevaEtapaClave: resolvedStageKey,
      actorUserId: actor_user_id,
      observaciones: notas,
      datosFirma: signatureData,
      fechaEfectiva: effectiveDate,
    });

    res.json(expedienteActualizado);
  } catch (error: any) {
    const statusCode = error instanceof ExpedienteWorkflowError
      ? error.status
      : error.message?.includes('[409 CONFLICT]')
        ? 409
        : error.message?.includes('no válido')
          ? 401
          : 400;
    res.status(statusCode).json({ error: error.message, code: error.code || 'EXPEDIENTE_TRANSITION_FAILED' });
  }
};

export const registerFinalDelivery = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const scoped = await assertRequestExpedienteScope(req, id);
    if (scoped.estatus !== 'LISTO_ENTREGA') {
      return res.status(409).json({ error: 'El expediente debe estar listo para entrega.', code: 'EXPEDIENTE_DELIVERY_STATE_INVALID' });
    }
    const {
      expected_version, receptor_nombre, receptor_caracter, fecha_efectiva, medio,
      items, evidencia_documento_id, observaciones,
    } = req.body;
    if (expected_version === undefined) return res.status(400).json({ error: 'Indica la versión actual del expediente.', code: 'EXPEDIENTE_VERSION_REQUIRED' });
    const effectiveDate = parseOperationalDate(fecha_efectiva, 'La fecha efectiva', true)!;
    const stageKey = await resolveNextFrozenStage(id, 'ENTREGADO');
    const result = await new ExpedienteWorkflowService(prisma).ejecutarTransicion({
      expedienteId: id,
      versionActual: Number(expected_version),
      nuevoEstatus: 'ENTREGADO',
      nuevaEtapaClave: stageKey,
      actorUserId: req.user!.id,
      fechaEfectiva: effectiveDate,
      observaciones,
      entrega: {
        receptor_nombre: String(receptor_nombre || ''),
        receptor_caracter: String(receptor_caracter || ''),
        fecha_efectiva: effectiveDate,
        medio: String(medio || ''),
        evidencia_documento_id: String(evidencia_documento_id || ''),
        items: Array.isArray(items) ? items.map((item) => ({
          documento_id: String(item?.documento_id || ''),
          tipo: String(item?.tipo || '').toUpperCase(),
          cantidad: Number(item?.cantidad),
        })) as any : [],
        observaciones: typeof observaciones === 'string' ? observaciones : undefined,
      },
    });
    return res.status(201).json(result);
  } catch (error: any) {
    const status = error instanceof ExpedienteWorkflowError || error instanceof ExpedienteUpdateError ? error.status : 400;
    return res.status(status).json({ error: error.message, code: error.code || 'EXPEDIENTE_DELIVERY_FAILED' });
  }
};

export const createPostfirmaTask = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const scoped = await assertRequestExpedienteScope(req, id);
    if (!['FIRMADO', 'POST_FIRMA'].includes(scoped.estatus)) {
      return res.status(409).json({ error: 'Los trámites externos solo se administran durante postfirma.', code: 'EXPEDIENTE_POSTFIRMA_STATE_INVALID' });
    }
    const { tipo, descripcion, institucion, folio, fecha_ingreso, fecha_limite, seguimiento, prevencion, subsanacion, notas, evidencia_documento_id } = req.body;
    if (!Object.values(TipoTareaExterna).includes(tipo) || !String(descripcion || '').trim() || !String(institucion || '').trim()) {
      return res.status(400).json({ error: 'Completa el tipo, la descripción y la institución del trámite.', code: 'EXPEDIENTE_POSTFIRMA_DATA_REQUIRED' });
    }
    if (evidencia_documento_id) {
      const evidence = await prisma.expedienteDocumento.findFirst({ where: { expediente_id: id, documento_id: String(evidencia_documento_id), estatus: 'ACTIVO' }, select: { id: true } });
      if (!evidence) return res.status(400).json({ error: 'La evidencia seleccionada no pertenece al expediente.', code: 'EXPEDIENTE_POSTFIRMA_EVIDENCE_INVALID' });
    }
    const task = await prisma.tareaExterna.create({ data: {
      expediente_id: id,
      tipo,
      descripcion: String(descripcion).trim(),
      institucion: String(institucion).trim(),
      folio: String(folio || '').trim() || null,
      fecha_ingreso: parseOperationalDate(fecha_ingreso, 'La fecha de ingreso'),
      fecha_inicio: new Date(),
      fecha_limite: parseOperationalDate(fecha_limite, 'La fecha límite'),
      seguimiento: String(seguimiento || '').trim() || null,
      prevencion: String(prevencion || '').trim() || null,
      subsanacion: String(subsanacion || '').trim() || null,
      notas: String(notas || '').trim() || null,
      evidencia_documento_id: evidencia_documento_id ? String(evidencia_documento_id) : null,
      gestionado_por_id: req.user!.id,
    } });
    return res.status(201).json(task);
  } catch (error: any) {
    const status = error instanceof ExpedienteUpdateError ? error.status : 400;
    return res.status(status).json({ error: error.message, code: error.code || 'EXPEDIENTE_POSTFIRMA_CREATE_FAILED' });
  }
};

export const updatePostfirmaTask = async (req: Request, res: Response) => {
  try {
    const { id, taskId } = req.params;
    const scoped = await assertRequestExpedienteScope(req, id);
    if (!['FIRMADO', 'POST_FIRMA'].includes(scoped.estatus)) {
      return res.status(409).json({ error: 'Este expediente ya no admite cambios en sus trámites postfirma.', code: 'EXPEDIENTE_POSTFIRMA_STATE_INVALID' });
    }
    const existing = await prisma.tareaExterna.findFirst({ where: { id: taskId, expediente_id: id } });
    if (!existing) return res.status(404).json({ error: 'Trámite no encontrado.', code: 'EXPEDIENTE_POSTFIRMA_TASK_NOT_FOUND' });
    const status = req.body.estatus ? String(req.body.estatus).toUpperCase() as TareaExternaEstatus : existing.estatus;
    if (!Object.values(TareaExternaEstatus).includes(status)) return res.status(400).json({ error: 'Selecciona un estado de trámite válido.', code: 'EXPEDIENTE_POSTFIRMA_STATUS_INVALID' });
    if (req.body.evidencia_documento_id) {
      const evidence = await prisma.expedienteDocumento.findFirst({ where: { expediente_id: id, documento_id: String(req.body.evidencia_documento_id), estatus: 'ACTIVO' }, select: { id: true } });
      if (!evidence) return res.status(400).json({ error: 'La evidencia seleccionada no pertenece al expediente.', code: 'EXPEDIENTE_POSTFIRMA_EVIDENCE_INVALID' });
    }
    const resultText = String(req.body.resultado ?? existing.resultado ?? '').trim();
    const evidenceId = req.body.evidencia_documento_id ?? existing.evidencia_documento_id;
    if (status === 'COMPLETADA' && (!resultText || !evidenceId)) {
      return res.status(400).json({ error: 'Para concluir el trámite registra el resultado y una evidencia.', code: 'EXPEDIENTE_POSTFIRMA_CLOSE_DATA_REQUIRED' });
    }
    const task = await prisma.tareaExterna.update({ where: { id: taskId }, data: {
      estatus: status,
      folio: req.body.folio !== undefined ? String(req.body.folio).trim() || null : undefined,
      fecha_ingreso: req.body.fecha_ingreso !== undefined ? parseOperationalDate(req.body.fecha_ingreso, 'La fecha de ingreso') : undefined,
      fecha_limite: req.body.fecha_limite !== undefined ? parseOperationalDate(req.body.fecha_limite, 'La fecha límite') : undefined,
      seguimiento: req.body.seguimiento !== undefined ? String(req.body.seguimiento).trim() || null : undefined,
      prevencion: req.body.prevencion !== undefined ? String(req.body.prevencion).trim() || null : undefined,
      subsanacion: req.body.subsanacion !== undefined ? String(req.body.subsanacion).trim() || null : undefined,
      resultado: req.body.resultado !== undefined ? resultText || null : undefined,
      notas: req.body.notas !== undefined ? String(req.body.notas).trim() || null : undefined,
      evidencia_documento_id: req.body.evidencia_documento_id !== undefined ? String(req.body.evidencia_documento_id) : undefined,
      fecha_completada: status === 'COMPLETADA' ? existing.fecha_completada || new Date() : null,
      gestionado_por_id: req.user!.id,
    } });
    return res.json(task);
  } catch (error: any) {
    const status = error instanceof ExpedienteUpdateError ? error.status : 400;
    return res.status(status).json({ error: error.message, code: error.code || 'EXPEDIENTE_POSTFIRMA_UPDATE_FAILED' });
  }
};

export const transitionPostfirma = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await assertRequestExpedienteScope(req, id);
    const target = String(req.body.nuevo_estatus || '').toUpperCase() as ExpedienteEstatus;
    if (!['POST_FIRMA', 'LISTO_ENTREGA'].includes(target)) return res.status(400).json({ error: 'Selecciona un avance válido de postfirma.', code: 'EXPEDIENTE_POSTFIRMA_TARGET_INVALID' });
    if (req.body.expected_version === undefined) return res.status(400).json({ error: 'Indica la versión actual del expediente.', code: 'EXPEDIENTE_VERSION_REQUIRED' });
    const stageKey = await resolveNextFrozenStage(id, target);
    const result = await new ExpedienteWorkflowService(prisma).ejecutarTransicion({
      expedienteId: id,
      versionActual: Number(req.body.expected_version),
      nuevoEstatus: target,
      nuevaEtapaClave: stageKey,
      actorUserId: req.user!.id,
      observaciones: typeof req.body.observaciones === 'string' ? req.body.observaciones : undefined,
    });
    return res.json(result);
  } catch (error: any) {
    const status = error instanceof ExpedienteWorkflowError || error instanceof ExpedienteUpdateError ? error.status : 400;
    return res.status(status).json({ error: error.message, code: error.code || 'EXPEDIENTE_POSTFIRMA_TRANSITION_FAILED' });
  }
};

// Helper de normalización de TipoMovimiento Prisma Enum
function normalizarTipoMovimiento(tipo?: string): TipoMovimiento {
  const t = (tipo || '').toUpperCase().trim();
  if (['ANTICIPO', 'ADVANCE'].includes(t)) return 'ANTICIPO';
  if (['ABONO', 'PAGO_PARCIAL', 'PARCIAL'].includes(t)) return 'ABONO';
  if (['PAGO_UNICO', 'UNICO'].includes(t)) return 'PAGO_UNICO';
  if (['PAGO_CONTRA_FIRMA', 'CONTRA_FIRMA', 'FIRMA', 'LIQUIDACION', 'LIQUIDACION_FINAL'].includes(t)) return 'PAGO_CONTRA_FIRMA';
  if (['PAGO_CONTRA_ENTREGA', 'CONTRA_ENTREGA', 'ENTREGA'].includes(t)) return 'PAGO_CONTRA_ENTREGA';
  if (['DEVOLUCION', 'REFUND'].includes(t)) return 'DEVOLUCION';
  if (['EGRESO_NOTARIA', 'NOTARIA', 'PAGO_NOTARIA'].includes(t)) return 'EGRESO_NOTARIA';
  if (['EGRESO_TERCEROS', 'TERCEROS', 'DERECHOS'].includes(t)) return 'EGRESO_TERCEROS';
  if (['AJUSTE'].includes(t)) return 'AJUSTE';
  throw new FinancialLedgerError('Selecciona un tipo de movimiento financiero válido.', 'FINANCIAL_TYPE_INVALID');
}

function normalizarNaturaleza(nat?: string): NaturalezaMovimiento {
  const n = (nat || '').toUpperCase().trim();
  if (n === 'EGRESO') return 'EGRESO';
  if (n === 'INGRESO') return 'INGRESO';
  throw new FinancialLedgerError('Selecciona si el movimiento es ingreso o egreso.', 'FINANCIAL_NATURE_INVALID');
}

async function resolveActiveFinancialActor(req: Request) {
  const actorId = req.user?.id;
  if (!actorId) return null;
  return prisma.user.findFirst({ where: { id: actorId, activo: true }, select: { id: true } });
}

// 6. Registrar Movimiento Financiero
export const addMovimientoFinanciero = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tipo_movimiento, naturaleza, categoria, concepto, monto, forma_pago, referencia, fecha_movimiento } = req.body;
    const actor = await resolveActiveFinancialActor(req);
    if (!actor) return res.status(401).json({ error: 'Se requiere un usuario activo para registrar el movimiento.' });

    if (!tipo_movimiento || !naturaleza || !concepto || !monto) {
      return res.status(400).json({ error: 'Campos requeridos: tipo_movimiento, naturaleza, concepto, monto' });
    }

    const normTipo = normalizarTipoMovimiento(tipo_movimiento);
    const normNat = normalizarNaturaleza(naturaleza);
    const normalizedCategory = normalizeFinancialCategory(categoria);
    const numericAmount = Number(monto);
    const movementDate = fecha_movimiento ? new Date(`${fecha_movimiento}T12:00:00`) : new Date();
    if (Number.isNaN(movementDate.getTime())) {
      return res.status(400).json({ error: 'La fecha del movimiento no es válida.' });
    }
    validateMovementSemantics({
      tipo: normTipo,
      naturaleza: normNat,
      categoria: normalizedCategory,
      monto: numericAmount,
    });
    const cleanConcept = String(concepto).trim();
    const cleanReference = typeof referencia === 'object' ? JSON.stringify(referencia) : String(referencia || '').trim() || null;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:movimiento:${id}`}))`);
      const expediente = await tx.expediente.findFirst({ where: { id, archived_at: null }, select: { id: true } });
      if (!expediente) throw new FinancialLedgerError('Expediente activo no encontrado.', 'EXPEDIENTE_NOT_FOUND', 404);

      const recentDuplicate = await tx.movimientoFinanciero.findFirst({
        where: {
          expediente_id: id,
          naturaleza: normNat,
          categoria: normalizedCategory,
          concepto: cleanConcept,
          monto: numericAmount,
          referencia: cleanReference,
          fecha_validacion: { gte: new Date(Date.now() - 10_000) },
        },
      });
      if (recentDuplicate) return { movimiento: recentDuplicate, idempotent: true };

      const estatus = normNat === 'INGRESO' ? 'RECIBIDO' : 'VALIDADO';
      const movimiento = await tx.movimientoFinanciero.create({
        data: {
          expediente_id: id,
          tipo_movimiento: normTipo,
          naturaleza: normNat,
          categoria: normalizedCategory,
          concepto: cleanConcept,
          monto: numericAmount,
          fecha_movimiento: movementDate,
          forma_pago: String(forma_pago || 'TRANSFERENCIA').trim(),
          referencia: cleanReference,
          capturado_por_id: actor.id,
          validado_por_id: actor.id,
          fecha_validacion: new Date(),
          estatus,
        },
      });
      await tx.expedienteActividad.create({
        data: {
          expediente_id: id,
          tipo: 'PAGO',
          titulo: `${normNat === 'INGRESO' ? 'Ingreso recibido' : 'Egreso validado'} (${normalizedCategory})`,
          descripcion: `${cleanConcept}: $${numericAmount.toFixed(2)} MXN`,
          usuario_id: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          user_id: actor.id,
          accion: 'CREATE_FINANCIAL_MOVEMENT',
          entidad: 'MovimientoFinanciero',
          entidad_id: movimiento.id,
          valores_nuevos: { expediente_id: id, tipo_movimiento: normTipo, naturaleza: normNat, categoria: normalizedCategory, monto: numericAmount, estatus },
          correlation_id: (req as any).correlationId,
        },
      });
      return { movimiento, idempotent: false };
    });

    await calculateExpedienteProgress(id);
    res.status(result.idempotent ? 200 : 201).json({ ...result.movimiento, idempotent: result.idempotent });
  } catch (error: any) {
    console.error('[addMovimientoFinanciero] Error:', error);
    const status = error instanceof FinancialLedgerError ? error.status : 500;
    res.status(status).json({
      error: 'Error al registrar movimiento financiero',
      detail: error.message,
      code: error.code || 'PRISMA_ERROR'
    });
  }
};

// 7. Reverso de Movimiento Financiero
export const reverseMovimientoFinanciero = async (req: Request, res: Response) => {
  try {
    const { id, movimientoId } = req.params;
    const { motivo_reversion } = req.body;

    if (!motivo_reversion || typeof motivo_reversion !== 'string' || !motivo_reversion.trim()) {
      return res.status(400).json({ error: 'El motivo de reverso es obligatorio' });
    }

    const actor = await resolveActiveFinancialActor(req);
    if (!actor) return res.status(401).json({ error: 'Se requiere un usuario activo para revertir el movimiento.' });

    const reverso = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:movimiento-reverso:${movimientoId}`}))`);
      const original = await tx.movimientoFinanciero.findFirst({ where: { id: movimientoId, expediente_id: id } });
      if (!original) throw new FinancialLedgerError('Movimiento original no encontrado.', 'MOVEMENT_NOT_FOUND', 404);
      if (!['VALIDADO', 'RECIBIDO'].includes(original.estatus)) {
        throw new FinancialLedgerError('Solo se pueden revertir movimientos activos y validados.', 'MOVEMENT_NOT_REVERSIBLE');
      }
      if (original.categoria === 'REVERSO' || original.movimiento_origen_id) {
        throw new FinancialLedgerError('Un contramovimiento técnico no puede volver a revertirse.', 'TECHNICAL_REVERSE_NOT_REVERSIBLE');
      }
      const priorReverse = await tx.movimientoFinanciero.findFirst({ where: { movimiento_origen_id: original.id } });
      if (priorReverse) throw new FinancialLedgerError('Este movimiento ya tiene un reverso registrado.', 'MOVEMENT_ALREADY_REVERSED', 409);

      const rev = await tx.movimientoFinanciero.create({
        data: {
          expediente_id: id,
          tipo_movimiento: 'DEVOLUCION',
          naturaleza: original.naturaleza === 'INGRESO' ? 'EGRESO' : 'INGRESO',
          categoria: 'REVERSO',
          concepto: `Reverso de: ${original.concepto}`,
          monto: original.monto,
          capturado_por_id: actor.id,
          validado_por_id: actor.id,
          fecha_validacion: new Date(),
          estatus: 'VALIDADO',
          movimiento_origen_id: original.id,
          motivo_reversion,
          revertido_por_id: actor.id,
          fecha_reversion: new Date()
        }
      });

      // Marcar original como REVERTIDO
      await tx.movimientoFinanciero.update({
        where: { id: original.id },
        data: { estatus: 'REVERTIDO', motivo_reversion: motivo_reversion.trim(), revertido_por_id: actor.id, fecha_reversion: new Date() }
      });

      // Bitácora de actividad
      await tx.expedienteActividad.create({
        data: {
          expediente_id: id,
          tipo: 'AUDITORIA',
          titulo: `Movimiento Financiero Revertido ($${original.monto})`,
          descripcion: `Motivo: ${motivo_reversion}`,
          usuario_id: actor.id
        }
      });
      await tx.auditLog.create({
        data: {
          user_id: actor.id,
          accion: 'REVERSE_FINANCIAL_MOVEMENT',
          entidad: 'MovimientoFinanciero',
          entidad_id: original.id,
          valores_anteriores: { estatus: original.estatus, monto: Number(original.monto), naturaleza: original.naturaleza },
          valores_nuevos: { estatus: 'REVERTIDO', reverso_id: rev.id, motivo: motivo_reversion.trim() },
          correlation_id: (req as any).correlationId,
        },
      });

      return rev;
    });

    await calculateExpedienteProgress(id);

    res.json(reverso);
  } catch (error: any) {
    const status = error instanceof FinancialLedgerError ? error.status : 500;
    res.status(status).json({ error: 'Error al revertir movimiento financiero', detail: error.message, code: error.code });
  }
};

// 8. Archivar / Borrado Lógico de Expediente
export const archiveExpediente = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { motivo_archivo } = req.body;
    const archived_by = (req as any).user?.id;

    const expediente = await prisma.expediente.update({
      where: { id },
      data: {
        archived_at: new Date(),
        archived_by,
        motivo_archivo
      }
    });

    res.json({ message: 'Expediente archivado exitosamente', expediente });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al archivar expediente', detail: error.message });
  }
};

// 9. Actualización de Campos de Ficha General y Presupuesto Operativo
export const updateExpedienteHeader = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      cliente_alias,
      tipo_acto_id,
      tipo_acto_nombre,
      abogado_id,
      notaria_id,
      numero_escritura,
      budget_items,
      honorarios_pravia,
      version: expectedVersion,
    } = req.body;
    const cleanAlias = cliente_alias === undefined ? undefined : String(cliente_alias).trim();
    const cleanAbogadoId = abogado_id === undefined ? undefined : String(abogado_id).trim();
    const cleanNotariaId = notaria_id === undefined ? undefined : (notaria_id ? String(notaria_id).trim() : null);
    const cleanNumeroEscritura = numero_escritura === undefined ? undefined : String(numero_escritura).trim();

    if (cleanAlias !== undefined && cleanAlias.length === 0) {
      throw new ExpedienteUpdateError('El alias o identificación del expediente no puede quedar vacío.', 'EXPEDIENTE_ALIAS_REQUIRED');
    }
    if (cleanAbogadoId !== undefined && cleanAbogadoId.length === 0) {
      throw new ExpedienteUpdateError('Selecciona un abogado activo para el expediente.', 'EXPEDIENTE_LAWYER_REQUIRED');
    }

    const validatedBudget = Array.isArray(budget_items)
      ? budget_items.map((item: any, index: number) => {
          const concepto = String(item?.concepto || '').trim();
          const monto = Number(item?.monto);
          if (!concepto) {
            throw new ExpedienteUpdateError(`El rubro ${index + 1} requiere un nombre.`, 'INVALID_BUDGET_ITEM');
          }
          if (!Number.isFinite(monto) || monto < 0) {
            throw new ExpedienteUpdateError(`El monto de "${concepto}" debe ser un número mayor o igual a cero.`, 'INVALID_BUDGET_AMOUNT');
          }
          return { id: item?.id || `rubro_${index + 1}`, concepto, monto };
        })
      : undefined;
    const praviaAmount = honorarios_pravia === undefined ? undefined : Number(honorarios_pravia);
    if (praviaAmount !== undefined && (!Number.isFinite(praviaAmount) || praviaAmount < 0)) {
      throw new ExpedienteUpdateError('La participación PRAVIA debe ser un importe válido mayor o igual a cero.', 'INVALID_PRAVIA_AMOUNT');
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:expediente-update:${id}`}))`);
      const currentExp = await tx.expediente.findUnique({ where: { id } });
      if (!currentExp) throw new ExpedienteUpdateError('Expediente no encontrado.', 'EXPEDIENTE_NOT_FOUND', 404);
      if (expectedVersion !== undefined && Number(expectedVersion) !== currentExp.version) {
        throw new ExpedienteUpdateError(
          'El expediente cambió en otra sesión. Recarga la información antes de volver a guardar.',
          'EXPEDIENTE_VERSION_CONFLICT',
          409,
        );
      }

      let cleanTipoActoId = tipo_acto_id ? String(tipo_acto_id).trim() : undefined;
      if (!cleanTipoActoId && tipo_acto_nombre !== undefined) {
        const matchingTipo = await tx.tipoActo.findFirst({
          where: { activo: true, nombre: { equals: String(tipo_acto_nombre).trim(), mode: 'insensitive' } },
        });
        if (!matchingTipo) {
          throw new ExpedienteUpdateError('El tipo de acto seleccionado no existe o está inactivo.', 'EXPEDIENTE_ACT_TYPE_INVALID');
        }
        cleanTipoActoId = matchingTipo.id;
      }
      if (cleanTipoActoId) {
        const validType = await tx.tipoActo.findFirst({ where: { id: cleanTipoActoId, activo: true }, select: { id: true } });
        if (!validType) throw new ExpedienteUpdateError('El tipo de acto seleccionado no existe o está inactivo.', 'EXPEDIENTE_ACT_TYPE_INVALID');
      }
      if (cleanAbogadoId !== undefined) {
        const lawyer = await tx.user.findFirst({ where: { id: cleanAbogadoId, activo: true }, select: { id: true } });
        if (!lawyer) throw new ExpedienteUpdateError('El abogado seleccionado no existe o está inactivo.', 'EXPEDIENTE_LAWYER_INVALID');
      }
      if (cleanNotariaId) {
        const notary = await tx.notaria.findFirst({ where: { id: cleanNotariaId, activa: true }, select: { id: true } });
        if (!notary) throw new ExpedienteUpdateError('La notaría seleccionada no existe o está inactiva.', 'EXPEDIENTE_NOTARY_INVALID');
      }

      const actorId = req.user?.id;
      if (!actorId) throw new ExpedienteUpdateError('Tu sesión no es válida.', 'AUTH_REQUIRED', 401);
      const actor = await tx.user.findFirst({ where: { id: actorId, activo: true }, select: { id: true } });
      if (!actor) throw new ExpedienteUpdateError('No existe un usuario activo para registrar el cambio.', 'EXPEDIENTE_ACTOR_INVALID', 403);

      const currentDatos = (currentExp.datos_operacion as Record<string, any> | null) || {};
      const newDatos: Record<string, any> = { ...currentDatos };
      if (cleanNumeroEscritura !== undefined) newDatos.numero_escritura = cleanNumeroEscritura || null;

      if (validatedBudget !== undefined) {
        const totalNotaria = validatedBudget.reduce((sum, item) => sum + item.monto, 0);
        const totalPravia = praviaAmount ?? Number((currentDatos.presupuesto as any)?.honorarios_pravia || 0);
        if (totalNotaria > 0 && totalPravia > totalNotaria) {
          throw new ExpedienteUpdateError(
            'La participación PRAVIA no puede exceder el presupuesto notarial.',
            'PRAVIA_AMOUNT_EXCEEDS_BUDGET',
          );
        }
        newDatos.presupuesto = {
          rubros: validatedBudget,
          honorarios_pravia: totalPravia,
          total_notaria: totalNotaria,
          total_cliente: totalNotaria,
        };
      } else if (praviaAmount !== undefined) {
        const currentBudget = (currentDatos.presupuesto as any) || {};
        const totalNotaria = Number(currentBudget.total_notaria || 0);
        if (totalNotaria > 0 && praviaAmount > totalNotaria) {
          throw new ExpedienteUpdateError(
            'La participación PRAVIA no puede exceder el presupuesto notarial.',
            'PRAVIA_AMOUNT_EXCEEDS_BUDGET',
          );
        }
        newDatos.presupuesto = { ...currentBudget, honorarios_pravia: praviaAmount, total_cliente: totalNotaria };
      }

      const changes: string[] = [];
      if (cleanAlias !== undefined && cleanAlias !== currentExp.cliente_alias) changes.push('Alias o identificación');
      if (cleanTipoActoId && cleanTipoActoId !== currentExp.tipo_acto_id) changes.push('Tipo de acto');
      if (cleanAbogadoId !== undefined && cleanAbogadoId !== currentExp.abogado_id) changes.push('Abogado encargado');
      if (cleanNotariaId !== undefined && cleanNotariaId !== currentExp.notaria_id) changes.push('Notaría');
      if (cleanNumeroEscritura !== undefined && cleanNumeroEscritura !== (currentExp.numero_notaria || '')) changes.push('Número de escritura');
      if (validatedBudget !== undefined || praviaAmount !== undefined) changes.push('Presupuesto operativo');

      const expediente = await tx.expediente.update({
        where: { id },
        data: {
          cliente_alias: cleanAlias,
          tipo_acto_id: cleanTipoActoId,
          abogado_id: cleanAbogadoId,
          notaria_id: cleanNotariaId,
          numero_notaria: cleanNumeroEscritura === undefined ? undefined : (cleanNumeroEscritura || null),
          datos_operacion: newDatos,
          version: { increment: 1 },
        },
      });

      if (changes.length > 0) {
        const correlationId = (req as any).correlationId || crypto.randomUUID();
        await tx.expedienteActividad.create({
          data: {
            expediente_id: id,
            tipo: 'AUDITORIA',
            titulo: 'Ficha general y presupuesto actualizados',
            descripcion: changes.join(', '),
            usuario_id: actor.id,
          },
        });
        await tx.auditLog.create({
          data: {
            user_id: actor.id,
            accion: 'UPDATE_HEADER_AND_BUDGET',
            entidad: 'Expediente',
            entidad_id: id,
            valores_anteriores: { version: currentExp.version },
            valores_nuevos: { version: expediente.version, campos: changes },
            correlation_id: correlationId,
          },
        });
      }
      return expediente;
    });

    res.json(updated);
  } catch (error: any) {
    if (error instanceof ExpedienteUpdateError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    res.status(500).json({ error: 'Error al actualizar expediente', detail: error.message });
  }
};

// 10. Agregar/Vincular Documento al Archivo del Expediente (Subida Transaccional con Rollback de Storage)
export const addExpedienteDocumento = async (req: Request, res: Response) => {
  let uploadedStorageKey: string | null = null;
  try {
    const { id } = req.params;
    const file = req.file;
    const { nombre, categoria, carpeta, observaciones } = req.body;
    
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
    }

    const exp = await prisma.expediente.findUnique({ where: { id } });
    if (!exp) {
      return res.status(404).json({ error: 'El expediente especificado no existe' });
    }

    if (!file) {
      return res.status(400).json({
        error: 'Se requiere seleccionar un archivo real.',
        detail: 'No se crearán registros documentales sin contenido binario porque después no pueden visualizarse ni descargarse.'
      });
    }

    const originalName = file.originalname;
    const carpetaTarget = carpeta || 'Administrativo';
    const categoriaTarget = String(categoria || 'PROYECTO').toUpperCase();
    if (!Object.values(DocCategoria).includes(categoriaTarget as DocCategoria)) {
      return res.status(400).json({
        code: 'INVALID_DOCUMENT_CATEGORY',
        error: 'La categoría documental no es válida.',
        allowed_categories: Object.values(DocCategoria),
      });
    }

    // 1. Supabase es el almacenamiento canónico; no duplicar cada carga en disco local.
    const fileBuffer = file.buffer || (file.path && fs.existsSync(file.path) ? fs.readFileSync(file.path) : null);
    if (!fileBuffer) {
      return res.status(400).json({ error: 'No se pudo procesar el contenido del archivo subido.' });
    }

    const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    uploadedStorageKey = `${uniqueSuffix}_${file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;

    try {
      await uploadFile(fileBuffer, uploadedStorageKey, file.mimetype);
    } catch (storageErr: any) {
      return res.status(400).json({
        error: 'Error al subir archivo al almacenamiento.',
        detail: storageErr.message || 'Falla en servicio de almacenamiento Supabase Storage'
      });
    }

    // 2. Ejecutar transacción de Base de Datos
    try {
      const result = await prisma.$transaction(async (tx) => {
        const storageKeyFinal = uploadedStorageKey as string;

        const doc = await tx.documento.create({
          data: {
            nombre_original: originalName,
            nombre_interno: storageKeyFinal,
            storage_key: storageKeyFinal,
            tipo: categoriaTarget,
            categoria: categoriaTarget as DocCategoria,
            mime_type: file.mimetype,
            size_bytes: file.size,
            subido_por_id: userId,
            expediente_id: id,
            estatus: DocEstatus.VIGENTE,
            observaciones: observaciones || `Cargado a carpeta ${carpetaTarget}`
          }
        });

        const expDoc = await tx.expedienteDocumento.create({
          data: {
            expediente_id: id,
            documento_id: doc.id,
            tipo_vinculo: carpetaTarget,
            creado_por_id: userId,
            estatus: 'ACTIVO',
            observaciones: `Categoría: ${categoriaTarget}`
          }
        });

        // Registrar Actividad Documental Auditoría
        await tx.expedienteActividad.create({
          data: {
            expediente_id: id,
            tipo: 'DOCUMENTO',
            titulo: `Documento "${originalName}" Cargado al Archivo`,
            descripcion: `Carpeta: ${carpetaTarget} | Categoría: ${categoriaTarget} | Tamaño: ${(file.size / 1024).toFixed(1)} KB`,
            usuario_id: userId
          }
        });

        return { doc, expDoc };
      });

      return res.status(201).json({
        success: true,
        documento: {
          id: result.doc.id,
          nombre_original: result.doc.nombre_original,
          storage_key: result.doc.storage_key,
          carpeta: result.expDoc.tipo_vinculo,
          estatus: result.doc.estatus,
          expediente_documento_id: result.expDoc.id
        }
      });
    } catch (txError: any) {
      if (uploadedStorageKey) {
        await deleteFile(uploadedStorageKey).catch(() => {});
      }
      return res.status(500).json({
        error: 'No se pudo crear el registro documental.',
        detail: txError.message
      });
    }
  } catch (error: any) {
    if (uploadedStorageKey) {
      await deleteFile(uploadedStorageKey).catch(() => {});
    }
    res.status(500).json({ error: 'No se pudo vincular el documento al expediente.', detail: error.message });
  }
};

// 11. Eliminar Documento del Archivo (Soft Delete / Inactivar con Bitácora y Transacción Segura)
export const deleteExpedienteDocumento = async (req: Request, res: Response) => {
  try {
    const { id, documentoId } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });

    const expDoc = await prisma.expedienteDocumento.findFirst({
      where: {
        expediente_id: id,
        OR: [{ documento_id: documentoId }, { id: documentoId }],
        estatus: 'ACTIVO'
      },
      include: { documento: true }
    });

    if (expDoc) {
      await prisma.$transaction(async (tx) => {
        await tx.expedienteDocumento.update({
          where: { id: expDoc.id },
          data: {
            estatus: 'INACTIVO',
            inactivado_at: new Date(),
            inactivado_por_id: userId
          }
        });

        await tx.expedienteActividad.create({
          data: {
            expediente_id: id,
            tipo: 'DOCUMENTO',
            titulo: `Documento "${expDoc.documento.nombre_original}" Eliminado del Archivo`,
            descripcion: 'Documento retirado de la vista del expediente; el archivo se conserva internamente para auditoría.',
            usuario_id: userId
          }
        });
      });

      return res.json({ success: true, message: 'Documento eliminado exitosamente' });
    }

    // Compatibilidad con requisitos documentales antiguos que se mostraban como archivos.
    const legacyDoc = await prisma.expedienteRequisitoDoc.findFirst({
      where: { id: documentoId, expediente_id: id }
    });
    if (!legacyDoc) return res.status(404).json({ error: 'Documento no encontrado' });

    await prisma.$transaction(async (tx) => {
      await tx.expedienteRequisitoDoc.delete({ where: { id: documentoId } });

      await tx.expedienteActividad.create({
        data: {
          expediente_id: id,
          tipo: 'DOCUMENTO',
          titulo: `Documento "${legacyDoc.nombre}" Eliminado del Archivo`,
          descripcion: 'Registro documental heredado eliminado del expediente',
          usuario_id: userId
        }
      });
    });

    res.json({ success: true, message: 'Documento eliminado exitosamente' });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al eliminar documento', detail: error.message });
  }
};

// 15. Actualizar Documento (Renombrar o Mover a Carpeta)
export const updateExpedienteDocumento = async (req: Request, res: Response) => {
  try {
    const { id, documentoId } = req.params;
    const { nombre, carpeta } = req.body;

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });

    const expDoc = await prisma.expedienteDocumento.findFirst({
      where: {
        expediente_id: id,
        OR: [{ documento_id: documentoId }, { id: documentoId }],
        estatus: 'ACTIVO'
      },
      include: { documento: true }
    });

    if (expDoc) {
      const result = await prisma.$transaction(async (tx) => {
        const updatedDocument = nombre
          ? await tx.documento.update({
              where: { id: expDoc.documento_id },
              data: { nombre_original: nombre }
            })
          : expDoc.documento;

        const updatedLink = carpeta
          ? await tx.expedienteDocumento.update({
              where: { id: expDoc.id },
              data: { tipo_vinculo: carpeta }
            })
          : expDoc;

        if (userId) {
          await tx.expedienteActividad.create({
            data: {
              expediente_id: id,
              tipo: 'DOCUMENTO',
              titulo: `Documento "${expDoc.documento.nombre_original}" Modificado`,
              descripcion: `Nuevo Nombre: "${nombre || expDoc.documento.nombre_original}" | Carpeta: ${carpeta || expDoc.tipo_vinculo}`,
              usuario_id: userId
            }
          });
        }

        return {
          id: updatedDocument.id,
          nombre: updatedDocument.nombre_original,
          carpeta: updatedLink.tipo_vinculo
        };
      });

      return res.json({ success: true, documento: result });
    }

    const doc = await prisma.expedienteRequisitoDoc.findFirst({
      where: { id: documentoId, expediente_id: id }
    });
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    let newObs = doc.observaciones || '';
    if (carpeta) {
      newObs = newObs.replace(/\[Carpeta: .*?\]/, `[Carpeta: ${carpeta}]`);
      if (!newObs.includes('[Carpeta:')) newObs = `[Carpeta: ${carpeta}] ${newObs}`;
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.expedienteRequisitoDoc.update({
        where: { id: documentoId },
        data: {
          nombre: nombre || doc.nombre,
          observaciones: newObs
        }
      });

      if (userId) {
        await tx.expedienteActividad.create({
          data: {
            expediente_id: id,
            tipo: 'DOCUMENTO',
            titulo: `Documento "${doc.nombre}" Modificado`,
            descripcion: `Nuevo Nombre: "${nombre || doc.nombre}" | Carpeta: ${carpeta || 'Sin cambios'}`,
            usuario_id: userId
          }
        });
      }

      return updated;
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al actualizar documento', detail: error.message });
  }
};

// 16. Stream & Download para Documentos del Archivo mediante documentoId único
export const streamExpedienteDocumento = async (req: Request, res: Response) => {
  try {
    const { id, documentoId } = req.params;

    // 1. Validar el vínculo activo en ExpedienteDocumento o consultar Documento maestro
    const expDoc = await prisma.expedienteDocumento.findFirst({
      where: {
        expediente_id: id,
        OR: [{ documento_id: documentoId }, { id: documentoId }],
        estatus: 'ACTIVO'
      },
      include: { documento: true }
    });

    let doc: any = expDoc?.documento;
    if (!doc) {
      doc = await prisma.documento.findFirst({
        where: {
          id: documentoId,
          expediente_id: id,
          expedienteVinculos: { none: { expediente_id: id } }
        }
      });
    }

    if (!doc) {
      return res.status(404).json({ error: 'Documento no encontrado en el archivo del expediente' });
    }

    // 2. Buscar en almacenamiento local (uploads/)
    const docsDir = path.join(__dirname, '../../uploads/documentos');
    
    let filePath = '';
    const candidates = [
      doc.nombre_interno ? path.join(docsDir, path.basename(doc.nombre_interno)) : '',
      doc.storage_key ? path.join(docsDir, path.basename(doc.storage_key)) : ''
    ];

    for (const cand of candidates) {
      if (cand && fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        filePath = cand;
        break;
      }
    }

    const mimeType = doc.mime_type || (doc.nombre_original.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.nombre_original)}"`);

    if (filePath) {
      return fs.createReadStream(filePath).pipe(res);
    }

    // 3. Descargar desde Supabase Storage si no está en disco local
    try {
      const fileBuffer = await downloadFile(doc.storage_key || doc.nombre_interno);
      return res.send(fileBuffer);
    } catch (supaErr) {
      return res.status(404).json({ error: 'El archivo físico no se encuentra en el almacenamiento.' });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Error al visualizar documento', detail: error.message });
  }
};

export const downloadExpedienteDocumento = async (req: Request, res: Response) => {
  try {
    const { id, documentoId } = req.params;

    const expDoc = await prisma.expedienteDocumento.findFirst({
      where: {
        expediente_id: id,
        OR: [{ documento_id: documentoId }, { id: documentoId }],
        estatus: 'ACTIVO'
      },
      include: { documento: true }
    });

    let doc: any = expDoc?.documento;
    if (!doc) {
      doc = await prisma.documento.findFirst({
        where: {
          id: documentoId,
          expediente_id: id,
          expedienteVinculos: { none: { expediente_id: id } }
        }
      });
    }

    if (!doc) {
      return res.status(404).json({ error: 'Documento no encontrado en el archivo del expediente' });
    }

    const docsDir = path.join(__dirname, '../../uploads/documentos');

    let filePath = '';
    const candidates = [
      doc.nombre_interno ? path.join(docsDir, path.basename(doc.nombre_interno)) : '',
      doc.storage_key ? path.join(docsDir, path.basename(doc.storage_key)) : ''
    ];

    for (const cand of candidates) {
      if (cand && fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        filePath = cand;
        break;
      }
    }

    if (filePath) {
      return res.download(filePath, doc.nombre_original);
    }

    try {
      const fileBuffer = await downloadFile(doc.storage_key || doc.nombre_interno);
      res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.nombre_original)}"`);
      return res.send(fileBuffer);
    } catch (supaErr) {
      return res.status(404).json({ error: 'No fue posible descargar el archivo del almacenamiento.' });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'No fue posible descargar el archivo', detail: error.message });
  }
};

// 12. Administrar Adjuntos Específicos por Movimiento (Comprobante, Factura PDF, Factura XML)
export const updateMovimientoAdjunto = async (req: Request, res: Response) => {
  try {
    const { id, movimientoId } = req.params;
    const { tipo_adjunto, accion } = req.body;

    if (accion !== 'ARCHIVAR') {
      return res.status(400).json({
        error: 'Acción no válida',
        detail: 'Los adjuntos solo pueden archivarse o sustituirse; nunca se eliminan físicamente.'
      });
    }
    if (!['COMPROBANTE', 'FACTURA_PDF', 'FACTURA_XML'].includes(tipo_adjunto)) {
      return res.status(400).json({ error: 'Tipo de adjunto no válido' });
    }
    const actor = await resolveActiveFinancialActor(req);
    if (!actor) return res.status(401).json({ error: 'Se requiere un usuario activo para archivar el adjunto.' });

    const mov = await prisma.movimientoFinanciero.findFirst({
      where: { id: movimientoId, expediente_id: id }
    });

    if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });

    let currentRefData: any = {};
    try {
      if (mov.referencia && mov.referencia.startsWith('{')) {
        currentRefData = JSON.parse(mov.referencia);
      } else if (mov.referencia) {
        currentRefData = { nota: mov.referencia };
      }
    } catch (e) {
      currentRefData = { nota: mov.referencia };
    }

    const updateData: Prisma.MovimientoFinancieroUpdateInput = {};

    if (tipo_adjunto === 'COMPROBANTE') {
      updateData.comprobante_url = null;
      currentRefData.comprobante_nombre = null;
      currentRefData.comprobante_file = null;
      currentRefData.comprobante_mime = null;
      currentRefData.comprobante_size = null;
    } else if (tipo_adjunto === 'FACTURA_PDF') {
      updateData.factura_url = null;
      currentRefData.factura_pdf_nombre = null;
      currentRefData.factura_pdf_file = null;
      currentRefData.factura_pdf_mime = null;
      currentRefData.factura_pdf_size = null;
    } else if (tipo_adjunto === 'FACTURA_XML') {
      currentRefData.factura_xml_url = null;
      currentRefData.factura_xml_nombre = null;
      currentRefData.factura_xml_file = null;
      currentRefData.factura_xml_mime = null;
      currentRefData.factura_xml_size = null;
    }

    updateData.referencia = JSON.stringify(currentRefData);

    const updatedMov = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:movimiento-adjunto:${movimientoId}:${tipo_adjunto}`}))`);
      await tx.movimientoDocumento.updateMany({
        where: { movimiento_id: movimientoId, tipo_vinculo: tipo_adjunto, estatus: 'ACTIVO' },
        data: {
          estatus: 'INACTIVO',
          inactivado_at: new Date(),
          inactivado_por_id: actor.id,
          motivo_inactivacion: 'Archivado desde el expediente',
        },
      });
      const result = await tx.movimientoFinanciero.update({
        where: { id: movimientoId },
        data: updateData
      });

      await tx.expedienteActividad.create({
        data: {
          expediente_id: id,
          tipo: 'DOCUMENTO',
          titulo: `Adjunto financiero archivado (${tipo_adjunto})`,
          descripcion: `El archivo dejó de ser vigente en "${mov.concepto}"; su historial fue conservado.`,
          usuario_id: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          user_id: actor.id,
          accion: 'ARCHIVE_FINANCIAL_ATTACHMENT',
          entidad: 'MovimientoFinanciero',
          entidad_id: movimientoId,
          valores_nuevos: { expediente_id: id, tipo_adjunto, almacenamiento_conservado: true },
          correlation_id: (req as any).correlationId,
        },
      });

      return result;
    });

    res.json({ success: true, movimiento: updatedMov });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al actualizar adjunto financiero', detail: error.message });
  }
};





import multer from 'multer';

// Las cargas del archivo documental se envían directamente a Supabase sin
// crear una segunda copia temporal en uploads/finanzas.
export const uploadDocumentoMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

const FINANZAS_DIR = path.join(__dirname, '../../uploads/finanzas');
if (!fs.existsSync(FINANZAS_DIR)) {
  fs.mkdirSync(FINANZAS_DIR, { recursive: true });
}

export const uploadMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

export const uploadMovimientoAdjuntoFile = async (req: Request, res: Response) => {
  let uploadedStorageKey: string | null = null;
  try {
    const { id, movimientoId } = req.params;
    const { tipo_adjunto } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const actor = await resolveActiveFinancialActor(req);
    if (!actor) return res.status(401).json({ error: 'Se requiere un usuario activo para cargar el adjunto.' });

    const acceptedFiles: Record<string, { mime: string[]; extensions: string[]; documentType: string }> = {
      COMPROBANTE: {
        mime: ['application/pdf', 'image/jpeg', 'image/png'],
        extensions: ['.pdf', '.jpg', '.jpeg', '.png'],
        documentType: 'COMPROBANTE_PAGO',
      },
      FACTURA_PDF: { mime: ['application/pdf'], extensions: ['.pdf'], documentType: 'FACTURA_PDF' },
      FACTURA_XML: {
        mime: ['application/xml', 'text/xml', 'application/octet-stream'],
        extensions: ['.xml'],
        documentType: 'FACTURA_XML',
      },
    };
    const attachmentRule = acceptedFiles[tipo_adjunto];
    const extension = path.extname(file.originalname).toLowerCase();
    if (!attachmentRule || !attachmentRule.extensions.includes(extension) || !attachmentRule.mime.includes(file.mimetype)) {
      return res.status(400).json({ error: 'El tipo o formato del archivo no es válido para este adjunto.' });
    }

    const mov = await prisma.movimientoFinanciero.findFirst({
      where: { id: movimientoId, expediente_id: id }
    });
    if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });

    let currentRefData: any = {};
    try {
      if (mov.referencia && mov.referencia.startsWith('{')) {
        currentRefData = JSON.parse(mov.referencia);
      } else if (mov.referencia) {
        currentRefData = { nota: mov.referencia };
      }
    } catch (e) {
      currentRefData = { nota: mov.referencia };
    }

    const cleanName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    uploadedStorageKey = `finanzas/${id}/${movimientoId}/${Date.now()}_${cleanName}`;
    await uploadFile(file.buffer, uploadedStorageKey, file.mimetype);

    const updateData: Prisma.MovimientoFinancieroUpdateInput = {};
    let accionDesc = '';

    if (tipo_adjunto === 'COMPROBANTE') {
      updateData.comprobante_url = uploadedStorageKey;
      currentRefData.comprobante_nombre = file.originalname;
      currentRefData.comprobante_file = uploadedStorageKey;
      currentRefData.comprobante_mime = file.mimetype;
      currentRefData.comprobante_size = file.size;
      accionDesc = `Cargado/Sustituido Comprobante de Pago (${file.originalname})`;
    } else if (tipo_adjunto === 'FACTURA_PDF') {
      updateData.factura_url = uploadedStorageKey;
      currentRefData.factura_pdf_nombre = file.originalname;
      currentRefData.factura_pdf_file = uploadedStorageKey;
      currentRefData.factura_pdf_mime = file.mimetype;
      currentRefData.factura_pdf_size = file.size;
      accionDesc = `Cargada/Sustituida Factura PDF (${file.originalname})`;
    } else if (tipo_adjunto === 'FACTURA_XML') {
      currentRefData.factura_xml_nombre = file.originalname;
      currentRefData.factura_xml_file = uploadedStorageKey;
      currentRefData.factura_xml_url = uploadedStorageKey;
      currentRefData.factura_xml_mime = file.mimetype || 'application/xml';
      currentRefData.factura_xml_size = file.size;
      accionDesc = `Cargada/Sustituida Factura XML (${file.originalname})`;
    } else {
      await deleteFile(uploadedStorageKey).catch(() => {});
      return res.status(400).json({ error: 'Tipo de adjunto no válido' });
    }

    updateData.referencia = JSON.stringify(currentRefData);

    const updatedMov = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:movimiento-adjunto:${movimientoId}:${tipo_adjunto}`}))`);
      await tx.movimientoDocumento.updateMany({
        where: { movimiento_id: movimientoId, tipo_vinculo: tipo_adjunto, estatus: 'ACTIVO' },
        data: {
          estatus: 'SUSTITUIDO',
          inactivado_at: new Date(),
          inactivado_por_id: actor.id,
          motivo_inactivacion: `Sustituido por ${file.originalname}`,
        },
      });
      const document = await tx.documento.create({
        data: {
          nombre_original: file.originalname,
          nombre_interno: uploadedStorageKey!,
          tipo: attachmentRule.documentType,
          categoria: 'OTROS',
          storage_key: uploadedStorageKey!,
          mime_type: file.mimetype,
          size_bytes: file.size,
          estatus: 'VIGENTE',
          subido_por_id: actor.id,
          expediente_id: id,
          observaciones: `Adjunto ${tipo_adjunto} del movimiento ${movimientoId}`,
        },
      });
      await tx.movimientoDocumento.create({
        data: {
          movimiento_id: movimientoId,
          documento_id: document.id,
          tipo_vinculo: tipo_adjunto,
          creado_por_id: actor.id,
          estatus: 'ACTIVO',
          observaciones: accionDesc,
        },
      });
      const result = await tx.movimientoFinanciero.update({
        where: { id: movimientoId },
        data: updateData
      });

      await tx.expedienteActividad.create({
        data: {
          expediente_id: id,
          tipo: 'DOCUMENTO',
          titulo: `Adjunto financiero vigente (${tipo_adjunto})`,
          descripcion: `${accionDesc} en movimiento "${mov.concepto}" ($${mov.monto})`,
          usuario_id: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          user_id: actor.id,
          accion: 'UPLOAD_FINANCIAL_ATTACHMENT',
          entidad: 'Documento',
          entidad_id: document.id,
          valores_nuevos: { movimiento_id: movimientoId, expediente_id: id, tipo_adjunto, storage_key: uploadedStorageKey },
          correlation_id: (req as any).correlationId,
        },
      });

      return result;
    });

    uploadedStorageKey = null;
    res.json(updatedMov);
  } catch (error: any) {
    if (uploadedStorageKey) await deleteFile(uploadedStorageKey).catch(() => {});
    res.status(500).json({ error: 'Error al procesar carga de archivo adjunto', detail: error.message });
  }
};

export const streamMovimientoAdjunto = async (req: Request, res: Response) => {
  try {
    const { id, movimientoId, tipo } = req.params;

    const mov = await prisma.movimientoFinanciero.findFirst({
      where: { id: movimientoId, expediente_id: id }
    });
    if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });

    let refObj: any = {};
    try {
      if (mov.referencia && mov.referencia.startsWith('{')) refObj = JSON.parse(mov.referencia);
    } catch (e) {}

    let targetFilename = '';
    let originalName = '';
    let mimeType = 'application/octet-stream';

    if (tipo === 'COMPROBANTE') {
      targetFilename = refObj.comprobante_file || mov.comprobante_url || '';
      originalName = refObj.comprobante_nombre || 'comprobante_pago.pdf';
      mimeType = refObj.comprobante_mime || (originalName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
    } else if (tipo === 'FACTURA_PDF') {
      targetFilename = refObj.factura_pdf_file || mov.factura_url || '';
      originalName = refObj.factura_pdf_nombre || 'factura.pdf';
      mimeType = 'application/pdf';
    } else if (tipo === 'FACTURA_XML') {
      targetFilename = refObj.factura_xml_file || '';
      originalName = refObj.factura_xml_nombre || 'factura.xml';
      mimeType = 'application/xml; charset=utf-8';
    }

    if (!targetFilename) {
      return res.status(404).json({ error: 'El archivo no se encuentra en el almacenamiento' });
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`);

    const filePath = path.join(FINANZAS_DIR, path.basename(targetFilename));
    if (fs.existsSync(filePath)) return fs.createReadStream(filePath).pipe(res);

    try {
      const fileBuffer = await downloadFile(targetFilename);
      return res.send(fileBuffer);
    } catch (storageError) {
      return res.status(404).json({ error: 'El archivo no se encuentra en el almacenamiento' });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Error al visualizar archivo adjunto', detail: error.message });
  }
};

export const downloadMovimientoAdjunto = async (req: Request, res: Response) => {
  try {
    const { id, movimientoId, tipo } = req.params;

    const mov = await prisma.movimientoFinanciero.findFirst({
      where: { id: movimientoId, expediente_id: id }
    });
    if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });

    let refObj: any = {};
    try {
      if (mov.referencia && mov.referencia.startsWith('{')) refObj = JSON.parse(mov.referencia);
    } catch (e) {}

    let targetFilename = '';
    let originalName = '';

    if (tipo === 'COMPROBANTE') {
      targetFilename = refObj.comprobante_file || mov.comprobante_url || '';
      originalName = refObj.comprobante_nombre || 'comprobante_pago.pdf';
    } else if (tipo === 'FACTURA_PDF') {
      targetFilename = refObj.factura_pdf_file || mov.factura_url || '';
      originalName = refObj.factura_pdf_nombre || 'factura.pdf';
    } else if (tipo === 'FACTURA_XML') {
      targetFilename = refObj.factura_xml_file || '';
      originalName = refObj.factura_xml_nombre || 'factura.xml';
    }

    if (!targetFilename) {
      return res.status(404).json({ error: 'No fue posible descargar el archivo' });
    }

    const filePath = path.join(FINANZAS_DIR, path.basename(targetFilename));
    if (fs.existsSync(filePath)) {
      return res.download(filePath, originalName, (err) => {
        if (err && !res.headersSent) res.status(500).json({ error: 'No fue posible descargar el archivo' });
      });
    }

    try {
      const fileBuffer = await downloadFile(targetFilename);
      res.setHeader('Content-Type', refObj[`${tipo.toLowerCase()}_mime`] || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);
      return res.send(fileBuffer);
    } catch (storageError) {
      return res.status(404).json({ error: 'El archivo no se encuentra en el almacenamiento' });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'No fue posible descargar el archivo', detail: error.message });
  }
};

export const getTiposActo = async (req: Request, res: Response) => {
  try {
    const tipos = await prisma.tipoActo.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' }
    });
    res.json(tipos);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener tipos de acto', detail: error.message });
  }
};
