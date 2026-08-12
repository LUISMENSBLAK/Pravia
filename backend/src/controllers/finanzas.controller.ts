import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { calculateFinancialPosition } from '../domain/financialLedger';

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** El presupuesto operativo guardado en el expediente es la fuente vigente. */
const getOperationalBudget = (exp: any) => {
  const presupuesto = exp?.datos_operacion?.presupuesto;

  if (presupuesto && typeof presupuesto === 'object') {
    const totalNotaria = presupuesto.total_notaria !== undefined
      ? toFiniteNumber(presupuesto.total_notaria)
      : Array.isArray(presupuesto.rubros)
        ? presupuesto.rubros.reduce((sum: number, rubro: any) => sum + toFiniteNumber(rubro?.monto), 0)
        : toFiniteNumber(exp?.cotizacion?.total_notaria);
    const participacionPravia = presupuesto.honorarios_pravia !== undefined
      ? toFiniteNumber(presupuesto.honorarios_pravia)
      : toFiniteNumber(exp?.cotizacion?.honorarios_pravia);
    const totalPresupuestado = presupuesto.total_cliente !== undefined
      ? toFiniteNumber(presupuesto.total_cliente)
      : totalNotaria;

    return { totalPresupuestado, totalNotaria, participacionPravia };
  }

  return {
    totalPresupuestado: toFiniteNumber(exp?.cotizacion?.total_cliente),
    totalNotaria: toFiniteNumber(exp?.cotizacion?.total_notaria),
    participacionPravia: toFiniteNumber(exp?.cotizacion?.honorarios_pravia)
  };
};

