import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { logAudit } from '../utils/auditLogger';
import { ProspectoEstado } from '@prisma/client';
import { prospectoObjectWhere } from '../services/objectAccess.service';
import { parseProspectListQuery } from '../domain/prospectQuery';

export const getProspectos = async (req: Request, res: Response) => {
  try {
    const parsed = parseProspectListQuery(req.query as Record<string, unknown>);
    const scope = { archived_at: null, ...(req.user ? prospectoObjectWhere(req.user) : {}) };
    const where: any = { ...scope };
    if (parsed.states.length === 1) where.estado = parsed.states[0];
    else if (parsed.states.length > 1) where.estado = { in: parsed.states };
    if (parsed.priorities.length === 1) where.prioridad = parsed.priorities[0];
    else if (parsed.priorities.length > 1) where.prioridad = { in: parsed.priorities };
    if (parsed.service) where.tipo_acto = { equals: parsed.service, mode: 'insensitive' };
    if (parsed.source) where.fuente = { equals: parsed.source, mode: 'insensitive' };
    if (parsed.withoutQuote) where.cotizacion = { is: null };
    if (parsed.search) {
      where.OR = [
        ...(parsed.exactId ? [{ id: parsed.exactId }] : []),
        { nombre: { contains: parsed.search, mode: 'insensitive' } },
        { telefono: { contains: parsed.search, mode: 'insensitive' } },
        { email: { contains: parsed.search, mode: 'insensitive' } },
        { tipo_acto: { contains: parsed.search, mode: 'insensitive' } },
      ];
    }

    const prospectos = await prisma.prospecto.findMany({
      where,
      ...(parsed.paginated ? { skip: parsed.skip, take: parsed.pageSize } : {}),
      include: {
        atendido_por: { select: { nombre: true } },
        documentos: { select: { id: true } },
        cotizacion: { select: { id: true, estado: true } },
        seguimientos: {
          orderBy: { created_at: 'desc' },
          take: 1
        }
      },
      orderBy: { [parsed.sortBy]: parsed.sortOrder }
    });
    if (!parsed.paginated) return res.json(prospectos);

    const [total, withQuote, stateCounts, services, sources] = await Promise.all([
      prisma.prospecto.count({ where }),
      prisma.prospecto.count({ where: { ...where, cotizacion: { isNot: null } } }),
      prisma.prospecto.groupBy({ by: ['estado'], where, _count: { _all: true } }),
      prisma.prospecto.findMany({ where: scope, distinct: ['tipo_acto'], select: { tipo_acto: true }, orderBy: { tipo_acto: 'asc' } }),
      prisma.prospecto.findMany({ where: scope, distinct: ['fuente'], select: { fuente: true }, orderBy: { fuente: 'asc' } }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / parsed.pageSize));
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
          active: stateCounts.filter((item) => !new Set<ProspectoEstado>([ProspectoEstado.ACEPTADO, ProspectoEstado.PERDIDO, ProspectoEstado.CANCELADO, ProspectoEstado.ARCHIVADO]).has(item.estado)).reduce((sum, item) => sum + item._count._all, 0),
        },
      },
      facets: {
        services: services.map((item) => item.tipo_acto).filter(Boolean),
        sources: sources.map((item) => item.fuente).filter(Boolean),
      },
    });
  } catch (error: any) {
    console.error('❌ Error fetching prospectos:', error);
    res.status(500).json({ 
      error: 'Error al obtener prospectos', 
      detail: error?.message || String(error)
    });
  }
};

