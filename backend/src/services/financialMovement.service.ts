import { Prisma, type PrismaClient } from '@prisma/client';
import { assertMovementApplicable, canMutateFinancialRecord, FinanceDomainError, validateDistribution } from '../domain/financeCore';

type Database = PrismaClient;
type AllocationInput = { categoria_id: string; monto: number; honorario_generado_id?: string | null; observaciones?: string | null };

const clean = (value: unknown) => String(value || '').trim();

async function nextFolio(tx: any, sequence: 'finance_movement_folio_seq' | 'finance_receipt_folio_seq', prefix: 'MOV' | 'COM') {
  const rows = await tx.$queryRawUnsafe(`SELECT nextval('${sequence}') AS value`) as Array<{ value: bigint }>;
  const value = Number(rows[0]?.value || 0);
  if (!value) throw new FinanceDomainError('No pudimos generar el folio financiero.', 'FINANCE_FOLIO_FAILED', 500);
  return `${prefix}-${new Date().getUTCFullYear()}-${String(value).padStart(6, '0')}`;
}

export class FinancialMovementService {
  constructor(private readonly db: Database) {}

  async list(input: any) {
    const page = Math.max(1, Number(input.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(input.pageSize || 20)));
    const where: Prisma.MovimientoFinancieroWhereInput = {
      ...(input.naturaleza && input.naturaleza !== 'TODOS' ? { naturaleza: input.naturaleza } : {}),
      ...(input.estatus && input.estatus !== 'TODOS' ? { estatus: input.estatus } : {}),
      ...(input.cuenta_id ? { cuenta_id: input.cuenta_id } : {}),
      ...(input.expediente_id ? { expediente_id: input.expediente_id } : {}),
      ...(input.notaria_id ? { notaria_id: input.notaria_id } : {}),
      ...(input.responsable_id ? { responsable_id: input.responsable_id } : {}),
      ...(input.comprobante === 'CON' ? { movimientoDocumentos: { some: { estatus: 'ACTIVO', tipo_vinculo: 'COMPROBANTE_PAGO' } } } : {}),
      ...(input.comprobante === 'SIN' ? { movimientoDocumentos: { none: { estatus: 'ACTIVO', tipo_vinculo: 'COMPROBANTE_PAGO' } } } : {}),
      ...(input.fecha_desde || input.fecha_hasta ? { fecha_movimiento: { ...(input.fecha_desde ? { gte: new Date(input.fecha_desde) } : {}), ...(input.fecha_hasta ? { lte: new Date(`${input.fecha_hasta}T23:59:59.999`) } : {}) } } : {}),
      ...(input.search ? { OR: [
        { folio: { contains: clean(input.search), mode: 'insensitive' } },
        { referencia: { contains: clean(input.search), mode: 'insensitive' } },
        { concepto: { contains: clean(input.search), mode: 'insensitive' } },
        { expediente: { numero_pravia: { contains: clean(input.search), mode: 'insensitive' } } },
        { expediente: { cliente_alias: { contains: clean(input.search), mode: 'insensitive' } } },
        { comprobanteInterno: { is: { folio: { contains: clean(input.search), mode: 'insensitive' } } } },
      ] } : {}),
    };
    const include = {
      expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } },
      cuenta: { select: { id: true, institucion: true, alias: true, ultimos_cuatro: true, moneda: true } },
      notaria: { select: { id: true, nombre: true, numero_notaria: true } },
      responsable: { select: { id: true, nombre: true, apellido: true } },
      distribuciones: { include: { categoria: true } },
      comprobanteInterno: true,
      movimientoDocumentos: {
        where: { estatus: 'ACTIVO', tipo_vinculo: 'COMPROBANTE_PAGO' },
        include: { documento: true },
        orderBy: { fecha_vinculo: 'desc' },
      },
    } as const;
    const [items, total] = await Promise.all([
      this.db.movimientoFinanciero.findMany({ where, include, orderBy: [{ fecha_movimiento: 'desc' }, { fecha_registro: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.db.movimientoFinanciero.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async retireEvidence(movementId: string, documentId: string, actorId: string, reason: string, correlationId?: string) {
    if (!clean(reason)) throw new FinanceDomainError('Indica el motivo para retirar el comprobante.', 'FINANCE_EVIDENCE_REASON_REQUIRED');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:finance-evidence:${movementId}:${documentId}`}))`);
      const movement = await tx.movimientoFinanciero.findUnique({ where: { id: movementId }, select: { id: true } });
      if (!movement) throw new FinanceDomainError('Movimiento no encontrado.', 'FINANCE_MOVEMENT_NOT_FOUND', 404);
      const result = await tx.movimientoDocumento.updateMany({
        where: { movimiento_id: movementId, documento_id: documentId, tipo_vinculo: 'COMPROBANTE_PAGO', estatus: 'ACTIVO' },
        data: { estatus: 'INACTIVO', inactivado_at: new Date(), inactivado_por_id: actorId, motivo_inactivacion: clean(reason) },
      });
      if (!result.count) throw new FinanceDomainError('El comprobante ya no está vinculado a este movimiento.', 'FINANCE_EVIDENCE_NOT_FOUND', 404);
      await tx.auditLog.create({
        data: {
          user_id: actorId,
          accion: 'RETIRE_FINANCIAL_EVIDENCE',
          entidad: 'MovimientoFinanciero',
          entidad_id: movementId,
          valores_nuevos: { documento_id: documentId, motivo: clean(reason), almacenamiento_conservado: true },
          correlation_id: correlationId,
        },
      });
      return { movementId, documentId, retired: true };
    });
  }

  async createDraft(input: any, actorId: string, correlationId?: string) {
    const amount = Number(input.monto);
    const allocations: AllocationInput[] = Array.isArray(input.distribuciones) ? input.distribuciones.map((item: any) => ({ ...item, monto: Number(item.monto) })) : [];
    const distribution = validateDistribution(amount, allocations.map((item) => ({ amount: item.monto })));
    if (!['INGRESO', 'EGRESO'].includes(input.naturaleza)) throw new FinanceDomainError('Selecciona ingreso o egreso.', 'FINANCE_NATURE_INVALID');
    if (!clean(input.concepto) || !input.cuenta_id) throw new FinanceDomainError('Concepto y cuenta son obligatorios.', 'FINANCE_REQUIRED_FIELDS');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:finance-idempotency:${clean(input.idempotency_key) || crypto.randomUUID()}`}))`);
      if (input.idempotency_key) {
        const existing = await tx.movimientoFinanciero.findUnique({ where: { idempotency_key: clean(input.idempotency_key) }, include: { distribuciones: true, comprobanteInterno: true } });
        if (existing) return { movement: existing, idempotent: true };
      }
      const categories = await tx.categoriaFinanciera.findMany({ where: { id: { in: allocations.map((item) => item.categoria_id) }, activa: true } });
      if (categories.length !== new Set(allocations.map((item) => item.categoria_id)).size) throw new FinanceDomainError('Una clasificación financiera no está disponible.', 'FINANCE_CATEGORY_INVALID');
      categories.forEach((category) => {
        if (category.direccion !== 'AMBAS' && category.direccion !== input.naturaleza) throw new FinanceDomainError(`La categoría ${category.nombre} no corresponde a este tipo de movimiento.`, 'FINANCE_CATEGORY_DIRECTION_MISMATCH');
      });
      const account = await tx.cuentaFinanciera.findFirst({ where: { id: input.cuenta_id, activa: true } });
      if (!account) throw new FinanceDomainError('Selecciona una cuenta activa.', 'FINANCE_ACCOUNT_INVALID');
      const folio = await nextFolio(tx, 'finance_movement_folio_seq', 'MOV');
      const movement = await tx.movimientoFinanciero.create({
        data: {
          folio,
          expediente_id: input.expediente_id || null,
          cotizacion_id: input.cotizacion_id || null,
          compareciente_id: input.compareciente_id || null,
          notaria_id: input.notaria_id || null,
          responsable_id: input.responsable_id || null,
          cuenta_id: input.cuenta_id,
          tipo_movimiento: input.tipo_movimiento || (input.naturaleza === 'INGRESO' ? 'ABONO' : 'EGRESO_TERCEROS'),
          naturaleza: input.naturaleza,
          categoria: 'DISTRIBUIDO',
          concepto: clean(input.concepto),
          descripcion: clean(input.descripcion) || null,
          monto: amount,
          fecha_movimiento: input.fecha_movimiento ? new Date(input.fecha_movimiento) : new Date(),
          forma_pago: clean(input.forma_pago) || null,
          referencia: clean(input.referencia) || null,
          idempotency_key: clean(input.idempotency_key) || null,
          estatus: distribution.balanced ? 'PENDIENTE_COMPROBANTE' : 'BORRADOR',
          capturado_por_id: actorId,
          distribuciones: { create: allocations.map((item) => ({ categoria_id: item.categoria_id, honorario_generado_id: item.honorario_generado_id || null, monto: item.monto, observaciones: clean(item.observaciones) || null })) },
        },
        include: { distribuciones: { include: { categoria: true } }, cuenta: true },
      });
      await tx.auditLog.create({ data: { user_id: actorId, accion: 'CREATE_FINANCIAL_DRAFT', entidad: 'MovimientoFinanciero', entidad_id: movement.id, valores_nuevos: { folio, naturaleza: input.naturaleza, monto: amount, estatus: movement.estatus }, correlation_id: correlationId } });
      return { movement, idempotent: false };
    });
  }

  async replaceDistribution(movementId: string, allocations: AllocationInput[], actorId: string, correlationId?: string) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:finance-movement:${movementId}`}))`);
      const movement = await tx.movimientoFinanciero.findUnique({ where: { id: movementId }, include: { distribuciones: true, comprobanteInterno: true } });
      if (!movement) throw new FinanceDomainError('Movimiento no encontrado.', 'FINANCE_MOVEMENT_NOT_FOUND', 404);
      if (!canMutateFinancialRecord(movement.estatus)) throw new FinanceDomainError('Un movimiento aplicado no puede editarse.', 'FINANCE_MOVEMENT_IMMUTABLE', 409);
      const normalized = allocations.map((item) => ({ ...item, monto: Number(item.monto) }));
      const distribution = validateDistribution(Number(movement.monto), normalized.map((item) => ({ amount: item.monto })));
      const categories = await tx.categoriaFinanciera.findMany({ where: { id: { in: normalized.map((item) => item.categoria_id) }, activa: true } });
      if (categories.length !== new Set(normalized.map((item) => item.categoria_id)).size) throw new FinanceDomainError('Una clasificación financiera no está disponible.', 'FINANCE_CATEGORY_INVALID');
      categories.forEach((category) => {
        if (category.direccion !== 'AMBAS' && category.direccion !== movement.naturaleza) throw new FinanceDomainError(`La categoría ${category.nombre} no corresponde a este tipo de movimiento.`, 'FINANCE_CATEGORY_DIRECTION_MISMATCH');
      });
      await tx.movimientoDistribucion.deleteMany({ where: { movimiento_id: movementId } });
      await tx.movimientoDistribucion.createMany({ data: normalized.map((item) => ({ movimiento_id: movementId, categoria_id: item.categoria_id, honorario_generado_id: item.honorario_generado_id || null, monto: item.monto, observaciones: clean(item.observaciones) || null })) });
      if (movement.comprobanteInterno?.estado === 'VIGENTE') {
        await tx.comprobanteFinanciero.update({ where: { id: movement.comprobanteInterno.id }, data: { estado: 'ANULADO', anulado_por_id: actorId, fecha_anulacion: new Date(), motivo_anulacion: 'Distribución económica actualizada' } });
      }
      await tx.movimientoFinanciero.update({ where: { id: movementId }, data: { estatus: distribution.balanced ? 'PENDIENTE_COMPROBANTE' : 'BORRADOR' } });
      await tx.auditLog.create({ data: { user_id: actorId, accion: 'REPLACE_FINANCIAL_DISTRIBUTION', entidad: 'MovimientoFinanciero', entidad_id: movementId, valores_anteriores: movement.distribuciones.map((item) => ({ categoria_id: item.categoria_id, monto: Number(item.monto) })), valores_nuevos: normalized, correlation_id: correlationId } });
      return tx.movimientoFinanciero.findUnique({ where: { id: movementId }, include: { distribuciones: { include: { categoria: true } } } });
    });
  }

  async generateReceipt(movementId: string, actorId: string, observaciones?: string, correlationId?: string) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:finance-receipt:${movementId}`}))`);
      const movement = await tx.movimientoFinanciero.findUnique({ where: { id: movementId }, include: { cuenta: true, expediente: true, distribuciones: { include: { categoria: true } }, comprobanteInterno: true } });
      if (!movement) throw new FinanceDomainError('Movimiento no encontrado.', 'FINANCE_MOVEMENT_NOT_FOUND', 404);
      if (movement.comprobanteInterno?.estado === 'VIGENTE') return { receipt: movement.comprobanteInterno, idempotent: true };
      if (!canMutateFinancialRecord(movement.estatus)) throw new FinanceDomainError('No se puede generar un comprobante para este movimiento.', 'FINANCE_RECEIPT_NOT_ALLOWED', 409);
      const distribution = validateDistribution(Number(movement.monto), movement.distribuciones.map((item) => ({ amount: Number(item.monto) })));
      if (!distribution.balanced) throw new FinanceDomainError('La distribución debe cuadrar antes de generar el comprobante.', 'FINANCE_DISTRIBUTION_UNBALANCED', 409);
      const folio = await nextFolio(tx, 'finance_receipt_folio_seq', 'COM');
      const snapshot = { movimiento_folio: movement.folio, expediente: movement.expediente?.numero_pravia || null, distribuciones: movement.distribuciones.map((item) => ({ categoria: item.categoria.nombre, naturaleza: item.categoria.naturaleza, monto: Number(item.monto) })) };
      const receipt = await tx.comprobanteFinanciero.create({ data: { folio, movimiento_id: movement.id, tipo: movement.naturaleza, importe: movement.monto, concepto: movement.concepto, persona: movement.expediente?.cliente_alias || null, forma_pago: movement.forma_pago, cuenta_snapshot: movement.cuenta ? { institucion: movement.cuenta.institucion, alias: movement.cuenta.alias, ultimos_cuatro: movement.cuenta.ultimos_cuatro, moneda: movement.cuenta.moneda } : Prisma.JsonNull, observaciones: clean(observaciones) || null, snapshot, registrado_por_id: actorId } });
      await tx.movimientoFinanciero.update({ where: { id: movement.id }, data: { estatus: 'LISTO_APLICAR' } });
      await tx.auditLog.create({ data: { user_id: actorId, accion: 'GENERATE_FINANCIAL_RECEIPT', entidad: 'ComprobanteFinanciero', entidad_id: receipt.id, valores_nuevos: { folio, movimiento_id: movement.id, importe: Number(movement.monto) }, correlation_id: correlationId } });
      return { receipt, idempotent: false };
    });
  }

  async apply(movementId: string, actorId: string, correlationId?: string) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:finance-apply:${movementId}`}))`);
      const movement = await tx.movimientoFinanciero.findUnique({ where: { id: movementId }, include: { distribuciones: true, comprobanteInterno: true } });
      if (!movement) throw new FinanceDomainError('Movimiento no encontrado.', 'FINANCE_MOVEMENT_NOT_FOUND', 404);
      const validation = assertMovementApplicable({ status: movement.estatus, total: Number(movement.monto), allocations: movement.distribuciones.map((item) => ({ amount: Number(item.monto) })), receipt: movement.comprobanteInterno ? { status: movement.comprobanteInterno.estado } : null });
      if (validation.idempotent) return { movement, idempotent: true };
      const applied = await tx.movimientoFinanciero.update({ where: { id: movement.id }, data: { estatus: 'APLICADO', aplicado_por_id: actorId, fecha_aplicacion: new Date(), validado_por_id: actorId, fecha_validacion: new Date() } });
      await tx.auditLog.create({ data: { user_id: actorId, accion: 'APPLY_FINANCIAL_MOVEMENT', entidad: 'MovimientoFinanciero', entidad_id: movement.id, valores_anteriores: { estatus: movement.estatus }, valores_nuevos: { estatus: 'APLICADO', monto: Number(movement.monto) }, correlation_id: correlationId } });
      return { movement: applied, idempotent: false };
    });
  }

  async cancelDraft(movementId: string, actorId: string, reason: string, correlationId?: string) {
    if (!clean(reason)) throw new FinanceDomainError('Indica el motivo de cancelación.', 'FINANCE_CANCEL_REASON_REQUIRED');
    return this.db.$transaction(async (tx) => {
      const movement = await tx.movimientoFinanciero.findUnique({ where: { id: movementId } });
      if (!movement) throw new FinanceDomainError('Movimiento no encontrado.', 'FINANCE_MOVEMENT_NOT_FOUND', 404);
      if (!canMutateFinancialRecord(movement.estatus)) throw new FinanceDomainError('Un movimiento aplicado debe corregirse mediante reverso.', 'FINANCE_REVERSE_REQUIRED', 409);
      const cancelled = await tx.movimientoFinanciero.update({ where: { id: movementId }, data: { estatus: 'CANCELADO', cancelado_por_id: actorId, fecha_cancelacion: new Date(), motivo_cancelacion: clean(reason) } });
      await tx.auditLog.create({ data: { user_id: actorId, accion: 'CANCEL_FINANCIAL_DRAFT', entidad: 'MovimientoFinanciero', entidad_id: movementId, valores_anteriores: { estatus: movement.estatus }, valores_nuevos: { estatus: 'CANCELADO', motivo: clean(reason) }, correlation_id: correlationId } });
      return cancelled;
    });
  }

  async reverseApplied(movementId: string, actorId: string, reason: string, correlationId?: string) {
    if (!clean(reason)) throw new FinanceDomainError('Indica el motivo del reverso.', 'FINANCE_REVERSE_REASON_REQUIRED');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:finance-reverse:${movementId}`}))`);
      const movement = await tx.movimientoFinanciero.findUnique({
        where: { id: movementId },
        include: {
          cuenta: true,
          expediente: true,
          distribuciones: { include: { categoria: true } },
          comprobanteInterno: true,
          reversosGenerados: { include: { comprobanteInterno: true, distribuciones: true } },
        },
      });
      if (!movement) throw new FinanceDomainError('Movimiento no encontrado.', 'FINANCE_MOVEMENT_NOT_FOUND', 404);
      const existing = movement.reversosGenerados.find((item: any) => item.estatus === 'APLICADO');
      if (existing) return { movement: existing, original: movement, idempotent: true };
      if (!['APLICADO', 'RECIBIDO', 'VALIDADO'].includes(movement.estatus)) {
        throw new FinanceDomainError('Sólo puedes revertir un movimiento aplicado.', 'FINANCE_REVERSE_NOT_ALLOWED', 409);
      }
      const distribution = validateDistribution(Number(movement.monto), movement.distribuciones.map((item: any) => ({ amount: Number(item.monto) })));
      if (!distribution.balanced) {
        throw new FinanceDomainError('El movimiento histórico no tiene una distribución exacta y no puede revertirse automáticamente.', 'FINANCE_REVERSE_DISTRIBUTION_INVALID', 409);
      }
      const movementFolio = await nextFolio(tx, 'finance_movement_folio_seq', 'MOV');
      const receiptFolio = await nextFolio(tx, 'finance_receipt_folio_seq', 'COM');
      const reversedNature = movement.naturaleza === 'INGRESO' ? 'EGRESO' : 'INGRESO';
      const reversed = await tx.movimientoFinanciero.create({
        data: {
          folio: movementFolio,
          expediente_id: movement.expediente_id,
          cotizacion_id: movement.cotizacion_id,
          compareciente_id: movement.compareciente_id,
          notaria_id: movement.notaria_id,
          responsable_id: movement.responsable_id,
          cuenta_id: movement.cuenta_id,
          tipo_movimiento: 'DEVOLUCION',
          naturaleza: reversedNature,
          categoria: 'DISTRIBUIDO',
          concepto: `Reverso de ${movement.folio || movement.id}: ${movement.concepto}`,
          descripcion: clean(reason),
          monto: movement.monto,
          fecha_movimiento: new Date(),
          forma_pago: movement.forma_pago,
          referencia: movement.referencia,
          estatus: 'APLICADO',
          capturado_por_id: actorId,
          validado_por_id: actorId,
          fecha_validacion: new Date(),
          aplicado_por_id: actorId,
          fecha_aplicacion: new Date(),
          movimiento_origen_id: movement.id,
          motivo_reversion: clean(reason),
          revertido_por_id: actorId,
          fecha_reversion: new Date(),
          distribuciones: {
            create: movement.distribuciones.map((item: any) => ({
              categoria_id: item.categoria_id,
              honorario_generado_id: item.honorario_generado_id,
              monto: item.monto,
              observaciones: `Reverso de ${movement.folio || movement.id}`,
            })),
          },
        },
        include: { distribuciones: { include: { categoria: true } } },
      });
      const receipt = await tx.comprobanteFinanciero.create({
        data: {
          folio: receiptFolio,
          movimiento_id: reversed.id,
          tipo: reversedNature,
          importe: movement.monto,
          concepto: reversed.concepto,
          persona: movement.expediente?.cliente_alias || null,
          forma_pago: movement.forma_pago,
          cuenta_snapshot: movement.cuenta ? { institucion: movement.cuenta.institucion, alias: movement.cuenta.alias, ultimos_cuatro: movement.cuenta.ultimos_cuatro, moneda: movement.cuenta.moneda } : Prisma.JsonNull,
          observaciones: clean(reason),
          snapshot: {
            movimiento_folio: movementFolio,
            reverso_de: movement.folio || movement.id,
            motivo: clean(reason),
            distribuciones: movement.distribuciones.map((item: any) => ({ categoria: item.categoria.nombre, naturaleza: item.categoria.naturaleza, monto: Number(item.monto) })),
          },
          registrado_por_id: actorId,
        },
      });
      const original = await tx.movimientoFinanciero.update({
        where: { id: movement.id },
        data: { estatus: 'REVERTIDO', motivo_reversion: clean(reason), revertido_por_id: actorId, fecha_reversion: new Date() },
      });
      await tx.auditLog.create({
        data: {
          user_id: actorId,
          accion: 'REVERSE_FINANCIAL_MOVEMENT',
          entidad: 'MovimientoFinanciero',
          entidad_id: movement.id,
          valores_anteriores: { estatus: movement.estatus, monto: Number(movement.monto) },
          valores_nuevos: { estatus: 'REVERTIDO', reverso_id: reversed.id, reverso_folio: movementFolio, comprobante_folio: receiptFolio, motivo: clean(reason) },
          correlation_id: correlationId,
        },
      });
      return { movement: { ...reversed, comprobanteInterno: receipt }, original, idempotent: false };
    });
  }
}