export class FinanzasController {
  /**
   * GET /api/finanzas/resumen
   * Tablero superior + Listado consolidado por expediente
   */
  public static async getResumenFinanciero(req: Request, res: Response) {
    try {
      const {
        search,
        periodo,
        fecha_desde,
        fecha_hasta,
        notaria_id,
        abogado_id,
        tipo_acto_id,
        estatus_expediente,
        estado_cobro
      } = req.query;

      // 1. Consultar expedientes activos con sus datos financieros
      const expedientes = await prisma.expediente.findMany({
        where: {
          archived_at: null,
          ...(notaria_id && typeof notaria_id === 'string' && notaria_id !== 'TODOS' ? { notaria_id } : {}),
          ...(abogado_id && typeof abogado_id === 'string' && abogado_id !== 'TODOS' ? { abogado_id } : {}),
          ...(tipo_acto_id && typeof tipo_acto_id === 'string' && tipo_acto_id !== 'TODOS' ? { tipo_acto_id } : {}),
          ...(estatus_expediente && typeof estatus_expediente === 'string' && estatus_expediente !== 'TODOS'
            ? { estatus: estatus_expediente as any }
            : {})
        },
        include: {
          tipo_acto: true,
          notaria: true,
          abogado: { select: { id: true, nombre: true, apellido: true } },
          cotizacion: {
            include: { versiones: true }
          },
          comparecientes: {
            include: {
              compareciente: {
                include: {
                  personaFisica: true,
                  personaMoral: true
                }
              }
            }
          },
          movimientosFinancieros: {
            include: {
              capturado_por: { select: { id: true, nombre: true, apellido: true } }
            }
          },
          pagos: true
        },
        orderBy: { created_at: 'desc' }
      });

      // 2. Procesar expediente por expediente
      let itemsFinancieros = expedientes.map((exp) => {
        const { totalPresupuestado, totalNotaria, participacionPravia } = getOperationalBudget(exp);

        const activeMovements = exp.movimientosFinancieros.filter((m) => ['VALIDADO', 'RECIBIDO'].includes(m.estatus));
        const ledgerMovements = activeMovements.length > 0
          ? activeMovements.map((movement) => ({ ...movement, monto: Number(movement.monto) }))
          : exp.pagos
              .filter((payment) => ['VALIDADO', 'RECIBIDO'].includes(payment.estatus))
              .map((payment) => ({
                naturaleza: 'INGRESO' as const,
                categoria: ['HONORARIOS_RECIBIDOS', 'INGRESO_REAL_RECIBIDO'].includes(payment.categoria_ingreso)
                  ? 'HONORARIOS_PRAVIA'
                  : 'CLIENTE_FONDOS',
                tipo_movimiento: 'ABONO',
                monto: Number(payment.monto),
                estatus: payment.estatus,
              }));
        const position = calculateFinancialPosition({
          totalCliente: totalPresupuestado,
          participacionPravia,
          movements: ledgerMovements,
        });
        const cobradoNeto = position.recibido_cliente_neto;
        const saldoPendiente = position.saldo_cliente;
        const egresado = position.egresos_terceros + position.egresos_pravia;
        const pendienteEgresos = position.saldo_terceros;

        // Participación PRAVIA (Honorarios presupuestados)
        const praviaTotal = participacionPravia;

        // Expediente firmado determina Honorarios Generados
        const esFirmado = !!(
          exp.fecha_real_firma ||
          ['FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'ENTREGADO'].includes(exp.estatus)
        );

        const honorariosGenerados = esFirmado ? praviaTotal : 0;

        // El ingreso PRAVIA solo existe cuando el movimiento fue clasificado explícitamente.
        const ingresoRealHonorarios = position.honorarios_pravia_recibidos;

        // Estado Financiero exacto del expediente
        let estadoFinanciero:
          | 'SIN_MOVIMIENTOS'
          | 'ANTICIPO_RECIBIDO'
          | 'PAGO_PARCIAL'
          | 'PENDIENTE_LIQUIDAR'
          | 'LIQUIDADO'
          | 'CON_EGRESOS_PENDIENTES' = 'SIN_MOVIMIENTOS';

        if (totalPresupuestado > 0) {
          if (saldoPendiente <= 0) {
            estadoFinanciero = 'LIQUIDADO';
          } else if (cobradoNeto > 0) {
            const porcentajeCobro = cobradoNeto / totalPresupuestado;
            if (porcentajeCobro >= 0.9) {
              estadoFinanciero = 'PAGO_PARCIAL';
            } else if (porcentajeCobro >= 0.3) {
              estadoFinanciero = 'ANTICIPO_RECIBIDO';
            } else {
              estadoFinanciero = 'PENDIENTE_LIQUIDAR';
            }
          } else {
            estadoFinanciero = 'PENDIENTE_LIQUIDAR';
          }
        }
        if (pendienteEgresos > 0 && estadoFinanciero !== 'LIQUIDADO') {
          estadoFinanciero = 'CON_EGRESOS_PENDIENTES';
        }

        // Nombre del Cliente Principal
        const comparecientePrincipal = exp.comparecientes[0]?.compareciente;
        const nombreCliente = comparecientePrincipal
          ? comparecientePrincipal.personaFisica
            ? comparecientePrincipal.personaFisica.nombre_completo_calculado
            : comparecientePrincipal.personaMoral
            ? comparecientePrincipal.personaMoral.razon_social
            : comparecientePrincipal.nombre_busqueda
          : exp.cliente_alias || 'Cliente sin registrar';

        const nombreAbogado = exp.abogado
          ? `${exp.abogado.nombre || ''} ${exp.abogado.apellido || ''}`.trim()
          : 'Sin asignar';

        return {
          expediente_id: exp.id,
          folio: exp.numero_pravia,
          cliente: nombreCliente,
          tipo_acto: exp.tipo_acto?.nombre || 'General / No Especificado',
          tipo_acto_id: exp.tipo_acto_id,
          notaria: exp.notaria ? exp.notaria.nombre : 'Sin notaría asignada',
          notaria_id: exp.notaria_id,
          notaria_numero: exp.notaria?.numero_notaria || null,
          abogado: nombreAbogado,
          abogado_id: exp.abogado_id,
          fecha_apertura: exp.fecha_apertura,
          fecha_firma: exp.fecha_real_firma || exp.fecha_estimada_firma || null,
          estatus_expediente: exp.estatus,
          total_presupuestado: totalPresupuestado,
          participacion_pravia: praviaTotal,
          total_cobrado: cobradoNeto,
          saldo_pendiente: saldoPendiente,
          total_egresado: egresado,
          pendiente_egresos: pendienteEgresos,
          saldo_terceros: position.saldo_terceros,
          fondos_retenidos: position.fondos_retenidos,
          utilidad_pravia: position.utilidad_pravia,
          egresos_pravia: position.egresos_pravia,
          honorarios_generados: honorariosGenerados,
          ingreso_real_honorarios: ingresoRealHonorarios,
          estado_financiero: estadoFinanciero,
          created_at: exp.created_at
        };
      });

      // 3. Aplicar Filtro de Periodo de Fechas
      const ahora = new Date();
      if (periodo && typeof periodo === 'string' && periodo !== 'TODOS') {
        itemsFinancieros = itemsFinancieros.filter((item) => {
          const f = new Date(item.fecha_apertura);
          if (periodo === 'HOY') {
            return f.toDateString() === ahora.toDateString();
          } else if (periodo === 'ESTA_SEMANA') {
            const inicioSemana = new Date(ahora);
            inicioSemana.setDate(ahora.getDate() - ahora.getDay());
            inicioSemana.setHours(0, 0, 0, 0);
            return f >= inicioSemana;
          } else if (periodo === 'ESTE_MES') {
            return f.getMonth() === ahora.getMonth() && f.getFullYear() === ahora.getFullYear();
          } else if (periodo === 'ESTE_ANO') {
            return f.getFullYear() === ahora.getFullYear();
          }
          return true;
        });
      }

      if (fecha_desde && typeof fecha_desde === 'string' && fecha_desde.trim() !== '') {
        const dDesde = new Date(fecha_desde);
        if (!isNaN(dDesde.getTime())) {
          itemsFinancieros = itemsFinancieros.filter((item) => new Date(item.fecha_apertura) >= dDesde);
        }
      }

      if (fecha_hasta && typeof fecha_hasta === 'string' && fecha_hasta.trim() !== '') {
        const dHasta = new Date(fecha_hasta);
        if (!isNaN(dHasta.getTime())) {
          dHasta.setHours(23, 59, 59, 999);
          itemsFinancieros = itemsFinancieros.filter((item) => new Date(item.fecha_apertura) <= dHasta);
        }
      }

      // Filtro de Estado de Cobro (Pagado / Pendiente)
      if (estado_cobro && typeof estado_cobro === 'string' && estado_cobro !== 'TODOS') {
        if (estado_cobro === 'PAGADO') {
          itemsFinancieros = itemsFinancieros.filter((item) => item.saldo_pendiente <= 0);
        } else if (estado_cobro === 'PENDIENTE') {
          itemsFinancieros = itemsFinancieros.filter((item) => item.saldo_pendiente > 0);
        }
      }

      // Filtro de Búsqueda Omnicanal (Folio, Cliente, Acto, Notaría, Abogado)
      if (search && typeof search === 'string' && search.trim() !== '') {
        const q = search.trim().toLowerCase();
        itemsFinancieros = itemsFinancieros.filter(
          (item) =>
            item.folio.toLowerCase().includes(q) ||
            item.cliente.toLowerCase().includes(q) ||
            item.tipo_acto.toLowerCase().includes(q) ||
            item.notaria.toLowerCase().includes(q) ||
            item.abogado.toLowerCase().includes(q)
        );
      }

      // 4. Calcular los 8 Indicadores Globales del Tablero Superior
      const kpis = {
        honorarios_esperados: itemsFinancieros.reduce((sum, item) => sum + item.participacion_pravia, 0),
        honorarios_generados: itemsFinancieros.reduce((sum, item) => sum + item.honorarios_generados, 0),
        ingreso_real_recibido: itemsFinancieros.reduce((sum, item) => sum + item.ingreso_real_honorarios, 0),
        total_cobrado_clientes: itemsFinancieros.reduce((sum, item) => sum + item.total_cobrado, 0),
        pendiente_cobro: itemsFinancieros.reduce((sum, item) => sum + item.saldo_pendiente, 0),
        egresos_realizados: itemsFinancieros.reduce((sum, item) => sum + item.total_egresado, 0),
        pendiente_pago: itemsFinancieros.reduce((sum, item) => sum + item.pendiente_egresos, 0),
        saldo_terceros: itemsFinancieros.reduce((sum, item) => sum + item.saldo_terceros, 0),
        fondos_retenidos: itemsFinancieros.reduce((sum, item) => sum + item.fondos_retenidos, 0),
        utilidad_pravia: itemsFinancieros.reduce((sum, item) => sum + item.utilidad_pravia, 0),
        participacion_pravia: itemsFinancieros.reduce((sum, item) => sum + item.participacion_pravia, 0),
        total_presupuestado_general: itemsFinancieros.reduce((sum, item) => sum + item.total_presupuestado, 0)
      };

      return res.status(200).json({
        success: true,
        kpis,
        expedientes: itemsFinancieros,
        meta: {
          total_registros: itemsFinancieros.length
        }
      });
    } catch (err: any) {
      console.error('[FinanzasController] Error al obtener resumen:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/finanzas/movimientos
   * Historial consolidado global de movimientos de ingresos y egresos
   */
  public static async getMovimientosGlobales(req: Request, res: Response) {
    try {
      const { search, naturaleza, tipo_movimiento, categoria, estatus, fecha_desde, fecha_hasta } = req.query;

      const movimientos = await prisma.movimientoFinanciero.findMany({
        where: {
          ...(naturaleza && typeof naturaleza === 'string' && naturaleza !== 'TODOS'
            ? { naturaleza: naturaleza as any }
            : {}),
          ...(tipo_movimiento && typeof tipo_movimiento === 'string' && tipo_movimiento !== 'TODOS'
            ? { tipo_movimiento: tipo_movimiento as any }
            : {}),
          ...(categoria && typeof categoria === 'string' && categoria !== 'TODOS' ? { categoria } : {}),
          ...(estatus && typeof estatus === 'string' && estatus !== 'TODOS'
            ? { estatus: estatus as any }
            : {})
        },
        include: {
          expediente: {
            select: {
              id: true,
              numero_pravia: true,
              cliente_alias: true,
              tipo_acto: { select: { nombre: true } },
              comparecientes: {
                include: {
                  compareciente: {
                    include: { personaFisica: true, personaMoral: true }
                  }
                }
              }
            }
          },
          capturado_por: { select: { id: true, nombre: true, apellido: true } },
          validado_por: { select: { id: true, nombre: true, apellido: true } },
          revertido_por: { select: { id: true, nombre: true, apellido: true } }
        },
        orderBy: { fecha_movimiento: 'desc' }
      });

      let items = movimientos.map((m) => {
        const exp = m.expediente;
        const comparecientePrincipal = exp?.comparecientes[0]?.compareciente;
        const nombreCliente = comparecientePrincipal
          ? comparecientePrincipal.personaFisica
            ? comparecientePrincipal.personaFisica.nombre_completo_calculado
            : comparecientePrincipal.personaMoral
            ? comparecientePrincipal.personaMoral.razon_social
            : comparecientePrincipal.nombre_busqueda
          : exp?.cliente_alias || 'Sin expedición';

        return {
          id: m.id,
          fecha: m.fecha_movimiento,
          expediente_id: m.expediente_id,
          folio_expediente: exp?.numero_pravia || 'General',
          cliente: nombreCliente,
          tipo_movimiento: m.tipo_movimiento,
          naturaleza: m.naturaleza,
          categoria: m.categoria,
          concepto: m.concepto,
          monto: Number(m.monto),
          forma_pago: m.forma_pago || 'No especificado',
          referencia: m.referencia || null,
          usuario_registro: m.capturado_por
            ? `${m.capturado_por.nombre || ''} ${m.capturado_por.apellido || ''}`.trim()
            : 'Sistema',
          estatus: m.estatus,
          comprobante_url: m.comprobante_url || null,
          factura_url: m.factura_url || null,
          motivo_reversion: m.motivo_reversion || null
        };
      });

      if (search && typeof search === 'string' && search.trim() !== '') {
        const q = search.trim().toLowerCase();
        items = items.filter(
          (m) =>
            m.folio_expediente.toLowerCase().includes(q) ||
            m.cliente.toLowerCase().includes(q) ||
            m.concepto.toLowerCase().includes(q) ||
            m.categoria.toLowerCase().includes(q) ||
            m.monto.toString().includes(q)
        );
      }

      if (fecha_desde && typeof fecha_desde === 'string' && fecha_desde.trim() !== '') {
        const dDesde = new Date(fecha_desde);
        if (!isNaN(dDesde.getTime())) {
          items = items.filter((m) => new Date(m.fecha) >= dDesde);
        }
      }

      if (fecha_hasta && typeof fecha_hasta === 'string' && fecha_hasta.trim() !== '') {
        const dHasta = new Date(fecha_hasta);
        if (!isNaN(dHasta.getTime())) {
          dHasta.setHours(23, 59, 59, 999);
          items = items.filter((m) => new Date(m.fecha) <= dHasta);
        }
      }

      return res.status(200).json({
        success: true,
        movimientos: items,
        total: items.length
      });
    } catch (err: any) {
      console.error('[FinanzasController] Error al obtener movimientos globales:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/finanzas/cobranza
   * Pestaña Cobranza: Expedientes con saldos pendientes por recuperar
   */
  public static async getCobranza(req: Request, res: Response) {
    try {
      const { search } = req.query;

      const expedientes = await prisma.expediente.findMany({
        where: { archived_at: null },
        include: {
          tipo_acto: true,
          notaria: true,
          abogado: { select: { id: true, nombre: true, apellido: true } },
          cotizacion: true,
          comparecientes: {
            include: {
              compareciente: {
                include: { personaFisica: true, personaMoral: true }
              }
            }
          },
          movimientosFinancieros: true,
          pagos: { where: { estatus: { in: ['VALIDADO', 'RECIBIDO'] } } }
        },
        orderBy: { created_at: 'desc' }
      });

      const ahora = new Date();

      let cobranzaList = expedientes
        .map((exp) => {
          const { totalPresupuestado, participacionPravia } = getOperationalBudget(exp);
          const activeMovements = exp.movimientosFinancieros.filter((m) =>
            ['VALIDADO', 'RECIBIDO'].includes(m.estatus),
          );
          const ledgerMovements = activeMovements.length > 0
            ? activeMovements.map((movement) => ({ ...movement, monto: Number(movement.monto) }))
            : exp.pagos.map((payment) => ({
                naturaleza: 'INGRESO' as const,
                categoria: ['HONORARIOS_RECIBIDOS', 'INGRESO_REAL_RECIBIDO'].includes(payment.categoria_ingreso)
                  ? 'HONORARIOS_PRAVIA'
                  : 'CLIENTE_FONDOS',
                tipo_movimiento: 'ABONO',
                monto: Number(payment.monto),
                estatus: payment.estatus,
              }));
          const position = calculateFinancialPosition({
            totalCliente: totalPresupuestado,
            participacionPravia,
            movements: ledgerMovements,
          });
          const cobrado = position.recibido_cliente_neto;
          const saldo = position.saldo_cliente;

          if (saldo <= 0) return null; // Solo pendientes de cobro

          const comparecientePrincipal = exp.comparecientes[0]?.compareciente;
          const cliente = comparecientePrincipal
            ? comparecientePrincipal.personaFisica
              ? comparecientePrincipal.personaFisica.nombre_completo_calculado
              : comparecientePrincipal.personaMoral
              ? comparecientePrincipal.personaMoral.razon_social
              : comparecientePrincipal.nombre_busqueda
            : exp.cliente_alias || 'Cliente sin registrar';

          const abogado = exp.abogado
            ? `${exp.abogado.nombre || ''} ${exp.abogado.apellido || ''}`.trim()
            : 'Sin asignar';

          const fechaFirma = exp.fecha_real_firma || exp.fecha_estimada_firma || null;

          // Cálculo de alerta operacional
          let alerta: 'FIRMA_PROXIMA_CON_SALDO' | 'FIRMADO_CON_SALDO' | 'ATRASADO' | 'PENDIENTE_ORDINARIO' = 'PENDIENTE_ORDINARIO';
          let diasAtraso = 0;

          if (exp.fecha_real_firma || ['FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'ENTREGADO'].includes(exp.estatus)) {
            alerta = 'FIRMADO_CON_SALDO';
            if (exp.fecha_real_firma) {
              const diffMs = ahora.getTime() - new Date(exp.fecha_real_firma).getTime();
              diasAtraso = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
            }
          } else if (exp.fecha_estimada_firma) {
            const diffMs = new Date(exp.fecha_estimada_firma).getTime() - ahora.getTime();
            const diasFirma = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            if (diasFirma >= 0 && diasFirma <= 7) {
              alerta = 'FIRMA_PROXIMA_CON_SALDO';
            } else if (diasFirma < 0) {
              alerta = 'ATRASADO';
              diasAtraso = Math.abs(diasFirma);
            }
          }

          return {
            expediente_id: exp.id,
            folio: exp.numero_pravia,
            cliente,
            tipo_acto: exp.tipo_acto?.nombre || 'General / No Especificado',
            notaria: exp.notaria ? exp.notaria.nombre : 'Sin notaria',
            abogado,
            total_operacion: totalPresupuestado,
            pagado: cobrado,
            saldo,
            fecha_firma: fechaFirma,
            dias_atraso: diasAtraso,
            alerta,
            estatus_expediente: exp.estatus
          };
        })
        .filter(Boolean) as any[];

      if (search && typeof search === 'string' && search.trim() !== '') {
        const q = search.trim().toLowerCase();
        cobranzaList = cobranzaList.filter(
          (c) =>
            c.folio.toLowerCase().includes(q) ||
            c.cliente.toLowerCase().includes(q) ||
            c.abogado.toLowerCase().includes(q)
        );
      }

      const kpisCobranza = {
        total_por_cobrar: cobranzaList.reduce((sum, item) => sum + item.saldo, 0),
        expedientes_con_saldo: cobranzaList.length,
        firmados_con_saldo: cobranzaList.filter((item) => item.alerta === 'FIRMADO_CON_SALDO').length,
        firmas_proximas_con_saldo: cobranzaList.filter((item) => item.alerta === 'FIRMA_PROXIMA_CON_SALDO').length
      };

      return res.status(200).json({
        success: true,
        kpis: kpisCobranza,
        cobranza: cobranzaList
      });
    } catch (err: any) {
      console.error('[FinanzasController] Error al obtener cobranza:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/finanzas/egresos
   * Pestaña Egresos: Desglose y pagos a terceros, notaría, dependencias, etc.
   */
  public static async getEgresosGlobales(req: Request, res: Response) {
    try {
      const { search, categoria } = req.query;

      const egresosMovs = await prisma.movimientoFinanciero.findMany({
        where: {
          naturaleza: 'EGRESO',
          estatus: { in: ['VALIDADO', 'RECIBIDO'] },
          ...(categoria && typeof categoria === 'string' && categoria !== 'TODOS' ? { categoria } : {})
        },
        include: {
          expediente: {
            select: {
              id: true,
              numero_pravia: true,
              cliente_alias: true,
              notaria: { select: { nombre: true, numero_notaria: true } },
              tipo_acto: { select: { nombre: true } }
            }
          },
          capturado_por: { select: { id: true, nombre: true, apellido: true } }
        },
        orderBy: { fecha_movimiento: 'desc' }
      });

      let items = egresosMovs.map((m) => ({
        id: m.id,
        fecha: m.fecha_movimiento,
        expediente_id: m.expediente_id,
        folio_expediente: m.expediente?.numero_pravia || 'General',
        cliente: m.expediente?.cliente_alias || 'Cliente sin registrar',
        notaria: m.expediente?.notaria?.nombre || 'N/A',
        tipo_movimiento: m.tipo_movimiento,
        categoria: m.categoria || 'Terceros',
        concepto: m.concepto,
        monto: Number(m.monto),
        forma_pago: m.forma_pago || 'No especificado',
        estatus: m.estatus,
        comprobante_url: m.comprobante_url || null,
        factura_url: m.factura_url || null
      }));

      if (search && typeof search === 'string' && search.trim() !== '') {
        const q = search.trim().toLowerCase();
        items = items.filter(
          (m) =>
            m.folio_expediente.toLowerCase().includes(q) ||
            m.cliente.toLowerCase().includes(q) ||
            m.concepto.toLowerCase().includes(q) ||
            m.categoria.toLowerCase().includes(q)
        );
      }

      // Agrupar por Categoría de egreso
      const porCategoria: Record<string, number> = {};
      items.forEach((item) => {
        porCategoria[item.categoria] = (porCategoria[item.categoria] || 0) + item.monto;
      });

      const totalEgresosRealizados = items.reduce((sum, item) => sum + item.monto, 0);

      return res.status(200).json({
        success: true,
        summary: {
          total_egresos_realizados: totalEgresosRealizados,
          por_categoria: porCategoria
        },
        egresos: items
      });
    } catch (err: any) {
      console.error('[FinanzasController] Error al obtener egresos globales:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/finanzas/honorarios
   * Pestaña Honorarios PRAVIA: Honorarios esperados, generados, cobrados y analítica por Abogado/Notaría/Acto
   */
  public static async getHonorariosPravia(req: Request, res: Response) {
    try {
      const { abogado_id, notaria_id, tipo_acto_id } = req.query;

      const expedientes = await prisma.expediente.findMany({
        where: {
          archived_at: null,
          ...(abogado_id && typeof abogado_id === 'string' && abogado_id !== 'TODOS' ? { abogado_id } : {}),
          ...(notaria_id && typeof notaria_id === 'string' && notaria_id !== 'TODOS' ? { notaria_id } : {}),
          ...(tipo_acto_id && typeof tipo_acto_id === 'string' && tipo_acto_id !== 'TODOS' ? { tipo_acto_id } : {})
        },
        include: {
          tipo_acto: true,
          notaria: true,
          abogado: { select: { id: true, nombre: true, apellido: true } },
          cotizacion: true,
          movimientosFinancieros: { where: { naturaleza: 'INGRESO', estatus: { in: ['VALIDADO', 'RECIBIDO'] } } }
        }
      });

      let honorariosEsperados = 0;
      let honorariosGenerados = 0;
      let honorariosCobrados = 0;

      const porAbogado: Record<string, { nombre: string; esperados: number; generados: number; cobrados: number }> = {};
      const porNotaria: Record<string, { nombre: string; esperados: number; generados: number; cobrados: number }> = {};
      const porTipoActo: Record<string, { nombre: string; esperados: number; generados: number; cobrados: number }> = {};

      expedientes.forEach((exp) => {
        const {
          totalPresupuestado: totalCliente,
          participacionPravia: praviaTotal
        } = getOperationalBudget(exp);

        const position = calculateFinancialPosition({
          totalCliente,
          participacionPravia: praviaTotal,
          movements: exp.movimientosFinancieros.map((movement) => ({ ...movement, monto: Number(movement.monto) })),
        });
        const praviaCobrado = position.honorarios_pravia_recibidos;

        const esFirmado = !!(
          exp.fecha_real_firma ||
          ['FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'ENTREGADO'].includes(exp.estatus)
        );
        const praviaGenerado = esFirmado ? praviaTotal : 0;

        honorariosEsperados += praviaTotal;
        honorariosGenerados += praviaGenerado;
        honorariosCobrados += praviaCobrado;

        // Por Abogado
        const abogKey = exp.abogado_id;
        const abogNombre = exp.abogado ? `${exp.abogado.nombre} ${exp.abogado.apellido}` : 'Sin asignar';
        if (!porAbogado[abogKey]) {
          porAbogado[abogKey] = { nombre: abogNombre, esperados: 0, generados: 0, cobrados: 0 };
        }
        porAbogado[abogKey].esperados += praviaTotal;
        porAbogado[abogKey].generados += praviaGenerado;
        porAbogado[abogKey].cobrados += praviaCobrado;

        // Por Notaría
        const notKey = exp.notaria_id || 'SIN_NOTARIA';
        const notNombre = exp.notaria ? exp.notaria.nombre : 'Sin Notaría';
        if (!porNotaria[notKey]) {
          porNotaria[notKey] = { nombre: notNombre, esperados: 0, generados: 0, cobrados: 0 };
        }
        porNotaria[notKey].esperados += praviaTotal;
        porNotaria[notKey].generados += praviaGenerado;
        porNotaria[notKey].cobrados += praviaCobrado;

        // Por Tipo de Acto
        const actoKey = exp.tipo_acto_id;
        const actoNombre = exp.tipo_acto?.nombre || 'General';
        if (!porTipoActo[actoKey]) {
          porTipoActo[actoKey] = { nombre: actoNombre, esperados: 0, generados: 0, cobrados: 0 };
        }
        porTipoActo[actoKey].esperados += praviaTotal;
        porTipoActo[actoKey].generados += praviaGenerado;
        porTipoActo[actoKey].cobrados += praviaCobrado;
      });

      return res.status(200).json({
        success: true,
        kpis: {
          honorarios_esperados: honorariosEsperados,
          honorarios_generados: honorariosGenerados,
          honorarios_cobrados: honorariosCobrados,
          honorarios_pendientes: Math.max(0, honorariosEsperados - honorariosCobrados)
        },
        desglose: {
          por_abogado: Object.values(porAbogado),
          por_notaria: Object.values(porNotaria),
          por_tipo_acto: Object.values(porTipoActo)
        }
      });
    } catch (err: any) {
      console.error('[FinanzasController] Error al obtener honorarios PRAVIA:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/finanzas/catalogos
   * Opciones de filtro para desplegables (Notarías, Abogados, Tipos de Acto)
   */
  public static async getCatalogosFiltro(req: Request, res: Response) {
    try {
      const [notarias, abogados, tiposActo] = await Promise.all([
        prisma.notaria.findMany({
          where: { activa: true },
          select: { id: true, nombre: true, numero_notaria: true },
          orderBy: { numero_notaria: 'asc' }
        }),
        prisma.user.findMany({
          where: { activo: true },
          select: { id: true, nombre: true, apellido: true, rol: true },
          orderBy: { nombre: 'asc' }
        }),
        prisma.tipoActo.findMany({
          where: { activo: true },
          select: { id: true, nombre: true },
          orderBy: { nombre: 'asc' }
        })
      ]);

      return res.status(200).json({
        success: true,
        catalogos: {
          notarias,
          abogados,
          tipos_acto: tiposActo,
          estatus_expediente: [
            'ABIERTO',
            'EN_INTEGRACION',
            'EN_PROCESO',
            'PENDIENTE_CLIENTE',
            'PENDIENTE_NOTARIA',
            'FIRMA_PROGRAMADA',
            'FIRMADO',
            'POST_FIRMA',
            'LISTO_ENTREGA',
            'ENTREGADO'
          ]
        }
      });
    } catch (err: any) {
      console.error('[FinanzasController] Error al obtener catálogos de filtro:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}
