export const LEGACY_FINANCE_CLASSIFICATIONS = [
  'MIGRACION_SEGURA',
  'YA_REPRESENTADO',
  'DUPLICADO_PROBABLE',
  'AMBIGUO',
  'REQUIERE_REVISION',
] as const;

export type LegacyFinanceClassification = typeof LEGACY_FINANCE_CLASSIFICATIONS[number];

export type LegacyPayment = {
  id: string;
  expediente_id?: string | null;
  cotizacion_id?: string | null;
  categoria_ingreso: string;
  concepto: string;
  monto: number;
  fecha_pago?: Date | null;
  fecha_registro: Date;
  estatus: string;
};

export type ModernMovement = {
  id: string;
  expediente_id?: string | null;
  cotizacion_id?: string | null;
  tipo_movimiento: string;
  naturaleza: string;
  categoria: string;
  concepto: string;
  monto: number;
  fecha_movimiento: Date;
  estatus: string;
  referencia?: string | null;
};

export type MigrationProposal = {
  tipo_movimiento: 'ANTICIPO' | 'ABONO';
  naturaleza: 'INGRESO';
  categoria: 'ANTICIPO_NOTARIA' | 'HONORARIOS_PRAVIA';
  concepto: string;
  monto: number;
  fecha_movimiento: Date;
  expediente_id: string | null;
  cotizacion_id: string | null;
  referencia: string;
};

export type LegacyFinanceDecision = {
  classification: LegacyFinanceClassification;
  reason: string;
  possible_duplicate_ids: string[];
  proposal?: MigrationProposal;
};

const normalized = (value: string) => value.trim().toLocaleLowerCase('es-MX').replace(/\s+/g, ' ');
const dayDistance = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 86_400_000;

const sameObject = (payment: LegacyPayment, movement: ModernMovement) =>
  Boolean(payment.expediente_id && payment.expediente_id === movement.expediente_id)
  || Boolean(payment.cotizacion_id && payment.cotizacion_id === movement.cotizacion_id);

const isActiveMovement = (movement: ModernMovement) => !['CANCELADO', 'REVERTIDO', 'RECHAZADO'].includes(movement.estatus);

export function classifyLegacyPayment(payment: LegacyPayment, movements: ModernMovement[]): LegacyFinanceDecision {
  const amount = Number(payment.monto);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { classification: 'REQUIERE_REVISION', reason: 'El importe legacy no es positivo o no es numérico.', possible_duplicate_ids: [] };
  }
  if (!payment.expediente_id && !payment.cotizacion_id) {
    return { classification: 'REQUIERE_REVISION', reason: 'El pago no está ligado a expediente ni cotización.', possible_duplicate_ids: [] };
  }
  if (['CANCELADO', 'RECHAZADO'].includes(payment.estatus)) {
    return { classification: 'REQUIERE_REVISION', reason: `El pago legacy está en estado ${payment.estatus}; no representa efectivo migrable.`, possible_duplicate_ids: [] };
  }

  const effectiveDate = payment.fecha_pago || payment.fecha_registro;
  const sameAmountAndObject = movements.filter((movement) =>
    isActiveMovement(movement)
    && sameObject(payment, movement)
    && Number(movement.monto) === amount,
  );
  const exactMatches = sameAmountAndObject.filter((movement) =>
    dayDistance(effectiveDate, movement.fecha_movimiento) <= 1
    && normalized(payment.concepto) === normalized(movement.concepto),
  );
  if (exactMatches.length === 1) {
    return {
      classification: 'YA_REPRESENTADO',
      reason: 'Existe un movimiento activo del mismo objeto, importe, fecha y concepto.',
      possible_duplicate_ids: exactMatches.map((item) => item.id),
    };
  }
  if (exactMatches.length > 1 || sameAmountAndObject.some((movement) => dayDistance(effectiveDate, movement.fecha_movimiento) <= 7)) {
    return {
      classification: 'DUPLICADO_PROBABLE',
      reason: 'Hay uno o más movimientos activos del mismo objeto e importe en una ventana de siete días.',
      possible_duplicate_ids: sameAmountAndObject.map((item) => item.id),
    };
  }

  if (payment.estatus !== 'VALIDADO') {
    return {
      classification: 'REQUIERE_REVISION',
      reason: `Solo los pagos legacy VALIDADOS pueden proponer migración automática; estado actual: ${payment.estatus}.`,
      possible_duplicate_ids: [],
    };
  }

  let mapped: Pick<MigrationProposal, 'tipo_movimiento' | 'naturaleza' | 'categoria'> | undefined;
  if (payment.categoria_ingreso === 'ANTICIPO_NOTARIA') {
    mapped = { tipo_movimiento: 'ANTICIPO', naturaleza: 'INGRESO', categoria: 'ANTICIPO_NOTARIA' };
  } else if (['HONORARIOS_RECIBIDOS', 'INGRESO_REAL_RECIBIDO'].includes(payment.categoria_ingreso)) {
    mapped = { tipo_movimiento: 'ABONO', naturaleza: 'INGRESO', categoria: 'HONORARIOS_PRAVIA' };
  } else if (['HONORARIOS_ESPERADOS', 'PAGO_NOTARIA'].includes(payment.categoria_ingreso)) {
    return {
      classification: 'AMBIGUO',
      reason: payment.categoria_ingreso === 'HONORARIOS_ESPERADOS'
        ? 'Un importe esperado no acredita un movimiento de efectivo.'
        : 'PAGO_NOTARIA no determina de forma segura si el flujo fue ingreso o egreso.',
      possible_duplicate_ids: [],
    };
  } else {
    return { classification: 'AMBIGUO', reason: 'La categoría legacy no tiene equivalencia determinista.', possible_duplicate_ids: [] };
  }

  return {
    classification: 'MIGRACION_SEGURA',
    reason: 'Pago validado, vinculado, sin duplicado aparente y con equivalencia contable determinista.',
    possible_duplicate_ids: [],
    proposal: {
      ...mapped,
      concepto: payment.concepto.trim(),
      monto: amount,
      fecha_movimiento: effectiveDate,
      expediente_id: payment.expediente_id || null,
      cotizacion_id: payment.cotizacion_id || null,
      referencia: `legacy:pago:${payment.id}`,
    },
  };
}