export const createProspecto = async (req: Request, res: Response) => {
  try {
    const rawData = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });

    // Sanitize: remove empty strings, convert to null for optional fields
    const data: any = {};
    const stringFields = ['nombre', 'telefono', 'email', 'tipo_acto', 'ciudad', 'fuente', 'necesidad', 'documentos_disponibles', 'tiempo_estimado'];
    const boolFields = ['tiene_antecedente', 'tiene_predial', 'puede_compartir_docs'];
    const enumFields = { prioridad: 'MEDIA', estado: 'NUEVO' };

    for (const field of stringFields) {
      if (rawData[field] !== undefined && rawData[field] !== '') {
        data[field] = rawData[field];
      }
    }
    for (const field of boolFields) {
      if (rawData[field] !== undefined && rawData[field] !== null) {
        data[field] = rawData[field];
      }
    }
    // Enum fields
    data.prioridad = rawData.prioridad || enumFields.prioridad;
    data.estado = rawData.estado || enumFields.estado;

    // nombre is required
    if (!data.nombre) {
      return res.status(400).json({ error: 'El campo "nombre" es obligatorio.' });
    }

    const prospecto = await prisma.prospecto.create({
      data: {
        ...data,
        user_id: userId,
      },
      include: {
        atendido_por: { select: { nombre: true } },
        seguimientos: true
      }
    });

    console.log('✅ Prospecto created:', prospecto.id);
    await logAudit(userId, 'CREATE', 'Prospecto', prospecto.id, { nombre: prospecto.nombre });
    res.status(201).json(prospecto);
  } catch (error: any) {
    console.error('❌ Error creating prospecto:', error);
    res.status(500).json({ 
      error: 'Error al crear el prospecto', 
      detail: error?.message || String(error)
    });
  }
};

export const getProspectoById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prospecto = await prisma.prospecto.findUnique({
      where: { id },
      include: {
        atendido_por: { select: { nombre: true, id: true } },
        seguimientos: {
          include: { usuario: { select: { nombre: true } } },
          orderBy: { created_at: 'desc' }
        },
        cotizacion: true
      }
    });

    if (!prospecto) return res.status(404).json({ error: 'Prospecto no encontrado' });
    res.json(prospecto);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener el prospecto', detail: error?.message });
  }
};

export const updateProspecto = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });

    // Remove undefined/empty fields to avoid overwriting with blanks
    const cleanData: any = {};
    for (const key of Object.keys(data)) {
      if (data[key] !== undefined) cleanData[key] = data[key];
    }

    const prospecto = await prisma.prospecto.update({
      where: { id },
      data: cleanData,
      include: { atendido_por: { select: { nombre: true } }, seguimientos: { take: 1, orderBy: { created_at: 'desc' } } }
    });

    await logAudit(userId, 'UPDATE', 'Prospecto', prospecto.id, { changes: cleanData });
    res.json(prospecto);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al actualizar el prospecto', detail: error?.message });
  }
};

export const deleteProspecto = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });

    const prospecto = await prisma.prospecto.update({
      where: { id },
      data: {
        archived_at: new Date(),
        archived_by: userId,
        motivo_archivo: motivo || 'Archivado por el usuario',
        estado: ProspectoEstado.ARCHIVADO
      }
    });

    await logAudit(userId, 'ARCHIVE', 'Prospecto', prospecto.id, { motivo });
    res.json({ success: true, prospecto });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al archivar el prospecto', detail: error?.message });
  }
};

export const addSeguimiento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tipo, contenido, proxima_accion, fecha_proximo_seguimiento } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });

    if (!tipo || !contenido) {
      return res.status(400).json({ error: 'Los campos "tipo" y "contenido" son obligatorios.' });
    }

    const seguimiento = await prisma.prospectoSeguimiento.create({
      data: {
        prospecto_id: id,
        usuario_id: userId,
        tipo,
        contenido,
        proxima_accion: proxima_accion || null,
        fecha_proximo_seguimiento: fecha_proximo_seguimiento ? new Date(fecha_proximo_seguimiento) : null
      },
      include: { usuario: { select: { nombre: true } } }
    });

    await logAudit(userId, 'ADD_SEGUIMIENTO', 'Prospecto', id, { seguimiento_id: seguimiento.id });
    res.status(201).json(seguimiento);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al agregar seguimiento', detail: error?.message });
  }
};
