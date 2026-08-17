import { Request, Response } from 'express';
import { ProspectoEstado, ProspectoPrioridad } from '@prisma/client';
import prisma from '../config/prisma';
import { parseProspectListQuery } from '../domain/prospectQuery';
import {
  DEFAULT_PROSPECT_OPERATIONAL_STAGE,
  normalizeProspectName,
  PROSPECT_OPERATIONAL_STAGES,
  PROSPECT_SERVICES,
  prospectServiceByCode,
  prospectStageByCode,
} from '../domain/prospectCatalog';
import { prospectoObjectWhere } from '../services/objectAccess.service';
import { logAudit } from '../utils/auditLogger';

const prospectInclude = {
  atendido_por: { select: { nombre: true } },
  etapa_operativa: true,
  servicio_catalogo: true,
  documentos: { select: { id: true } },
  cotizacion: { select: { id: true, estado: true } },
  seguimientos: { orderBy: { created_at: 'desc' as const }, take: 1 },
};

const optionalString = (value: unknown) => {
  if (value === undefined) return undefined;
  const normalized = String(value ?? '').trim();
  return normalized || null;
};

const booleanValue = (value: unknown, fallback?: boolean) => {
  if (value === undefined && fallback !== undefined) return fallback;
  return typeof value === 'boolean' ? value : undefined;
};

const invalidBoolean = (value: unknown) => value !== undefined && typeof value !== 'boolean';
const closedStates = new Set<ProspectoEstado>([
  ProspectoEstado.ACEPTADO,
  ProspectoEstado.PERDIDO,
  ProspectoEstado.CANCELADO,
  ProspectoEstado.ARCHIVADO,
]);

export const getProspectCatalogs = async (_req: Request, res: Response) => res.json({
  stages: PROSPECT_OPERATIONAL_STAGES,
  services: PROSPECT_SERVICES,
});

export const getProspectos = async (req: Request, res: Response) => {
  try {
    const parsed = parseProspectListQuery(req.query as Record<string, unknown>);
    const service = parsed.serviceCode ? prospectServiceByCode(parsed.serviceCode) : undefined;
    const stage = parsed.operationalStageCode ? prospectStageByCode(parsed.operationalStageCode) : undefined;
    if (parsed.serviceCode && !service) return res.status(400).json({ error: 'El servicio seleccionado no es válido.', code: 'INVALID_PROSPECT_SERVICE' });
    if (parsed.operationalStageCode && !stage) return res.status(400).json({ error: 'La etapa seleccionada no es válida.', code: 'INVALID_PROSPECT_STAGE' });

    const scope = { archived_at: null, ...(req.user ? prospectoObjectWhere(req.user) : {}) };
    const where: any = { ...scope };
    const and: any[] = [];
    if (parsed.substatuses.length === 1) where.estado = parsed.substatuses[0];
    else if (parsed.substatuses.length > 1) where.estado = { in: parsed.substatuses };
    if (parsed.priorities.length === 1) where.prioridad = parsed.priorities[0];
    else if (parsed.priorities.length > 1) where.prioridad = { in: parsed.priorities };
    if (service) {
      and.push({ OR: [
        { servicio_catalogo_codigo: service.code },
        { servicio_catalogo_codigo: null, tipo_acto: { equals: service.label, mode: 'insensitive' } },
      ] });
    }
    if (stage) where.etapa_operativa_codigo = stage.code;
    if (parsed.source) where.fuente = { equals: parsed.source, mode: 'insensitive' };
    if (parsed.withoutQuote) where.cotizacion = { is: null };
    if (parsed.search) {
      and.push({ OR: [
        ...(parsed.exactId ? [{ id: parsed.exactId }] : []),
        { nombre: { contains: parsed.search, mode: 'insensitive' } },
        { telefono: { contains: parsed.search, mode: 'insensitive' } },
        { email: { contains: parsed.search, mode: 'insensitive' } },
        { tipo_acto: { contains: parsed.search, mode: 'insensitive' } },
        { servicio_catalogo: { is: { label: { contains: parsed.search, mode: 'insensitive' } } } },
      ] });
    }
    if (and.length) where.AND = and;

    const prospectos = await prisma.prospecto.findMany({
      where,
      ...(parsed.paginated ? { skip: parsed.skip, take: parsed.pageSize } : {}),
      include: prospectInclude,
      orderBy: { [parsed.sortBy]: parsed.sortOrder },
    });
    if (!parsed.paginated) return res.json(prospectos);

    const total = await prisma.prospecto.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / parsed.pageSize));
    if (!parsed.includeSummary) {
      return res.json({
        data: prospectos,
        meta: {
          page: parsed.page,
          pageSize: parsed.pageSize,
          total,
          totalPages,
          hasNextPage: parsed.page < totalPages,
          hasPreviousPage: parsed.page > 1,
          countsByState: {},
          metrics: { withQuote: 0, accepted: 0, active: 0 },
        },
        facets: { services: [], sources: [] },
      });
    }

    const [withQuote, stateCounts, legacyServices, sources] = await Promise.all([
      prisma.prospecto.count({ where: { ...where, cotizacion: { isNot: null } } }),
      prisma.prospecto.groupBy({ by: ['estado'], where, _count: { _all: true } }),
      prisma.prospecto.findMany({ where: scope, distinct: ['tipo_acto'], select: { tipo_acto: true }, orderBy: { tipo_acto: 'asc' } }),
      prisma.prospecto.findMany({ where: scope, distinct: ['fuente'], select: { fuente: true }, orderBy: { fuente: 'asc' } }),
    ]);
    return res.json({
      data: prospectos,
      meta: {
        page: parsed.page,
        pageSize: parsed.pageSize,
        total,
        totalPages,
        hasNextPage: parsed.page < totalPages,
        hasPreviousPage: parsed.page > 1,
        countsByState: Object.fromEntries(stateCounts.map((item) => [item.estado, item._count._all])),
        metrics: {
          withQuote,
          accepted: stateCounts.find((item) => item.estado === ProspectoEstado.ACEPTADO)?._count._all ?? 0,
          active: stateCounts.filter((item) => !closedStates.has(item.estado)).reduce((sum, item) => sum + item._count._all, 0),
        },
      },
      facets: {
        services: legacyServices.map((item) => item.tipo_acto).filter(Boolean),
        sources: sources.map((item) => item.fuente).filter(Boolean),
      },
    });
  } catch (error: any) {
    console.error('Error fetching prospectos:', error);
    return res.status(500).json({ error: 'Error al obtener prospectos', detail: error?.message || String(error) });
  }
};

