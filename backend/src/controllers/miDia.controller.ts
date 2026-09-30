import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { calculateFinancialPosition } from '../domain/financialLedger';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { MidBaseSourceError, MidBaseSourceService } from '../services/midBaseSource.service';
import { intelligentNotificationService } from '../services/intelligentNotification.service';

const midBaseSourceService = new MidBaseSourceService(prisma);

const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

function budget(exp: any) {
  if (exp?.presupuesto) return {
    total: asNumber(exp.presupuesto.total),
    pravia: asNumber(exp.presupuesto.distribucion?.pravia_honorarios) + asNumber(exp.presupuesto.distribucion?.pravia_iva),
  };
  const data = exp?.datos_operacion?.presupuesto;
  return {
    total: asNumber(data?.total_cliente ?? exp?.cotizacion?.total_cliente),
    pravia: asNumber(data?.honorarios_pravia ?? exp?.cotizacion?.honorarios_pravia),
  };
}

export class MiDiaController {
  static async sources(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 250)) {
        return res.status(400).json({ code: 'MID_BASE_LIMIT_INVALID', error: 'El límite debe ser un entero entre 1 y 250.' });
      }
      return res.json({ success: true, data: await midBaseSourceService.read(req.user, { limit }) });
    } catch (error) {
      if (error instanceof MidBaseSourceError) return res.status(error.status).json({ code: error.code, error: error.message });
      console.error('MID-BASE source read error', error);
      return res.status(500).json({ code: 'MID_BASE_INTERNAL_ERROR', error: 'No fue posible consultar las fuentes de Mi Día.' });
    }
  }

  static async dashboard(req: Request, res: Response) {
    try {
      const now = new Date();
      const todayStart = startOfDay(now);
      const todayEnd = endOfDay(now);
      const nextWeek = endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
      if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      const canSeeTeam = ['DIRECCION', 'ADMINISTRACION'].includes(req.user.rol);
      const requestedUserId = req.query.user_id && req.query.user_id !== 'TODOS' ? String(req.query.user_id) : null;
      const userId = canSeeTeam ? requestedUserId : req.user.id;
      const expedienteUserFilter = canSeeTeam
        ? (userId ? { OR: [{ abogado_id: userId }, { gestor_id: userId }] } : {})
        : expedienteAccessWhere(req.user);
      const canReadFinance = req.user.permissions.includes('finanzas.read');

      const [tasks, events, expedientes, quotes, pendingExp008Income, pendingExp008Requests] = await Promise.all([
        prisma.tarea.findMany({
          where: { estatus: { in: ['PENDIENTE', 'EN_PROCESO'] }, ...(userId ? { asignado_a_id: userId } : {}) },
          include: { expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } } },
          orderBy: [{ fecha_limite: 'asc' }, { prioridad: 'desc' }, { created_at: 'asc' }],
          take: 100,
        }),
        prisma.eventoAgenda.findMany({
          where: { estatus: 'ACTIVO', fecha_inicio: { gte: todayStart, lte: nextWeek }, ...(userId ? { user_id: userId } : {}) },
          include: { expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } } },
          orderBy: { fecha_inicio: 'asc' },
          take: 100,
        }),
        prisma.expediente.findMany({
          where: { archived_at: null, ...expedienteUserFilter },
          include: {
            presupuesto: { include: { distribucion: true } },
            cotizacion: true,
            movimientosFinancieros: canReadFinance,
            requisitos_docs: {
              where: { obligatorio: true, estatus: { in: ['PENDIENTE', 'RECHAZADO', 'VENCIDO'] } },
              select: { id: true, nombre: true, estatus: true, fecha_vencimiento: true },
            },
            tareas_externas: { where: { estatus: 'BLOQUEADA' }, select: { id: true, descripcion: true, institucion: true } },
            notaria: { select: { nombre: true } },
          },
          orderBy: { updated_at: 'desc' },
          take: 300,
        }),
        prisma.cotizacion.findMany({
          where: {
            estado: { in: ['ENVIADA_NOTARIA', 'PRESUPUESTO_RECIBIDO', 'EN_REVISION_ABOGADO', 'ENVIADA_CLIENTE', 'EN_NEGOCIACION'] },
            ...(userId ? { user_id: userId } : {}),
          },
          include: { prospecto: { select: { nombre: true } }, seguimientos: { orderBy: { created_at: 'desc' }, take: 1 } },
          orderBy: { updated_at: 'asc' },
          take: 100,
        }),
        canReadFinance ? prisma.expedienteIngresoReportado.findMany({
          where: { estado: 'PENDIENTE_APLICACION', expediente: { archived_at: null, ...expedienteUserFilter } },
          select: { id: true, created_at: true, expediente: { select: { id: true, numero_pravia: true } } }, orderBy: { created_at: 'asc' }, take: 50,
        }) : Promise.resolve([]),
        canReadFinance ? prisma.expedienteSolicitudPago.findMany({
          where: { estado: 'PENDIENTE', expediente: { archived_at: null, ...expedienteUserFilter } },
          select: { id: true, created_at: true, fecha_limite: true, expediente: { select: { id: true, numero_pravia: true } } }, orderBy: { created_at: 'asc' }, take: 50,
        }) : Promise.resolve([]),
      ]);

      const todayTasks = tasks.filter((task) => task.fecha_limite && task.fecha_limite >= todayStart && task.fecha_limite <= todayEnd);
      const overdueTasks = tasks.filter((task) => task.fecha_limite && task.fecha_limite < todayStart);
      const todayEvents = events.filter((event) => event.fecha_inicio <= todayEnd);
      const upcomingSignatures = expedientes.filter((exp) => exp.fecha_estimada_firma && exp.fecha_estimada_firma >= todayStart && exp.fecha_estimada_firma <= nextWeek && !exp.fecha_real_firma);
      const blocked = expedientes.filter((exp) => exp.estatus === 'SUSPENDIDO' || exp.tareas_externas.length > 0);
      const pendingClient = expedientes.filter((exp) => exp.estatus === 'PENDIENTE_CLIENTE');
      const pendingNotary = expedientes.filter((exp) => exp.estatus === 'PENDIENTE_NOTARIA');
      const missingDocs = expedientes.filter((exp) => exp.requisitos_docs.length > 0);
      const collection = canReadFinance ? expedientes.map((exp) => {
        const totals = budget(exp);
        const position = calculateFinancialPosition({
          totalCliente: totals.total,
          participacionPravia: totals.pravia,
          movements: exp.movimientosFinancieros.map((movement) => ({ ...movement, monto: Number(movement.monto) })),
        });
        return { expediente_id: exp.id, folio: exp.numero_pravia, cliente: exp.cliente_alias, saldo: position.saldo_cliente };
      }).filter((item) => item.saldo > 0) : [];

      const quoteFollowups = quotes.map((quote) => {
        const latest = quote.seguimientos[0];
        const due = latest?.fecha_proximo_seguimiento || quote.updated_at;
        const daysWithoutUpdate = Math.max(0, Math.floor((now.getTime() - new Date(quote.updated_at).getTime()) / 86_400_000));
        return {
          id: quote.id,
          numero: quote.numero_cotizacion || quote.numero_solicitud || 'Cotización sin folio',
          cliente: quote.prospecto?.nombre || 'Prospecto sin nombre',
          estado: quote.estado,
          fecha_seguimiento: due,
          dias_sin_actualizacion: daysWithoutUpdate,
        };
      }).filter((quote) => new Date(quote.fecha_seguimiento) <= nextWeek || quote.dias_sin_actualizacion >= 3);

      const notifications = await intelligentNotificationService.refreshAndList(req.user, { limit: 40 });
      const alerts = notifications.map((item) => ({
        id: item.id,
        severidad: item.priority === 'URGENT' ? 'ALTA' : item.priority === 'IMPORTANT' ? 'MEDIA' : 'BAJA',
        tipo: item.type,
        titulo: item.title,
        detalle: item.body,
        fecha: item.last_reminder_at || item.created_at,
        ruta: item.href,
        prioridad: item.priority,
        entidad: item.entity_type,
        entidad_id: item.entity_id,
      }));

      return res.json({
        success: true,
        generado_en: now,
        usuario_id: userId,
        permissions: { canViewFinance: canReadFinance },
        metricas: {
          tareas_hoy: todayTasks.length,
          tareas_vencidas: overdueTasks.length,
          citas_hoy: todayEvents.length,
          vencimientos_proximos: events.filter((event) => event.tipo === 'VENCIMIENTO').length,
          firmas_proximas: upcomingSignatures.length,
          expedientes_bloqueados: blocked.length,
          pendientes_cliente: pendingClient.length,
          pendientes_notaria: pendingNotary.length,
          cotizaciones_seguimiento: quoteFollowups.length,
          documentos_faltantes: missingDocs.reduce((sum, exp) => sum + exp.requisitos_docs.length, 0),
          cobros_pendientes: collection.length,
          saldo_pendiente_total: collection.reduce((sum, item) => sum + item.saldo, 0),
          ingresos_pendientes_aplicacion: pendingExp008Income.length,
          solicitudes_pago_pendientes: pendingExp008Requests.length,
        },
        tareas: { hoy: todayTasks, vencidas: overdueTasks, siguientes: tasks.filter((task) => !todayTasks.includes(task) && !overdueTasks.includes(task)).slice(0, 20) },
        eventos: { hoy: todayEvents, proximos: events.filter((event) => !todayEvents.includes(event)).slice(0, 30) },
        operacion: {
          firmas_proximas: upcomingSignatures,
          bloqueados: blocked,
          pendientes_cliente: pendingClient,
          pendientes_notaria: pendingNotary,
          documentos_faltantes: missingDocs,
          cotizaciones_seguimiento: quoteFollowups,
          cobranza: collection,
          recientes: expedientes.slice(0, 8),
        },
        alertas: alerts,
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'No fue posible preparar Mi Día.', detail: error.message });
    }
  }
}
