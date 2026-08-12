import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { calculateFinancialPosition } from '../domain/financialLedger';

const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

function reportingPeriod(query: Request['query']) {
  const now = new Date();
  const period = String(query.periodo || 'ESTE_MES').toUpperCase();
  let from: Date;
  let to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (period === 'HOY') from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  else if (period === 'ESTA_SEMANA') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  } else if (period === 'ESTE_ANO') from = new Date(now.getFullYear(), 0, 1);
  else if (period === 'TODOS') from = new Date('2000-01-01T00:00:00');
  else if (period === 'PERSONALIZADO') {
    from = new Date(String(query.desde || ''));
    to = new Date(String(query.hasta || ''));
    to.setHours(23, 59, 59, 999);
  } else from = new Date(now.getFullYear(), now.getMonth(), 1);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) throw new Error('El periodo solicitado no es válido.');
  return { from, to, period };
}

function budgetFor(exp: any) {
  const budget = exp?.datos_operacion?.presupuesto;
  const totalCliente = numberValue(budget?.total_cliente ?? exp?.cotizacion?.total_cliente);
  const pravia = numberValue(budget?.honorarios_pravia ?? exp?.cotizacion?.honorarios_pravia);
  return { totalCliente, pravia };
}

function group(items: any[], key: (item: any) => string, label: (item: any) => string) {
  const map = new Map<string, { id: string; nombre: string; total: number }>();
  for (const item of items) {
    const id = key(item);
    const current = map.get(id) || { id, nombre: label(item), total: 0 };
    current.total += 1;
    map.set(id, current);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre));
}

