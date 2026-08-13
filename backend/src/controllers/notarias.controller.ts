import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { NotariasService } from '../services/notarias.service';

const notariasService = new NotariasService(prisma);

const optionalText = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
};

const jsonTextList = (value: unknown, field: string) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} debe ser una lista de textos.`);
  }
  return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
};

const normalizeEmail = (value: unknown, field: string) => {
  const normalized = optionalText(value)?.toLowerCase() || null;
  if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error(`${field} no tiene un formato válido.`);
  }
  return normalized;
};

// 1. GET ALL NOTARIAS WITH SEARCH & FILTER
export const getNotarias = async (req: Request, res: Response) => {
  try {
    if (String(req.query.portfolio) === 'true') {
      const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || req.query.limit || '20'), 10) || 20));
      const status = String(req.query.estatus || '').toUpperCase();
      const sortOptions = ['numero:asc', 'numero:desc', 'titular:asc', 'titular:desc', 'updated_at:asc', 'updated_at:desc'] as const;
      const requestedSort = String(req.query.sort || 'numero:asc') as typeof sortOptions[number];
      const result = await notariasService.listPortfolio({
        page,
        pageSize,
        search: optionalText(req.query.search) || undefined,
        estado: optionalText(req.query.estado) || undefined,
        ciudad: optionalText(req.query.ciudad) || undefined,
        estatus: status === 'ACTIVA' || status === 'INACTIVA' ? status : undefined,
        conExpedientesActivos: String(req.query.con_expedientes_activos) === 'true',
        sort: sortOptions.includes(requestedSort) ? requestedSort : 'numero:asc',
        expedienteScope: req.user ? expedienteAccessWhere(req.user) : {},
      });
      return res.status(200).json(result);
    }
    const { search, activa, predeterminada, paginated } = req.query;
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || req.query.pageSize || '25'), 10) || 25));

    const whereClause: any = {
      archived_at: null
    };

    if (activa !== undefined) {
      whereClause.activa = String(activa) === 'true';
    }

    if (predeterminada !== undefined) {
      whereClause.predeterminada = String(predeterminada) === 'true';
    }

    if (search) {
      const q = String(search).trim();
      whereClause.OR = [
        { numero_notaria: { contains: q, mode: 'insensitive' } },
        { nombre: { contains: q, mode: 'insensitive' } },
        { notario_titular: { contains: q, mode: 'insensitive' } },
        { municipio: { contains: q, mode: 'insensitive' } },
        { entidad_federativa: { contains: q, mode: 'insensitive' } }
      ];
    }

    const options = {
      where: whereClause,
      include: {
        contactos: { orderBy: { created_at: 'asc' as const } },
        _count: { select: { cotizaciones: true, expedientes: true } },
      },
      orderBy: [
        { predeterminada: 'desc' as const },
        { activa: 'desc' as const },
        { numero_notaria: 'asc' as const },
        { nombre: 'asc' as const },
      ],
    };
    if (String(paginated) === 'true') {
      const [notarias, total] = await Promise.all([
        prisma.notaria.findMany({ ...options, skip: (page - 1) * limit, take: limit }),
        prisma.notaria.count({ where: whereClause }),
      ]);
      return res.json({ data: notarias, meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) } });
    }
    res.json(await prisma.notaria.findMany(options));
  } catch (error: any) {
    res.status(500).json({ error: 'Error al consultar catálogo de notarías', detail: error.message });
  }
};

// 2. GET NOTARIA BY ID
export const getNotariaById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const notaria = await notariasService.detail(id, req.user ? expedienteAccessWhere(req.user) : {});

    if (!notaria) {
      return res.status(404).json({ error: 'Notaría no encontrada' });
    }

    res.json(notaria);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al consultar notaría', detail: error.message });
  }
};

export const getNotariaExpedientes = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(req.query.pageSize || '10'), 10) || 10));
    const sort = String(req.query.sort) === 'updated_at:asc' ? 'updated_at:asc' : 'updated_at:desc';
    const exists = await prisma.notaria.findFirst({ where: { id: req.params.id, archived_at: null }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: 'Notaría no encontrada' });
    const result = await notariasService.listCases(req.params.id, { page, pageSize, sort, expedienteScope: req.user ? expedienteAccessWhere(req.user) : {} });
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ error: 'Error al consultar expedientes de la notaría', detail: error.message });
  }
};

export const addNotariaContacto = async (req: Request, res: Response) => {
  try {
    const nombre = optionalText(req.body.nombre);
    const cargo = optionalText(req.body.cargo);
    if (!nombre || !cargo) return res.status(400).json({ error: 'Nombre y cargo del contacto son obligatorios.' });
    const notaria = await prisma.notaria.findFirst({ where: { id: req.params.id, archived_at: null }, select: { id: true } });
    if (!notaria) return res.status(404).json({ error: 'Notaría no encontrada' });
    const contacto = await prisma.$transaction(async (tx) => {
      const created = await tx.notariaContacto.create({ data: {
        notaria_id: notaria.id,
        nombre,
        cargo,
        telefono: optionalText(req.body.telefono),
        whatsapp: optionalText(req.body.whatsapp),
        correo: normalizeEmail(req.body.correo, 'El correo del contacto'),
        observaciones: optionalText(req.body.observaciones),
        activo: true,
      } });
      await tx.auditLog.create({ data: {
        user_id: req.user!.id,
        accion: 'AGREGAR_CONTACTO_NOTARIA',
        entidad: 'Notaria',
        entidad_id: notaria.id,
        valores_nuevos: { contacto_id: created.id, nombre: created.nombre, cargo: created.cargo },
        correlation_id: req.correlationId,
      } });
      return created;
    });
    return res.status(201).json(contacto);
  } catch (error: any) {
    const validationError = /obligatorios|válido/.test(error.message || '');
    return res.status(validationError ? 400 : 500).json({ error: validationError ? error.message : 'Error al agregar contacto', detail: error.message });
  }
};

// 3. CREATE NOTARIA (WITH UNIQUE RULE & SINGLE PREDECLARED DEFAULT RULE)
export const createNotaria = async (req: Request, res: Response) => {
  try {
    const {
      numero_notaria,
      nombre,
      notario_titular,
      entidad_federativa,
      municipio,
      demarcacion,
      direccion,
      codigo_postal,
      telefono,
      whatsapp,
      correo_general,
      correo_proyectos,
      pagina_web,
      contacto_principal,
      horario,
      dias_atencion,
      tiempo_respuesta,
      tiempo_presupuesto,
      tiempo_firma,
      instrucciones_especiales,
      observaciones_generales,
      requisitos_frecuentes,
      activa,
      predeterminada,
      color_identificador,
      tipos_acto_json,
      instituciones_json,
      municipios_atendidos_json,
      contactos
    } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre o denominación de la notaría es obligatorio' });
    }

    // Uniqueness check by numero_notaria + entidad_federativa + demarcacion if provided
    if (numero_notaria) {
      const existing = await prisma.notaria.findFirst({
        where: {
          numero_notaria: String(numero_notaria).trim(),
          entidad_federativa: entidad_federativa || 'Nayarit',
          demarcacion: demarcacion || null,
          archived_at: null
        }
      });
      if (existing) {
        return res.status(400).json({ error: `Ya existe la Notaría No. ${numero_notaria} en ${entidad_federativa || 'Nayarit'}` });
      }
    }

    const isDefault = Boolean(predeterminada);
    const tiposActo = jsonTextList(tipos_acto_json, 'Tipos de acto') || [];
    const instituciones = jsonTextList(instituciones_json, 'Instituciones') || [];
    const municipiosAtendidos = jsonTextList(municipios_atendidos_json, 'Municipios atendidos') || [];

    const result = await prisma.$transaction(async (tx) => {
      if (numero_notaria) {
        const identityKey = `${String(numero_notaria).trim()}:${entidad_federativa || 'Nayarit'}:${demarcacion || ''}`.toLowerCase();
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:notaria:${identityKey}`}))`);
        const duplicate = await tx.notaria.findFirst({
          where: {
            numero_notaria: String(numero_notaria).trim(),
            entidad_federativa: entidad_federativa || 'Nayarit',
            demarcacion: optionalText(demarcacion),
            archived_at: null
          },
          select: { id: true }
        });
        if (duplicate) throw new Error(`Ya existe la Notaría No. ${numero_notaria} en ${entidad_federativa || 'Nayarit'}.`);
      }

      // If new notary is default, unset any previous default notary
      if (isDefault) {
        await tx.notaria.updateMany({
          where: { predeterminada: true },
          data: { predeterminada: false }
        });
      }

      const notaria = await tx.notaria.create({
        data: {
          numero_notaria: numero_notaria ? String(numero_notaria).trim() : null,
          nombre: nombre.trim(),
          notario_titular: notario_titular ? notario_titular.trim() : null,
          entidad_federativa: entidad_federativa || 'Nayarit',
          municipio: municipio || 'Tepic',
          demarcacion: optionalText(demarcacion),
          direccion: optionalText(direccion),
          codigo_postal: optionalText(codigo_postal),
          telefono: optionalText(telefono),
          whatsapp: optionalText(whatsapp),
          correo_general: normalizeEmail(correo_general, 'El correo general'),
          correo_proyectos: normalizeEmail(correo_proyectos, 'El correo de proyectos'),
          pagina_web: optionalText(pagina_web),
          contacto_principal: optionalText(contacto_principal),
          horario: optionalText(horario),
          dias_atencion: optionalText(dias_atencion),
          tiempo_respuesta: optionalText(tiempo_respuesta),
          tiempo_presupuesto: optionalText(tiempo_presupuesto),
          tiempo_firma: optionalText(tiempo_firma),
          instrucciones_especiales: optionalText(instrucciones_especiales),
          observaciones_generales: optionalText(observaciones_generales),
          requisitos_frecuentes: optionalText(requisitos_frecuentes),
          activa: activa !== undefined ? Boolean(activa) : true,
          predeterminada: isDefault,
          color_identificador: color_identificador || '#D4AF37',
          tipos_acto_json: tiposActo,
          instituciones_json: instituciones,
          municipios_atendidos_json: municipiosAtendidos
        }
      });

      // Add linked contacts if provided
      if (contactos && Array.isArray(contactos) && contactos.length > 0) {
        for (const c of contactos) {
          if (c.nombre && c.nombre.trim()) {
            await tx.notariaContacto.create({
              data: {
                notaria_id: notaria.id,
                nombre: c.nombre.trim(),
                cargo: c.cargo || 'Gestor',
                telefono: optionalText(c.telefono),
                whatsapp: optionalText(c.whatsapp),
                correo: normalizeEmail(c.correo, 'El correo del contacto'),
                observaciones: optionalText(c.observaciones),
                activo: c.activo !== undefined ? Boolean(c.activo) : true
              }
            });
          }
        }
      }

      await tx.auditLog.create({ data: {
        user_id: req.user!.id,
        accion: 'CREAR_NOTARIA',
        entidad: 'Notaria',
        entidad_id: notaria.id,
        valores_nuevos: { numero_notaria: notaria.numero_notaria, nombre: notaria.nombre, entidad_federativa: notaria.entidad_federativa, demarcacion: notaria.demarcacion },
        correlation_id: req.correlationId,
      } });

      return notaria;
    });

    const fullNotaria = await prisma.notaria.findUnique({
      where: { id: result.id },
      include: { contactos: true }
    });

    res.status(201).json(fullNotaria);
  } catch (error: any) {
    const validationError = /obligatorio|válido|debe ser|Ya existe/.test(error.message || '');
    res.status(validationError ? 400 : 500).json({ error: validationError ? error.message : 'Error al registrar notaría', detail: error.message });
  }
};

// 4. UPDATE NOTARIA
export const updateNotaria = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      numero_notaria,
      nombre,
      notario_titular,
      entidad_federativa,
      municipio,
      demarcacion,
      direccion,
      codigo_postal,
      telefono,
      whatsapp,
      correo_general,
      correo_proyectos,
      pagina_web,
      contacto_principal,
      horario,
      dias_atencion,
      tiempo_respuesta,
      tiempo_presupuesto,
      tiempo_firma,
      instrucciones_especiales,
      observaciones_generales,
      requisitos_frecuentes,
      activa,
      predeterminada,
      color_identificador,
      tipos_acto_json,
      instituciones_json,
      municipios_atendidos_json,
      contactos
    } = req.body;

    const existingNotaria = await prisma.notaria.findUnique({ where: { id } });
    if (!existingNotaria) {
      return res.status(404).json({ error: 'Notaría no encontrada' });
    }
    if (existingNotaria.archived_at) {
      return res.status(409).json({ error: 'La notaría está archivada y no puede editarse.' });
    }

    const isDefault = predeterminada !== undefined ? Boolean(predeterminada) : existingNotaria.predeterminada;
    const tiposActo = jsonTextList(tipos_acto_json, 'Tipos de acto');
    const instituciones = jsonTextList(instituciones_json, 'Instituciones');
    const municipiosAtendidos = jsonTextList(municipios_atendidos_json, 'Municipios atendidos');

    const result = await prisma.$transaction(async (tx) => {
      const nextNumber = numero_notaria !== undefined ? optionalText(numero_notaria) : existingNotaria.numero_notaria;
      const nextState = optionalText(entidad_federativa) || existingNotaria.entidad_federativa;
      const nextDemarcation = demarcacion !== undefined ? optionalText(demarcacion) : existingNotaria.demarcacion;
      if (nextNumber) {
        const identityKey = `${nextNumber}:${nextState}:${nextDemarcation || ''}`.toLowerCase();
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:notaria:${identityKey}`}))`);
        const duplicate = await tx.notaria.findFirst({
          where: {
            id: { not: id },
            numero_notaria: nextNumber,
            entidad_federativa: nextState,
            demarcacion: nextDemarcation,
            archived_at: null
          },
          select: { id: true }
        });
        if (duplicate) throw new Error(`Ya existe la Notaría No. ${nextNumber} en ${nextState}.`);
      }

      // If setting as default, unset any previous default
      if (isDefault) {
        await tx.notaria.updateMany({
          where: { id: { not: id }, predeterminada: true },
          data: { predeterminada: false }
        });
      }

      const updated = await tx.notaria.update({
        where: { id },
        data: {
          numero_notaria: numero_notaria !== undefined ? (numero_notaria ? String(numero_notaria).trim() : null) : existingNotaria.numero_notaria,
          nombre: nombre ? nombre.trim() : existingNotaria.nombre,
          notario_titular: notario_titular !== undefined ? (notario_titular ? notario_titular.trim() : null) : existingNotaria.notario_titular,
          entidad_federativa: entidad_federativa || existingNotaria.entidad_federativa,
          municipio: municipio || existingNotaria.municipio,
          demarcacion: nextDemarcation,
          direccion: direccion !== undefined ? optionalText(direccion) : existingNotaria.direccion,
          codigo_postal: codigo_postal !== undefined ? optionalText(codigo_postal) : existingNotaria.codigo_postal,
          telefono: telefono !== undefined ? optionalText(telefono) : existingNotaria.telefono,
          whatsapp: whatsapp !== undefined ? optionalText(whatsapp) : existingNotaria.whatsapp,
          correo_general: correo_general !== undefined ? normalizeEmail(correo_general, 'El correo general') : existingNotaria.correo_general,
          correo_proyectos: correo_proyectos !== undefined ? normalizeEmail(correo_proyectos, 'El correo de proyectos') : existingNotaria.correo_proyectos,
          pagina_web: pagina_web !== undefined ? optionalText(pagina_web) : existingNotaria.pagina_web,
          contacto_principal: contacto_principal !== undefined ? optionalText(contacto_principal) : existingNotaria.contacto_principal,
          horario: horario !== undefined ? optionalText(horario) : existingNotaria.horario,
          dias_atencion: dias_atencion !== undefined ? optionalText(dias_atencion) : existingNotaria.dias_atencion,
          tiempo_respuesta: tiempo_respuesta !== undefined ? optionalText(tiempo_respuesta) : existingNotaria.tiempo_respuesta,
          tiempo_presupuesto: tiempo_presupuesto !== undefined ? optionalText(tiempo_presupuesto) : existingNotaria.tiempo_presupuesto,
          tiempo_firma: tiempo_firma !== undefined ? optionalText(tiempo_firma) : existingNotaria.tiempo_firma,
          instrucciones_especiales: instrucciones_especiales !== undefined ? optionalText(instrucciones_especiales) : existingNotaria.instrucciones_especiales,
          observaciones_generales: observaciones_generales !== undefined ? optionalText(observaciones_generales) : existingNotaria.observaciones_generales,
          requisitos_frecuentes: requisitos_frecuentes !== undefined ? optionalText(requisitos_frecuentes) : existingNotaria.requisitos_frecuentes,
          activa: activa !== undefined ? Boolean(activa) : existingNotaria.activa,
          predeterminada: isDefault,
          color_identificador: color_identificador || existingNotaria.color_identificador,
          tipos_acto_json: tiposActo !== undefined ? tiposActo : (existingNotaria.tipos_acto_json ?? []),
          instituciones_json: instituciones !== undefined ? instituciones : (existingNotaria.instituciones_json ?? []),
          municipios_atendidos_json: municipiosAtendidos !== undefined ? municipiosAtendidos : (existingNotaria.municipios_atendidos_json ?? [])
        }
      });

      // Sincroniza contactos sin borrado físico para conservar trazabilidad.
      if (contactos && Array.isArray(contactos)) {
        const suppliedIds = contactos
          .map((contact) => contact.id)
          .filter((contactId): contactId is string => typeof contactId === 'string');
        await tx.notariaContacto.updateMany({
          where: { notaria_id: id, id: { notIn: suppliedIds } },
          data: { activo: false }
        });
        for (const c of contactos) {
          if (c.nombre && c.nombre.trim()) {
            const data = {
                notaria_id: id,
                nombre: c.nombre.trim(),
                cargo: c.cargo || 'Gestor',
                telefono: optionalText(c.telefono),
                whatsapp: optionalText(c.whatsapp),
                correo: normalizeEmail(c.correo, 'El correo del contacto'),
                observaciones: optionalText(c.observaciones),
                activo: c.activo !== undefined ? Boolean(c.activo) : true
              };
            if (c.id) {
              await tx.notariaContacto.updateMany({
                where: { id: c.id, notaria_id: id },
                data
              });
            } else {
              await tx.notariaContacto.create({ data });
            }
          }
        }
      }

      await tx.auditLog.create({ data: {
        user_id: req.user!.id,
        accion: 'EDITAR_NOTARIA',
        entidad: 'Notaria',
        entidad_id: id,
        valores_anteriores: { updated_at: existingNotaria.updated_at },
        valores_nuevos: { campos: Object.keys(req.body) },
        correlation_id: req.correlationId,
      } });

      return updated;
    });

    const fullUpdated = await prisma.notaria.findUnique({
      where: { id },
      include: { contactos: true }
    });

    res.json(fullUpdated);
  } catch (error: any) {
    const validationError = /obligatorio|válido|debe ser|Ya existe/.test(error.message || '');
    res.status(validationError ? 400 : 500).json({ error: validationError ? error.message : 'Error al actualizar notaría', detail: error.message });
  }
};

// 5. SET PRETERMINADA
export const setNotariaPredeterminada = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const notaria = await prisma.notaria.findUnique({ where: { id } });
    if (!notaria) return res.status(404).json({ error: 'Notaría no encontrada' });
    if (notaria.archived_at) return res.status(409).json({ error: 'La notaría está archivada.' });

    await prisma.$transaction([
      prisma.notaria.updateMany({
        where: { id: { not: id } },
        data: { predeterminada: false }
      }),
      prisma.notaria.update({
        where: { id },
        data: { predeterminada: true, activa: true }
      })
    ]);

    const updated = await prisma.notaria.findUnique({
      where: { id },
      include: { contactos: true }
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al establecer notaría predeterminada', detail: error.message });
  }
};

// 6. ARCHIVE NOTARIA (SIEMPRE BAJA LÓGICA)
export const archiveNotaria = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const notaria = await prisma.notaria.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            cotizaciones: true,
            expedientes: true
          }
        }
      }
    });

    if (!notaria) {
      return res.status(404).json({ error: 'Notaría no encontrada' });
    }

    await prisma.notaria.update({
      where: { id },
      data: {
        activa: false,
        predeterminada: false,
        archived_at: new Date()
      }
    });
    return res.json({
      message: 'Notaría archivada preservando contactos, cotizaciones y expedientes vinculados',
      relaciones_preservadas: notaria._count
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al eliminar notaría', detail: error.message });
  }
};
