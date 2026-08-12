import { Request, Response } from 'express';
import { EventoAgendaEstatus, Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { AgendaError, canAssignAgendaResponsibility, canManageAgendaTeam, normalizeAgendaType, normalizeReminders, parseAgendaRange } from '../domain/agenda';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { comparecienteObjectWhere } from '../services/objectAccess.service';

const EVENT_COLORS: Record<string, string> = {
  PERSONAL: '#64748b',
  DESPACHO: '#1d4ed8',
  FIRMA: '#b45309',
  AUDIENCIA: '#7c3aed',
  VENCIMIENTO: '#be123c',
  CITA: '#0f766e',
  NOTARIA: '#a16207',
  SEGUIMIENTO: '#0369a1',
  OTRO: '#475569',
};

const actorIdFrom = (req: Request) => req.user?.id;

async function requireActiveUser(id: unknown, label: string) {
  if (!id) throw new AgendaError(`${label} es obligatorio.`, 'AGENDA_USER_REQUIRED', 401);
  const user = await prisma.user.findFirst({ where: { id: String(id), activo: true }, select: { id: true } });
  if (!user) throw new AgendaError(`${label} no corresponde a un usuario activo.`, 'AGENDA_USER_INVALID', 401);
  return user.id;
}

async function validateAgendaLinks(input: { expedienteId?: unknown; comparecienteId?: unknown }, user: NonNullable<Request['user']>) {
  const [expediente, compareciente] = await Promise.all([
    input.expedienteId
      ? prisma.expediente.findFirst({ where: { id: String(input.expedienteId), archived_at: null, ...expedienteAccessWhere(user) }, select: { id: true } })
      : null,
    input.comparecienteId
      ? prisma.compareciente.findFirst({ where: { id: String(input.comparecienteId), archived_at: null, ...comparecienteObjectWhere(user) }, select: { id: true } })
      : null,
  ]);
  if (input.expedienteId && !expediente) throw new AgendaError('El expediente vinculado no está activo.', 'AGENDA_EXPEDIENTE_INVALID', 404);
  if (input.comparecienteId && !compareciente) throw new AgendaError('El compareciente vinculado no está activo.', 'AGENDA_COMPARECIENTE_INVALID', 404);
  return { expedienteId: expediente?.id || null, comparecienteId: compareciente?.id || null };
}

const eventInclude = {
  usuario: { select: { id: true, nombre: true, apellido: true } },
  expediente: { select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true } },
  compareciente: {
    select: {
      id: true,
      tipo_persona: true,
      nombre_busqueda: true,
      personaFisica: { select: { nombre_completo_calculado: true } },
      personaMoral: { select: { razon_social: true } },
    },
  },
} satisfies Prisma.EventoAgendaInclude;

const serializeEvent = (event: any) => ({
  ...event,
  color: EVENT_COLORS[event.tipo] || EVENT_COLORS.OTRO,
  responsable_nombre: event.usuario ? `${event.usuario.nombre} ${event.usuario.apellido}`.trim() : 'Sin responsable',
  compareciente_nombre: event.compareciente
    ? event.compareciente.personaFisica?.nombre_completo_calculado
      || event.compareciente.personaMoral?.razon_social
      || event.compareciente.nombre_busqueda
    : null,
});