export class ReportesController {
  static async summary(req: Request, res: Response) {
    try {
      const { from, to, period } = reportingPeriod(req.query);
      const where = {
        archived_at: null,
        fecha_apertura: { gte: from, lte: to },
        ...(req.query.abogado_id && req.query.abogado_id !== 'TODOS' ? { abogado_id: String(req.query.abogado_id) } : {}),
        ...(req.query.gestor_id && req.query.gestor_id !== 'TODOS' ? { gestor_id: String(req.query.gestor_id) } : {}),
        ...(req.query.notaria_id && req.query.notaria_id !== 'TODOS' ? { notaria_id: String(req.query.notaria_id) } : {}),
        ...(req.query.tipo_acto_id && req.query.tipo_acto_id !== 'TODOS' ? { tipo_acto_id: String(req.query.tipo_acto_id) } : {}),
        ...(req.query.estatus && req.query.estatus !== 'TODOS' ? { estatus: req.query.estatus as any } : {}),
      };
      const abogadoId = req.query.abogado_id && req.query.abogado_id !== 'TODOS' ? String(req.query.abogado_id) : undefined;
      const notariaId = req.query.notaria_id && req.query.notaria_id !== 'TODOS' ? String(req.query.notaria_id) : undefined;
      const prospectoWhere = {
        archived_at: null,
        created_at: { gte: from, lte: to },
        ...(abogadoId ? { user_id: abogadoId } : {}),
        ...(notariaId ? { cotizacion: { is: { notaria_id: notariaId } } } : {}),
      };
      const cotizacionWhere = {
        created_at: { gte: from, lte: to },
        ...(abogadoId ? { user_id: abogadoId } : {}),
        ...(notariaId ? { notaria_id: notariaId } : {}),
      };
      const [expedientes, prospectos, cotizaciones] = await Promise.all([
        prisma.expediente.findMany({
          where,
          include: {
            tipo_acto: { select: { id: true, nombre: true } },
            notaria: { select: { id: true, nombre: true } },
            abogado: { select: { id: true, nombre: true, apellido: true } },
            gestor: { select: { id: true, nombre: true, apellido: true } },
            cotizacion: true,
            movimientosFinancieros: true,
          },
          orderBy: { fecha_apertura: 'asc' },
        }),
        prisma.prospecto.findMany({
          where: prospectoWhere,
          select: { id: true, cotizacion: { select: { id: true } } },
        }),
        prisma.cotizacion.findMany({
          where: cotizacionWhere,
          select: { id: true, expediente: { select: { id: true } } },
        }),
      ]);

      const openStatuses = ['ABIERTO', 'EN_INTEGRACION', 'EN_PROCESO', 'PENDIENTE_CLIENTE', 'PENDIENTE_NOTARIA', 'FIRMA_PROGRAMADA', 'FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'SUSPENDIDO'];
      const signed = expedientes.filter((item) => item.fecha_real_firma || ['FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'ENTREGADO'].includes(item.estatus));
      const delivered = expedientes.filter((item) => item.estatus === 'ENTREGADO' || item.fecha_entrega_cliente);
      const completionDays = delivered
        .map((item) => item.fecha_entrega_cliente ? (new Date(item.fecha_entrega_cliente).getTime() - new Date(item.fecha_apertura).getTime()) / 86_400_000 : null)
        .filter((value): value is number => value !== null && value >= 0);

      const financial = expedientes.reduce((acc, exp) => {
        const budget = budgetFor(exp);
        const position = calculateFinancialPosition({
          totalCliente: budget.totalCliente,
          participacionPravia: budget.pravia,
          movements: exp.movimientosFinancieros.map((movement) => ({ ...movement, monto: Number(movement.monto) })),
        });
        acc.honorarios += budget.pravia;
        acc.ingresos += position.honorarios_pravia_recibidos;
        acc.pendiente += position.saldo_cliente;
        acc.participacion += budget.pravia;
        acc.egresos += position.egresos_terceros + position.egresos_pravia;
        acc.fondos_retenidos += position.fondos_retenidos;
        return acc;
      }, { honorarios: 0, ingresos: 0, pendiente: 0, participacion: 0, egresos: 0, fondos_retenidos: 0 });

      const monthlyMap = new Map<string, { periodo: string; nuevos: number; firmados: number; entregados: number }>();
      for (const exp of expedientes) {
        const date = new Date(exp.fecha_apertura);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const current = monthlyMap.get(key) || { periodo: key, nuevos: 0, firmados: 0, entregados: 0 };
        current.nuevos += 1;
        if (exp.fecha_real_firma || ['FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'ENTREGADO'].includes(exp.estatus)) current.firmados += 1;
        if (exp.estatus === 'ENTREGADO' || exp.fecha_entrega_cliente) current.entregados += 1;
        monthlyMap.set(key, current);
      }

      return res.json({
        success: true,
        periodo: { clave: period, desde: from, hasta: to },
        kpis: {
          expedientes_nuevos: expedientes.length,
          expedientes_abiertos: expedientes.filter((item) => openStatuses.includes(item.estatus)).length,
          expedientes_cerrados: expedientes.filter((item) => ['ENTREGADO', 'CANCELADO'].includes(item.estatus)).length,
          firmados: signed.length,
          entregados: delivered.length,
          tiempo_promedio_dias: completionDays.length ? Math.round((completionDays.reduce((sum, value) => sum + value, 0) / completionDays.length) * 10) / 10 : 0,
          honorarios_esperados: financial.honorarios,
          ingresos_recibidos_pravia: financial.ingresos,
          pendiente_clientes: financial.pendiente,
          participacion_pravia: financial.participacion,
          egresos: financial.egresos,
          fondos_retenidos: financial.fondos_retenidos,
          conversion_prospecto_cotizacion: prospectos.length ? Math.round((prospectos.filter((item) => item.cotizacion).length / prospectos.length) * 1000) / 10 : 0,
          conversion_cotizacion_expediente: cotizaciones.length ? Math.round((cotizaciones.filter((item) => item.expediente).length / cotizaciones.length) * 1000) / 10 : 0,
        },
        desglose: {
          por_tipo_acto: group(expedientes, (item) => item.tipo_acto_id, (item) => item.tipo_acto?.nombre || 'Sin tipo'),
          por_notaria: group(expedientes, (item) => item.notaria_id || 'SIN_NOTARIA', (item) => item.notaria?.nombre || 'Sin notaría'),
          por_abogado: group(expedientes, (item) => item.abogado_id, (item) => `${item.abogado.nombre} ${item.abogado.apellido}`.trim()),
          por_gestor: group(expedientes, (item) => item.gestor_id || 'SIN_GESTOR', (item) => item.gestor ? `${item.gestor.nombre} ${item.gestor.apellido}`.trim() : 'Sin gestor'),
          por_estatus: group(expedientes, (item) => item.estatus, (item) => item.estatus),
          tendencia: [...monthlyMap.values()],
        },
      });
    } catch (error: any) {
      return res.status(400).json({ success: false, error: error.message || 'No fue posible generar el reporte.' });
    }
  }

  static async catalogs(_req: Request, res: Response) {
    try {
      const [usuarios, notarias, tiposActo] = await Promise.all([
        prisma.user.findMany({ where: { activo: true }, select: { id: true, nombre: true, apellido: true, rol: true }, orderBy: { nombre: 'asc' } }),
        prisma.notaria.findMany({ where: { activa: true, archived_at: null }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } }),
        prisma.tipoActo.findMany({ where: { activo: true, archived_at: null }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } }),
      ]);
      return res.json({ success: true, catalogos: { usuarios, notarias, tipos_acto: tiposActo } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'No fue posible cargar los filtros.', detail: error.message });
    }
  }
}
