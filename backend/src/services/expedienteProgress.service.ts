import { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';

export interface CalculatedProgress {
  documental: number;
  operativo: number;
  financiero: number;
  general: number;
  configuration: {
    documental: 'NO_CONFIGURADO' | 'EN_PROGRESO' | 'COMPLETO';
    operativo: 'NO_CONFIGURADO' | 'EN_PROGRESO' | 'COMPLETO';
    financiero: 'NO_CONFIGURADO' | 'EN_PROGRESO' | 'COMPLETO';
  };
}

export async function calculateExpedienteProgress(expedienteId: string, tx?: Prisma.TransactionClient | PrismaClient) {
  const client = tx || prisma;
  return ExpedienteProgressService.calcularAvances(client, expedienteId);
}

export class ExpedienteProgressService {
  /**
   * Calcula los avances del expediente dentro de una transacción activa o cliente Prisma
   */
  public static async calcularAvances(
    tx: Prisma.TransactionClient | PrismaClient,
    expedienteId: string
  ): Promise<CalculatedProgress> {
    const expediente = await tx.expediente.findUnique({
      where: { id: expedienteId },
      include: {
        cotizacion: true,
        flujoVersion: true,
        etapas: true,
        requisitos_docs: true,
        movimientosFinancieros: {
          where: { estatus: 'VALIDADO' }
        }
      }
    });

    if (!expediente) {
      return {
        documental: 0,
        operativo: 0,
        financiero: 0,
        general: 0,
        configuration: { documental: 'NO_CONFIGURADO', operativo: 'NO_CONFIGURADO', financiero: 'NO_CONFIGURADO' },
      };
    }

    // 1. Avance Documental %
    const reqsObligatorios = expediente.requisitos_docs.filter(r => r.obligatorio);
    let avanceDoc = 0;
    if (reqsObligatorios.length > 0) {
      const validados = reqsObligatorios.filter(r => r.estatus === 'VALIDADO' || r.estatus === 'OMITIDO_JUSTIFICADO').length;
      avanceDoc = Math.round((validados / reqsObligatorios.length) * 100);
    }

    // 2. Avance Operativo %
    let avanceOp = 0;
    const frozenStages = Array.isArray(expediente.flujoVersion?.etapas_json)
      ? expediente.flujoVersion.etapas_json as Array<Record<string, unknown>>
      : [];
    const etapasCompletadas = expediente.etapas.filter(e => e.completada).length;
    const totalEtapas = frozenStages.length;
    if (totalEtapas > 0) avanceOp = Math.round((Math.min(etapasCompletadas, totalEtapas) / totalEtapas) * 100);

    // 3. Avance Financiero %
    // Fórmula: min(100, max(0, (Ingresos Válidos Cobrados - Devoluciones / Total Exigible Cliente) * 100))
    let avanceFin = 0;
    const datosOperacion = expediente.datos_operacion && typeof expediente.datos_operacion === 'object' && !Array.isArray(expediente.datos_operacion)
      ? expediente.datos_operacion as Record<string, any>
      : {};
    const presupuesto = datosOperacion.presupuesto && typeof datosOperacion.presupuesto === 'object'
      ? datosOperacion.presupuesto
      : {};
    const totalExigible = Number(presupuesto.total_cliente || presupuesto.total_notaria || expediente.cotizacion?.total_cliente || 0);

    if (totalExigible > 0) {
      const ingresosCobrados = expediente.movimientosFinancieros
        .filter(m => m.naturaleza === 'INGRESO' && m.tipo_movimiento !== 'EGRESO_NOTARIA' && m.tipo_movimiento !== 'EGRESO_TERCEROS')
        .reduce((sum, m) => sum + Number(m.monto), 0);

      const devoluciones = expediente.movimientosFinancieros
        .filter(m => m.tipo_movimiento === 'DEVOLUCION')
        .reduce((sum, m) => sum + Number(m.monto), 0);

      const netoIngreso = Math.max(0, ingresosCobrados - devoluciones);
      avanceFin = Math.min(100, Math.round((netoIngreso / totalExigible) * 100));
    }

    // 4. Avance General Ponderado %
    const ponderaciones = (expediente.flujoVersion?.ponderaciones_json as any) || {
      operativo: 0.40,
      documental: 0.40,
      financiero: 0.20
    };

    const pesoOp = Number(ponderaciones.operativo || 0.40);
    const pesoDoc = Number(ponderaciones.documental || 0.40);
    const pesoFin = Number(ponderaciones.financiero || 0.20);

    const avanceGen = Math.min(100, Math.round(avanceOp * pesoOp + avanceDoc * pesoDoc + avanceFin * pesoFin));

    return {
      documental: Math.min(100, Math.max(0, avanceDoc)),
      operativo: Math.min(100, Math.max(0, avanceOp)),
      financiero: Math.min(100, Math.max(0, avanceFin)),
      general: Math.min(100, Math.max(0, avanceGen)),
      configuration: {
        documental: reqsObligatorios.length === 0 ? 'NO_CONFIGURADO' : avanceDoc >= 100 ? 'COMPLETO' : 'EN_PROGRESO',
        operativo: totalEtapas === 0 ? 'NO_CONFIGURADO' : avanceOp >= 100 ? 'COMPLETO' : 'EN_PROGRESO',
        financiero: totalExigible <= 0 ? 'NO_CONFIGURADO' : avanceFin >= 100 ? 'COMPLETO' : 'EN_PROGRESO',
      },
    };
  }
}