export class AgendaController {
  static async listTasks(req: Request, res: Response) {
    try {
      const canManageTeam = canManageAgendaTeam(req.user);
      const tasks = await prisma.tarea.findMany({
        where: {
          ...(!canManageTeam && req.user ? { asignado_a_id: req.user.id } : req.query.user_id && req.query.user_id !== 'TODOS' ? { asignado_a_id: String(req.query.user_id) } : {}),
          ...(req.query.estatus && req.query.estatus !== 'TODOS' ? { estatus: String(req.query.estatus) as any } : { estatus: { not: 'CANCELADA' } }),
          ...(req.query.expediente_id ? { expediente_id: String(req.query.expediente_id) } : {}),
        },
        include: {
          asignado_a: { select: { id: true, nombre: true, apellido: true } },
          expediente: { select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true } },
        },
        orderBy: [{ estatus: 'asc' }, { fecha_limite: 'asc' }, { prioridad: 'desc' }, { created_at: 'desc' }],
        take: 500,
      });
      return res.json({ success: true, tareas: tasks, meta: { total: tasks.length } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'No fue posible cargar las tareas.', detail: error.message });
    }
  }

  static async createTask(req: Request, res: Response) {
    try {
      const actorId = await requireActiveUser(actorIdFrom(req), 'El usuario que registra');
      const requestedResponsible = req.body.responsable_id || actorId;
      if (!canAssignAgendaResponsibility(req.user, requestedResponsible)) throw new AgendaError('Solo puedes asignarte tareas a ti mismo.', 'TASK_ASSIGNMENT_DENIED', 403);
      const responsableId = await requireActiveUser(requestedResponsible, 'El responsable');
      const title = String(req.body.titulo || '').trim();
      if (title.length < 3 || title.length > 180) throw new AgendaError('El título debe tener entre 3 y 180 caracteres.', 'TASK_TITLE_INVALID');
      const priority = String(req.body.prioridad || 'MEDIA').toUpperCase();
      if (!['BAJA', 'MEDIA', 'ALTA', 'URGENTE'].includes(priority)) throw new AgendaError('La prioridad de la tarea no es válida.', 'TASK_PRIORITY_INVALID');
      if (!req.user) throw new AgendaError('Inicia sesión para continuar.', 'AUTH_REQUIRED', 401);
      const links = await validateAgendaLinks({ expedienteId: req.body.expediente_id }, req.user);
      const deadline = req.body.fecha_limite ? new Date(req.body.fecha_limite) : null;
      if (deadline && Number.isNaN(deadline.getTime())) throw new AgendaError('La fecha límite no es válida.', 'TASK_DEADLINE_INVALID');
      const task = await prisma.$transaction(async (tx) => {
        const created = await tx.tarea.create({
          data: {
            titulo: title,
            descripcion: String(req.body.descripcion || '').trim() || null,
            prioridad: priority as any,
            fecha_limite: deadline,
            expediente_id: links.expedienteId,
            asignado_a_id: responsableId,
            creador_id: actorId,
            etapa_relacionada: String(req.body.etapa_relacionada || '').trim() || null,
            idempotency_key: String(req.body.idempotency_key || '').trim() || null,
          },
          include: { asignado_a: { select: { id: true, nombre: true, apellido: true } }, expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } } },
        });
        await tx.auditLog.create({
          data: { user_id: actorId, accion: 'CREATE_TASK', entidad: 'Tarea', entidad_id: created.id, valores_nuevos: { titulo: title, prioridad: priority, responsable_id: responsableId, expediente_id: links.expedienteId }, correlation_id: (req as any).correlationId },
        });
        if (links.expedienteId) {
          await tx.expedienteActividad.create({ data: { expediente_id: links.expedienteId, usuario_id: actorId, tipo: 'TAREA', titulo: `Tarea creada: ${title}`, descripcion: `Prioridad ${priority}` } });
        }
        return created;
      });
      return res.status(201).json({ success: true, tarea: task });
    } catch (error: any) {
      const status = error instanceof AgendaError ? error.status : error.code === 'P2002' ? 409 : 500;
      return res.status(status).json({ success: false, error: error.code === 'P2002' ? 'La tarea ya fue registrada.' : error.message, code: error.code || 'TASK_CREATE_FAILED' });
    }
  }

  static async updateTask(req: Request, res: Response) {
    try {
      const actorId = await requireActiveUser(actorIdFrom(req), 'El usuario que modifica');
      const current = await prisma.tarea.findUnique({ where: { id: req.params.id } });
      if (!current) throw new AgendaError('Tarea no encontrada.', 'TASK_NOT_FOUND', 404);
      const canManageTeam = canManageAgendaTeam(req.user);
      if (!canManageTeam && current.asignado_a_id !== actorId) throw new AgendaError('Solo puedes modificar tus tareas asignadas.', 'TASK_ACCESS_DENIED', 403);
      const status = String(req.body.estatus || current.estatus).toUpperCase();
      if (!['PENDIENTE', 'EN_PROCESO', 'COMPLETADA', 'CANCELADA'].includes(status)) throw new AgendaError('El estado de la tarea no es válido.', 'TASK_STATUS_INVALID');
      const priority = String(req.body.prioridad || current.prioridad).toUpperCase();
      if (!['BAJA', 'MEDIA', 'ALTA', 'URGENTE'].includes(priority)) throw new AgendaError('La prioridad de la tarea no es válida.', 'TASK_PRIORITY_INVALID');
      const title = req.body.titulo === undefined ? current.titulo : String(req.body.titulo).trim();
      if (title.length < 3 || title.length > 180) throw new AgendaError('El título debe tener entre 3 y 180 caracteres.', 'TASK_TITLE_INVALID');
      const deadline = req.body.fecha_limite === undefined ? current.fecha_limite : req.body.fecha_limite ? new Date(req.body.fecha_limite) : null;
      if (deadline && Number.isNaN(deadline.getTime())) throw new AgendaError('La fecha límite no es válida.', 'TASK_DEADLINE_INVALID');
      if (req.body.responsable_id && !canAssignAgendaResponsibility(req.user, req.body.responsable_id)) throw new AgendaError('No puedes reasignar la tarea.', 'TASK_ASSIGNMENT_DENIED', 403);
      const responsible = req.body.responsable_id ? await requireActiveUser(req.body.responsable_id, 'El responsable') : current.asignado_a_id;
      const updated = await prisma.$transaction(async (tx) => {
        const task = await tx.tarea.update({
          where: { id: current.id },
          data: {
            titulo: title,
            descripcion: req.body.descripcion === undefined ? current.descripcion : String(req.body.descripcion || '').trim() || null,
            prioridad: priority as any,
            estatus: status as any,
            fecha_limite: deadline,
            fecha_completada: status === 'COMPLETADA' ? current.fecha_completada || new Date() : null,
            asignado_a_id: responsible,
          },
          include: { asignado_a: { select: { id: true, nombre: true, apellido: true } }, expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } } },
        });
        await tx.auditLog.create({
          data: { user_id: actorId, accion: 'UPDATE_TASK', entidad: 'Tarea', entidad_id: task.id, valores_anteriores: { estatus: current.estatus, prioridad: current.prioridad }, valores_nuevos: { estatus: task.estatus, prioridad: task.prioridad }, correlation_id: (req as any).correlationId },
        });
        if (current.expediente_id && current.estatus !== status) {
          await tx.expedienteActividad.create({ data: { expediente_id: current.expediente_id, usuario_id: actorId, tipo: 'TAREA', titulo: `Tarea ${status.toLowerCase()}: ${current.titulo}`, descripcion: `Estado anterior: ${current.estatus}` } });
        }
        return task;
      });
      return res.json({ success: true, tarea: updated });
    } catch (error: any) {
      const status = error instanceof AgendaError ? error.status : 500;
      return res.status(status).json({ success: false, error: error.message, code: error.code || 'TASK_UPDATE_FAILED' });
    }
  }

  static async list(req: Request, res: Response) {
    try {
      const now = new Date();
      const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const defaultTo = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
      const from = req.query.desde ? new Date(String(req.query.desde)) : defaultFrom;
      const to = req.query.hasta ? new Date(String(req.query.hasta)) : defaultTo;
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
        throw new AgendaError('El rango de consulta de agenda no es válido.', 'AGENDA_QUERY_RANGE_INVALID');
      }
      if (to.getTime() - from.getTime() > 370 * 24 * 60 * 60 * 1000) {
        throw new AgendaError('Consulta como máximo un año de agenda.', 'AGENDA_QUERY_RANGE_TOO_LONG');
      }
      const status = String(req.query.estatus || 'ACTIVO').toUpperCase();
      if (!['TODOS', 'ACTIVO', 'COMPLETADO', 'CANCELADO'].includes(status)) {
        throw new AgendaError('El estado solicitado no es válido.', 'AGENDA_STATUS_INVALID');
      }
      const events = await prisma.eventoAgenda.findMany({
        where: {
          fecha_inicio: { lte: to },
          OR: [{ fecha_fin: { gte: from } }, { fecha_fin: null, fecha_inicio: { gte: from } }],
          ...(status !== 'TODOS' ? { estatus: status as EventoAgendaEstatus } : {}),
          ...(req.query.tipo && req.query.tipo !== 'TODOS' ? { tipo: normalizeAgendaType(req.query.tipo) } : {}),
          ...(!req.user || ['DIRECCION', 'ADMINISTRACION'].includes(req.user.rol)
            ? (req.query.user_id && req.query.user_id !== 'TODOS' ? { user_id: String(req.query.user_id) } : {})
            : { user_id: req.user.id }),
          ...(req.query.expediente_id ? { expediente_id: String(req.query.expediente_id) } : {}),
        },
        include: eventInclude,
        orderBy: [{ fecha_inicio: 'asc' }, { created_at: 'asc' }],
        take: 750,
      });
      return res.json({ success: true, eventos: events.map(serializeEvent), meta: { total: events.length, desde: from, hasta: to } });
    } catch (error: any) {
      const status = error instanceof AgendaError ? error.status : 500;
      return res.status(status).json({ success: false, error: error.message, code: error.code || 'AGENDA_LIST_FAILED' });
    }
  }

  static async catalogs(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      const expedienteScope = req.user.permissions.includes('expedientes.read') ? expedienteAccessWhere(req.user) : { id: '00000000-0000-0000-0000-000000000000' };
      const canReadComparecientes = req.user.permissions.includes('comparecientes.read');
      const canManageTeam = canManageAgendaTeam(req.user);
      const [usuarios, expedientes, comparecientes] = await Promise.all([
        prisma.user.findMany({ where: { activo: true, ...(!canManageTeam ? { id: req.user.id } : {}) }, select: { id: true, nombre: true, apellido: true, rol: true }, orderBy: [{ nombre: 'asc' }, { apellido: 'asc' }] }),
        prisma.expediente.findMany({ where: { archived_at: null, ...expedienteScope }, select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true }, orderBy: { updated_at: 'desc' }, take: 300 }),
        prisma.compareciente.findMany({
          where: { archived_at: null, ...(!canReadComparecientes ? { id: '00000000-0000-0000-0000-000000000000' } : {}) },
          select: {
            id: true,
            tipo_persona: true,
            nombre_busqueda: true,
            personaFisica: { select: { nombre_completo_calculado: true } },
            personaMoral: { select: { razon_social: true } },
          },
          orderBy: { updated_at: 'desc' },
          take: 300,
        }),
      ]);
      return res.json({
        success: true,
        catalogos: {
          usuarios,
          expedientes,
          comparecientes: comparecientes.map((item) => ({
            id: item.id,
            tipo_persona: item.tipo_persona,
            nombre: item.personaFisica?.nombre_completo_calculado || item.personaMoral?.razon_social || item.nombre_busqueda,
          })),
          tipos: Object.keys(EVENT_COLORS).map((tipo) => ({ tipo, color: EVENT_COLORS[tipo] })),
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'No fue posible cargar los catálogos de agenda.', detail: error.message });
    }
  }

  static async create(req: Request, res: Response) {
    try {
      const actorId = await requireActiveUser(actorIdFrom(req), 'El usuario que registra');
      const requestedResponsible = req.body.responsable_id || actorId;
      if (!canAssignAgendaResponsibility(req.user, requestedResponsible)) throw new AgendaError('Solo puedes registrar eventos para ti mismo.', 'AGENDA_ASSIGNMENT_DENIED', 403);
      const responsableId = await requireActiveUser(requestedResponsible, 'El responsable');
      const titulo = String(req.body.titulo || '').trim();
      if (titulo.length < 3 || titulo.length > 180) throw new AgendaError('El título debe tener entre 3 y 180 caracteres.', 'AGENDA_TITLE_INVALID');
      const tipo = normalizeAgendaType(req.body.tipo);
      const range = parseAgendaRange({ fechaInicio: req.body.fecha_inicio, fechaFin: req.body.fecha_fin, todoElDia: req.body.todo_el_dia });
      const reminders = normalizeReminders(req.body.recordatorios);
      if (!req.user) throw new AgendaError('Inicia sesión para continuar.', 'AUTH_REQUIRED', 401);
      const links = await validateAgendaLinks({ expedienteId: req.body.expediente_id, comparecienteId: req.body.compareciente_id }, req.user);
      const idempotencyKey = String(req.body.idempotency_key || '').trim() || null;

      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:agenda:${idempotencyKey || `${responsableId}:${titulo}:${range.start.toISOString()}`}`}))`);
        if (idempotencyKey) {
          const existing = await tx.eventoAgenda.findUnique({ where: { idempotency_key: idempotencyKey }, include: eventInclude });
          if (existing) return { event: existing, idempotent: true };
        }
        const event = await tx.eventoAgenda.create({
          data: {
            titulo,
            descripcion: String(req.body.descripcion || '').trim() || null,
            tipo,
            fecha_inicio: range.start,
            fecha_fin: range.end,
            todo_el_dia: range.allDay,
            user_id: responsableId,
            expediente_id: links.expedienteId,
            compareciente_id: links.comparecienteId,
            recordatorios: reminders,
            idempotency_key: idempotencyKey,
          },
          include: eventInclude,
        });
        await tx.auditLog.create({
          data: {
            user_id: actorId,
            accion: 'CREATE_AGENDA_EVENT',
            entidad: 'EventoAgenda',
            entidad_id: event.id,
            valores_nuevos: { titulo, tipo, fecha_inicio: range.start, responsable_id: responsableId, expediente_id: links.expedienteId },
            correlation_id: (req as any).correlationId,
          },
        });
        if (links.expedienteId) {
          await tx.expedienteActividad.create({
            data: {
              expediente_id: links.expedienteId,
              usuario_id: actorId,
              tipo: 'TAREA',
              titulo: `Agenda: ${titulo}`,
              descripcion: `${tipo} programado para ${range.start.toISOString()}`,
            },
          });
        }
        return { event, idempotent: false };
      });
      return res.status(result.idempotent ? 200 : 201).json({ success: true, evento: serializeEvent(result.event), idempotent: result.idempotent });
    } catch (error: any) {
      const status = error instanceof AgendaError ? error.status : 500;
      return res.status(status).json({ success: false, error: error.message, code: error.code || 'AGENDA_CREATE_FAILED' });
    }
  }

  static async update(req: Request, res: Response) {
    try {
      const actorId = await requireActiveUser(actorIdFrom(req), 'El usuario que modifica');
      const current = await prisma.eventoAgenda.findUnique({ where: { id: req.params.id } });
      if (!current) throw new AgendaError('Evento no encontrado.', 'AGENDA_EVENT_NOT_FOUND', 404);
      const canManageTeam = canManageAgendaTeam(req.user);
      if (!canManageTeam && current.user_id !== actorId) throw new AgendaError('Solo puedes modificar tus eventos.', 'AGENDA_ACCESS_DENIED', 403);
      if (current.estatus === 'CANCELADO') throw new AgendaError('Un evento cancelado ya no puede modificarse.', 'AGENDA_EVENT_CANCELLED', 409);
      if (req.body.responsable_id && !canAssignAgendaResponsibility(req.user, req.body.responsable_id)) throw new AgendaError('No puedes reasignar el evento.', 'AGENDA_ASSIGNMENT_DENIED', 403);
      const responsableId = req.body.responsable_id
        ? await requireActiveUser(req.body.responsable_id, 'El responsable')
        : current.user_id;
      if (!req.user) throw new AgendaError('Inicia sesión para continuar.', 'AUTH_REQUIRED', 401);
      const links = await validateAgendaLinks({
        expedienteId: req.body.expediente_id === undefined ? current.expediente_id : req.body.expediente_id,
        comparecienteId: req.body.compareciente_id === undefined ? current.compareciente_id : req.body.compareciente_id,
      }, req.user);
      const range = parseAgendaRange({
        fechaInicio: req.body.fecha_inicio || current.fecha_inicio,
        fechaFin: req.body.fecha_fin === undefined ? current.fecha_fin : req.body.fecha_fin,
        todoElDia: req.body.todo_el_dia ?? current.todo_el_dia,
      });
      const titulo = req.body.titulo === undefined ? current.titulo : String(req.body.titulo).trim();
      if (titulo.length < 3 || titulo.length > 180) throw new AgendaError('El título debe tener entre 3 y 180 caracteres.', 'AGENDA_TITLE_INVALID');
      const estatus = req.body.estatus ? String(req.body.estatus).toUpperCase() as EventoAgendaEstatus : current.estatus;
      if (!['ACTIVO', 'COMPLETADO'].includes(estatus)) throw new AgendaError('El estado solicitado no es válido.', 'AGENDA_STATUS_INVALID');

      const updated = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:agenda-event:${current.id}`}))`);
        const event = await tx.eventoAgenda.update({
          where: { id: current.id },
          data: {
            titulo,
            descripcion: req.body.descripcion === undefined ? current.descripcion : String(req.body.descripcion || '').trim() || null,
            tipo: req.body.tipo ? normalizeAgendaType(req.body.tipo) : current.tipo,
            fecha_inicio: range.start,
            fecha_fin: range.end,
            todo_el_dia: range.allDay,
            user_id: responsableId,
            expediente_id: links.expedienteId,
            compareciente_id: links.comparecienteId,
            ...(req.body.recordatorios === undefined ? {} : { recordatorios: normalizeReminders(req.body.recordatorios) }),
            estatus,
          },
          include: eventInclude,
        });
        await tx.auditLog.create({
          data: {
            user_id: actorId,
            accion: 'UPDATE_AGENDA_EVENT',
            entidad: 'EventoAgenda',
            entidad_id: event.id,
            valores_anteriores: { titulo: current.titulo, tipo: current.tipo, fecha_inicio: current.fecha_inicio, estatus: current.estatus },
            valores_nuevos: { titulo: event.titulo, tipo: event.tipo, fecha_inicio: event.fecha_inicio, estatus: event.estatus },
            correlation_id: (req as any).correlationId,
          },
        });
        return event;
      });
      return res.json({ success: true, evento: serializeEvent(updated) });
    } catch (error: any) {
      const status = error instanceof AgendaError ? error.status : 500;
      return res.status(status).json({ success: false, error: error.message, code: error.code || 'AGENDA_UPDATE_FAILED' });
    }
  }

  static async cancel(req: Request, res: Response) {
    try {
      const actorId = await requireActiveUser(actorIdFrom(req), 'El usuario que cancela');
      const reason = String(req.body.motivo_cancelacion || '').trim();
      if (reason.length < 5) throw new AgendaError('El motivo de cancelación debe tener al menos 5 caracteres.', 'AGENDA_CANCEL_REASON_REQUIRED');
      const event = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:agenda-event:${req.params.id}`}))`);
        const current = await tx.eventoAgenda.findUnique({ where: { id: req.params.id } });
        if (!current) throw new AgendaError('Evento no encontrado.', 'AGENDA_EVENT_NOT_FOUND', 404);
        const canManageTeam = canManageAgendaTeam(req.user);
        if (!canManageTeam && current.user_id !== actorId) throw new AgendaError('Solo puedes cancelar tus eventos.', 'AGENDA_ACCESS_DENIED', 403);
        if (current.estatus === 'CANCELADO') return current;
        const cancelled = await tx.eventoAgenda.update({
          where: { id: current.id },
          data: { estatus: 'CANCELADO', cancelado_at: new Date(), cancelado_por_id: actorId, motivo_cancelacion: reason },
        });
        await tx.auditLog.create({
          data: {
            user_id: actorId,
            accion: 'CANCEL_AGENDA_EVENT',
            entidad: 'EventoAgenda',
            entidad_id: current.id,
            valores_anteriores: { estatus: current.estatus },
            valores_nuevos: { estatus: 'CANCELADO', motivo: reason },
            correlation_id: (req as any).correlationId,
          },
        });
        if (current.expediente_id) {
          await tx.expedienteActividad.create({
            data: { expediente_id: current.expediente_id, usuario_id: actorId, tipo: 'TAREA', titulo: `Evento cancelado: ${current.titulo}`, descripcion: reason },
          });
        }
        return cancelled;
      });
      return res.json({ success: true, evento: serializeEvent(event) });
    } catch (error: any) {
      const status = error instanceof AgendaError ? error.status : 500;
      return res.status(status).json({ success: false, error: error.message, code: error.code || 'AGENDA_CANCEL_FAILED' });
    }
  }
}
