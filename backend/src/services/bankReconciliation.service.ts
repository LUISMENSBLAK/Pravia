import { Prisma, type PrismaClient } from '@prisma/client';
import { FinanceDomainError, reconciliationReasons, reconciliationScore } from '../domain/financeCore';

export class BankReconciliationService {
  constructor(private readonly db: PrismaClient) {}

  async list(input: { cuenta_id?: string; estado?: string; fecha_desde?: string; fecha_hasta?: string }) {
    const where: Prisma.TransaccionEstadoCuentaWhereInput = {
      ...(input.cuenta_id ? { cuenta_id: input.cuenta_id } : {}),
      ...(input.estado && input.estado !== 'TODOS' ? { estado: input.estado as any } : {}),
      ...(input.fecha_desde || input.fecha_hasta ? { fecha: { ...(input.fecha_desde ? { gte: new Date(input.fecha_desde) } : {}), ...(input.fecha_hasta ? { lte: new Date(`${input.fecha_hasta}T23:59:59.999`) } : {}) } } : {}),
    };
    const [bank, movements] = await Promise.all([
      this.db.transaccionEstadoCuenta.findMany({ where, include: { cuenta: true, conciliaciones: { include: { movimiento: true } } }, orderBy: { fecha: 'desc' }, take: 100 }),
      this.db.movimientoFinanciero.findMany({ where: { ...(input.cuenta_id ? { cuenta_id: input.cuenta_id } : {}), ...(input.fecha_desde || input.fecha_hasta ? { fecha_movimiento: { ...(input.fecha_desde ? { gte: new Date(input.fecha_desde) } : {}), ...(input.fecha_hasta ? { lte: new Date(`${input.fecha_hasta}T23:59:59.999`) } : {}) } } : {}), estatus: { in: ['APLICADO', 'RECIBIDO', 'VALIDADO'] }, conciliaciones: { none: { estado: 'CONCILIADA' } } }, include: { cuenta: true }, orderBy: { fecha_movimiento: 'desc' }, take: 100 }),
    ]);
    const rows = bank.map((transaction) => {
      const candidates = movements.map((movement) => {
        const factors = { movementAmount: Number(movement.monto), bankAmount: Number(transaction.importe), movementDate: movement.fecha_movimiento, bankDate: transaction.fecha, movementReference: movement.referencia, bankReference: transaction.referencia, sameAccount: movement.cuenta_id === transaction.cuenta_id };
        return { movement, score: reconciliationScore(factors), algorithm: 'PRAVIA_RECONCILIATION_V1', reasons: reconciliationReasons(factors) };
      }).filter((item) => item.score >= 65).sort((a, b) => b.score - a.score);
      return { transaction, current: transaction.conciliaciones[0] || null, suggestion: candidates[0] || null };
    });
    return { rows, unmatchedMovements: movements.filter((movement) => !bank.some((transaction) => transaction.conciliaciones.some((item) => item.movimiento_id === movement.id))), summary: { conciliados: bank.filter((item) => item.estado === 'CONCILIADA').length, pendientes: bank.filter((item) => item.estado === 'PENDIENTE').length, sinCoincidencia: bank.filter((item) => item.estado === 'PENDIENTE' && !rows.find((row) => row.transaction.id === item.id)?.suggestion).length } };
  }

  async reconcile(input: { movementId: string; bankTransactionId: string; method?: 'EXACTA' | 'SUGERIDA' | 'MANUAL'; justification?: string }, actorId: string, correlationId?: string) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:reconcile:${input.bankTransactionId}`}))`);
      const [movement, bank] = await Promise.all([
        tx.movimientoFinanciero.findUnique({ where: { id: input.movementId } }),
        tx.transaccionEstadoCuenta.findUnique({ where: { id: input.bankTransactionId } }),
      ]);
      if (!movement || !bank) throw new FinanceDomainError('No encontramos ambos registros para conciliar.', 'RECONCILIATION_RECORD_NOT_FOUND', 404);
      if (!['APLICADO', 'RECIBIDO', 'VALIDADO'].includes(movement.estatus)) throw new FinanceDomainError('Sólo se concilian movimientos aplicados.', 'RECONCILIATION_MOVEMENT_NOT_APPLIED', 409);
      if (bank.estado === 'CONCILIADA') {
        const existing = await tx.conciliacionFinanciera.findFirst({ where: { transaccion_bancaria_id: bank.id, estado: 'CONCILIADA' } });
        if (existing?.movimiento_id === movement.id) return { reconciliation: existing, idempotent: true };
        throw new FinanceDomainError('La transacción bancaria ya está conciliada.', 'BANK_TRANSACTION_ALREADY_RECONCILED', 409);
      }
      if (movement.cuenta_id !== bank.cuenta_id || Number(movement.monto) !== Math.abs(Number(bank.importe))) throw new FinanceDomainError('Cuenta e importe deben coincidir para conciliar.', 'RECONCILIATION_MISMATCH', 409);
      const reconciliation = await tx.conciliacionFinanciera.upsert({ where: { movimiento_id_transaccion_bancaria_id: { movimiento_id: movement.id, transaccion_bancaria_id: bank.id } }, create: { movimiento_id: movement.id, transaccion_bancaria_id: bank.id, estado: 'CONCILIADA', metodo: input.method || 'MANUAL', justificacion: input.justification || null, conciliado_por_id: actorId, fecha_conciliacion: new Date() }, update: { estado: 'CONCILIADA', metodo: input.method || 'MANUAL', justificacion: input.justification || null, conciliado_por_id: actorId, fecha_conciliacion: new Date() } });
      await tx.transaccionEstadoCuenta.update({ where: { id: bank.id }, data: { estado: 'CONCILIADA' } });
      await tx.auditLog.create({ data: { user_id: actorId, accion: 'RECONCILE_FINANCIAL_MOVEMENT', entidad: 'ConciliacionFinanciera', entidad_id: reconciliation.id, valores_nuevos: { movimiento_id: movement.id, transaccion_bancaria_id: bank.id, metodo: reconciliation.metodo }, correlation_id: correlationId } });
      return { reconciliation, idempotent: false };
    });
  }
}