export const createProspecto = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
    const raw = req.body ?? {};
    const nombre = normalizeProspectName(raw.nombre);
    if (!nombre) return res.status(400).json({ error: 'El campo "nombre" es obligatorio.', code: 'PROSPECT_NAME_REQUIRED' });
    const service = prospectServiceByCode(raw.servicio_catalogo_codigo);
    if (!service) return res.status(400).json({ error: 'Selecciona un servicio válido.', code: 'INVALID_PROSPECT_SERVICE' });
    const stage = raw.etapa_operativa_codigo === undefined
      ? DEFAULT_PROSPECT_OPERATIONAL_STAGE
      : prospectStageByCode(raw.etapa_operativa_codigo);
    if (!stage) return res.status(400).json({ error: 'Selecciona una etapa válida.', code: 'INVALID_PROSPECT_STAGE' });
    if (invalidBoolean(raw.tiene_predial) || invalidBoolean(raw.tiene_antecedente)) {
      return res.status(400).json({ error: 'Los indicadores de documentación deben ser verdaderos o falsos.', code: 'INVALID_PROSPECT_DOCUMENT_FLAGS' });
    }
    if (raw.prioridad && !Object.values(ProspectoPrioridad).includes(raw.prioridad)) {
      return res.status(400).json({ error: 'La prioridad seleccionada no es válida.', code: 'INVALID_PROSPECT_PRIORITY' });
    }

    const prospecto = await prisma.prospecto.create({
      data: {
        nombre,
        telefono: optionalString(raw.telefono),
        email: optionalString(raw.email),
        necesidad: optionalString(raw.necesidad),
        prioridad: raw.prioridad || ProspectoPrioridad.MEDIA,
        estado: ProspectoEstado.NUEVO,
        tiene_predial: booleanValue(raw.tiene_predial, false),
        tiene_antecedente: booleanValue(raw.tiene_antecedente, false),
        etapa_operativa_codigo: stage.code,
        servicio_catalogo_codigo: service.code,
        tipo_acto: service.label,
        user_id: userId,
      },
      include: prospectInclude,
    });

    await logAudit(userId, 'CREATE', 'Prospecto', prospecto.id, {
      nombre: prospecto.nombre,
      servicio_catalogo_codigo: service.code,
      etapa_operativa_codigo: stage.code,
      tiene_predial: prospecto.tiene_predial,
      tiene_antecedente: prospecto.tiene_antecedente,
    });
    return res.status(201).json(prospecto);
  } catch (error: any) {
    console.error('Error creating prospecto:', error);
    return res.status(500).json({ error: 'Error al crear el prospecto', detail: error?.message || String(error) });
  }
};

