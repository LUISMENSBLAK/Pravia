import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { calculateFinancialPosition } from '../domain/financialLedger';
import { expedienteAccessWhere } from '../middleware/auth.middleware';

const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

function budget(exp: any) {
  const data = exp?.datos_operacion?.presupuesto;
  return {
    total: asNumber(data?.total_cliente ?? exp?.cotizacion?.total_cliente),
    pravia: asNumber(data?.honorarios_pravia ?? exp?.cotizacion?.honorarios_pravia),
  };
}

export class MiDiaController {
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

      const [tasks, events, expedientes, quotes] = await Promise.all([
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

      const alerts = [
        ...overdueTasks.map((task) => ({ id: `task-${task.id}`, severidad: 'ALTA', tipo: 'TAREA_VENCIDA', titulo: task.titulo, detalle: task.expediente?.numero_pravia || 'Tarea personal', fecha: task.fecha_limite, ruta: task.expediente_id ? `/expedientes/${task.expediente_id}` : '/agenda' })),
        ...upcomingSignatures.map((exp) => ({ id: `signature-${exp.id}`, severidad: 'ALTA', tipo: 'FIRMA_PROXIMA', titulo: `Firma próxima: ${exp.numero_pravia}`, detalle: exp.cliente_alias || 'Cliente sin identificar', fecha: exp.fecha_estimada_firma, ruta: `/expedientes/${exp.id}` })),
        ...blocked.map((exp) => ({ id: `blocked-${exp.id}`, severidad: 'ALTA', tipo: 'EXPEDIENTE_BLOQUEADO', titulo: `Expediente bloqueado: ${exp.numero_pravia}`, detalle: exp.tareas_externas[0]?.descripcion || 'Expediente suspendido', fecha: exp.updated_at, ruta: `/expedientes/${exp.id}` })),
        ...missingDocs.slice(0, 15).map((exp) => ({ id: `docs-${exp.id}`, severidad: 'MEDIA', tipo: 'DOCUMENTOS_FALTANTES', titulo: `${exp.requisitos_docs.length} documento(s) pendiente(s)`, detalle: `${exp.numero_pravia} · ${exp.requisitos_docs[0]?.nombre}`, fecha: exp.requisitos_docs[0]?.fecha_vencimiento || exp.updated_at, ruta: `/expedientes/${exp.id}` })),
        ...collection.slice(0, 15).map((item) => ({ id: `collection-${item.expediente_id}`, severidad: 'MEDIA', tipo: 'COBRO_PENDIENTE', titulo: `Cobro pendiente: ${item.folio}`, detalle: `$${item.saldo.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`, fecha: null, ruta: `/expedientes/${item.expediente_id}` })),
      ].sort((a, b) => (a.severidad === b.severidad ? 0 : a.severidad === 'ALTA' ? -1 : 1)).slice(0, 40);

      return res.json({
        success: true,
        generado_en: now,
        usuario_id: userId,
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
        },
        alertas: alerts,
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'No fue posible preparar Mi Día.', detail: error.message });
    }
  }
}