export const getProspectoById = async (req: Request, res: Response) => {
  try {
    const prospecto = await prisma.prospecto.findUnique({
      where: { id: req.params.id },
      include: {
        atendido_por: { select: { nombre: true, id: true } },
        etapa_operativa: true,
        servicio_catalogo: true,
        seguimientos: { include: { usuario: { select: { nombre: true } } }, orderBy: { created_at: 'desc' } },
        cotizacion: true,
      },
    });
    if (!prospecto) return res.status(404).json({ error: 'Prospecto no encontrado' });
    return res.json(prospecto);
  } catch (error: any) {
    return res.status(500).json({ error: 'Error al obtener el prospecto', detail: error?.message });
  }
};

export const updateProspecto = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
    const raw = req.body ?? {};
    const cleanData: any = {};

    if (raw.nombre !== undefined) {
      cleanData.nombre = normalizeProspectName(raw.nombre);
      if (!cleanData.nombre) return res.status(400).json({ error: 'El campo "nombre" es obligatorio.', code: 'PROSPECT_NAME_REQUIRED' });
    }
    for (const field of ['telefono', 'email', 'necesidad'] as const) {
      if (raw[field] !== undefined) cleanData[field] = optionalString(raw[field]);
    }
    if (raw.prioridad !== undefined) {
      if (!Object.values(ProspectoPrioridad).includes(raw.prioridad)) return res.status(400).json({ error: 'La prioridad seleccionada no es válida.', code: 'INVALID_PROSPECT_PRIORITY' });
      cleanData.prioridad = raw.prioridad;
    }
    if (raw.estado !== undefined) {
      if (!Object.values(ProspectoEstado).includes(raw.estado)) return res.status(400).json({ error: 'El estado comercial no es válido.', code: 'INVALID_PROSPECT_PIPELINE_STATUS' });
      cleanData.estado = raw.estado;
    }
    if (raw.servicio_catalogo_codigo !== undefined) {
      const service = prospectServiceByCode(raw.servicio_catalogo_codigo);
      if (!service) return res.status(400).json({ error: 'Selecciona un servicio válido.', code: 'INVALID_PROSPECT_SERVICE' });
      cleanData.servicio_catalogo_codigo = service.code;
      cleanData.tipo_acto = service.label;
    }
    if (raw.etapa_operativa_codigo !== undefined) {
      const stage = prospectStageByCode(raw.etapa_operativa_codigo);
      if (!stage) return res.status(400).json({ error: 'Selecciona una etapa válida.', code: 'INVALID_PROSPECT_STAGE' });
      cleanData.etapa_operativa_codigo = stage.code;
    }
    for (const field of ['tiene_predial', 'tiene_antecedente'] as const) {
      if (raw[field] !== undefined) {
        if (invalidBoolean(raw[field])) return res.status(400).json({ error: 'Los indicadores de documentación deben ser verdaderos o falsos.', code: 'INVALID_PROSPECT_DOCUMENT_FLAGS' });
        cleanData[field] = raw[field];
      }
    }

    const prospecto = await prisma.prospecto.update({ where: { id: req.params.id }, data: cleanData, include: prospectInclude });
    await logAudit(userId, 'UPDATE', 'Prospecto', prospecto.id, { changes: cleanData });
    return res.json(prospecto);
  } catch (error: any) {
    return res.status(500).json({ error: 'Error al actualizar el prospecto', detail: error?.message });
  }
};

export const deleteProspecto = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
    const prospecto = await prisma.prospecto.update({
      where: { id: req.params.id },
      data: {
        archived_at: new Date(), archived_by: userId,
        motivo_archivo: req.body.motivo || 'Archivado por el usuario', estado: ProspectoEstado.ARCHIVADO,
      },
    });
    await logAudit(userId, 'ARCHIVE', 'Prospecto', prospecto.id, { motivo: req.body.motivo });
    return res.json({ success: true, prospecto });
  } catch (error: any) {
    return res.status(500).json({ error: 'Error al archivar el prospecto', detail: error?.message });
  }
};

export const addSeguimiento = async (req: Request, res: Response) => {
  try {
    const { tipo, contenido, proxima_accion, fecha_proximo_seguimiento } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
    if (!tipo || !contenido) return res.status(400).json({ error: 'Los campos "tipo" y "contenido" son obligatorios.' });
    const seguimiento = await prisma.prospectoSeguimiento.create({
      data: {
        prospecto_id: req.params.id, usuario_id: userId, tipo, contenido,
        proxima_accion: proxima_accion || null,
        fecha_proximo_seguimiento: fecha_proximo_seguimiento ? new Date(fecha_proximo_seguimiento) : null,
      },
      include: { usuario: { select: { nombre: true } } },
    });
    await logAudit(userId, 'ADD_SEGUIMIENTO', 'Prospecto', req.params.id, { seguimiento_id: seguimiento.id });
    return res.status(201).json(seguimiento);
  } catch (error: any) {
    return res.status(500).json({ error: 'Error al agregar seguimiento', detail: error?.message });
  }
};
