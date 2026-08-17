export const APPLIED_MOVEMENT_STATUSES = ['APLICADO', 'RECIBIDO', 'VALIDADO'] as const;

export type EconomicNature = 'DESPACHO' | 'TERCERO' | 'EGRESO_DESPACHO' | 'TRANSFERENCIA_INTERNA' | 'OTRO';

export class FinanceDomainError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
    this.name = 'FinanceDomainError';
  }
}

export const moneyToCents = (value: number) => Math.round(Number(value) * 100);
const money = (value: number) => moneyToCents(value) / 100;

export function validateDistribution(total: number, allocations: Array<{ amount: number }>) {
  if (!Number.isFinite(total) || total <= 0) {
    throw new FinanceDomainError('El importe debe ser mayor a cero.', 'FINANCE_AMOUNT_INVALID');
  }
  if (!allocations.length) {
    throw new FinanceDomainError('Agrega al menos una clasificación económica.', 'FINANCE_DISTRIBUTION_REQUIRED');
  }
  allocations.forEach((item) => {
    if (!Number.isFinite(item.amount) || item.amount <= 0) {
      throw new FinanceDomainError('Cada clasificación debe tener un importe mayor a cero.', 'FINANCE_ALLOCATION_INVALID');
    }
  });
  const classifiedCents = allocations.reduce((sum, item) => sum + moneyToCents(item.amount), 0);
  const pendingCents = moneyToCents(total) - classifiedCents;
  if (pendingCents < 0) {
    throw new FinanceDomainError(
      `La distribución excede el importe del movimiento por ${(Math.abs(pendingCents) / 100).toFixed(2)}.`,
      'FINANCE_DISTRIBUTION_EXCEEDS_TOTAL',
    );
  }
  return {
    total: money(total),
    classified: classifiedCents / 100,
    pending: pendingCents / 100,
    balanced: pendingCents === 0,
  };
}

export function assertMovementApplicable(input: {
  status: string;
  total: number;
  allocations: Array<{ amount: number }>;
  receipt?: { status: string } | null;
}) {
  if (input.status === 'APLICADO') {
    return { idempotent: true, distribution: validateDistribution(input.total, input.allocations) };
  }
  if (!['PENDIENTE_COMPROBANTE', 'LISTO_APLICAR', 'BORRADOR', 'PENDIENTE'].includes(input.status)) {
    throw new FinanceDomainError('Este movimiento no puede aplicarse en su estado actual.', 'FINANCE_STATUS_NOT_APPLICABLE', 409);
  }
  if (!input.receipt || input.receipt.status !== 'VIGENTE') {
    throw new FinanceDomainError('Falta un comprobante para aplicar el movimiento.', 'FINANCE_RECEIPT_REQUIRED', 409);
  }
  const distribution = validateDistribution(input.total, input.allocations);
  if (!distribution.balanced) {
    throw new FinanceDomainError(
      `Los importes de la distribución no coinciden con el total. Faltan ${Math.abs(distribution.pending).toFixed(2)} por clasificar.`,
      'FINANCE_DISTRIBUTION_UNBALANCED',
      409,
    );
  }
  return { idempotent: false, distribution };
}

export type CanonicalMovement = {
  nature: 'INGRESO' | 'EGRESO';
  amount: number;
  status: string;
  allocations: Array<{ nature: EconomicNature; amount: number }>;
};

export function legacyFinanceAllocations(nature: 'INGRESO' | 'EGRESO', category: string, amount: number) {
  if (nature === 'INGRESO' && category === 'HONORARIOS_PRAVIA') return [{ nature: 'DESPACHO' as const, amount }];
  // Un ingreso histórico sin distribución explícita permanece sin clasificar.
  // No se presume que pertenezca a terceros ni al despacho.
  if (nature === 'INGRESO') return [{ nature: 'OTRO' as const, amount }];
  if (category === 'PRAVIA') return [{ nature: 'EGRESO_DESPACHO' as const, amount }];
  return [{ nature: 'TERCERO' as const, amount }];
}

export function calculateFinanceAggregates(input: {
  generatedFees: number[];
  movements: CanonicalMovement[];
}) {
  const applied = input.movements.filter((item) => APPLIED_MOVEMENT_STATUSES.includes(item.status as any));
  const ingresosRecibidos = applied
    .filter((item) => item.nature === 'INGRESO')
    .reduce((sum, item) => sum + moneyToCents(item.amount), 0);
  const egresos = applied
    .filter((item) => item.nature === 'EGRESO')
    .reduce((sum, item) => sum + moneyToCents(item.amount), 0);
  const allocated = (movementNature: 'INGRESO' | 'EGRESO', economicNature: EconomicNature) => applied
    .filter((item) => item.nature === movementNature)
    .flatMap((item) => item.allocations)
    .filter((item) => item.nature === economicNature)
    .reduce((sum, item) => sum + moneyToCents(item.amount), 0);
  const honorariosCobrados = allocated('INGRESO', 'DESPACHO');
  const fondosTerceros = allocated('INGRESO', 'TERCERO');
  // Los movimientos legacy validados pueden no tener distribuciones. No deben
  // convertirse silenciosamente en honorarios ni desaparecer de la ecuación:
  // el saldo sin clasificar se expone como OTRO hasta su conciliación humana.
  const unallocatedIncome = applied
    .filter((item) => item.nature === 'INGRESO')
    .reduce((sum, item) => {
      const classified = item.allocations.reduce((subtotal, allocation) => subtotal + moneyToCents(allocation.amount), 0);
      return sum + Math.max(0, moneyToCents(item.amount) - classified);
    }, 0);
  const otrosDestinos = allocated('INGRESO', 'OTRO') + unallocatedIncome;
  const fondosTercerosPagados = allocated('EGRESO', 'TERCERO');
  const honorariosGenerados = input.generatedFees.reduce((sum, item) => sum + moneyToCents(item), 0);

  return {
    ingresos_recibidos: ingresosRecibidos / 100,
    honorarios_generados: honorariosGenerados / 100,
    honorarios_cobrados: honorariosCobrados / 100,
    honorarios_por_cobrar: Math.max(0, honorariosGenerados - honorariosCobrados) / 100,
    fondos_terceros: fondosTerceros / 100,
    otros_destinos: otrosDestinos / 100,
    fondos_terceros_pendientes: Math.max(0, fondosTerceros - fondosTercerosPagados) / 100,
    egresos: egresos / 100,
  };
}

export function calculateReceivable(input: { generated: number; collected: number; dueDate?: Date | null; now?: Date }) {
  const pending = Math.max(0, moneyToCents(input.generated) - moneyToCents(input.collected)) / 100;
  const now = input.now || new Date();
  const ageDays = input.dueDate && pending > 0
    ? Math.max(0, Math.floor((now.getTime() - input.dueDate.getTime()) / 86_400_000))
    : null;
  const bucket = ageDays === null ? null
    : ageDays <= 30 ? '0_30'
    : ageDays <= 60 ? '31_60'
    : ageDays <= 90 ? '61_90'
    : ageDays <= 120 ? '91_120'
    : 'MAS_120';
  return { generated: money(input.generated), collected: money(input.collected), pending, ageDays, bucket };
}

export function reconciliationScore(input: {
  movementAmount: number;
  bankAmount: number;
  movementDate: Date;
  bankDate: Date;
  movementReference?: string | null;
  bankReference?: string | null;
  sameAccount: boolean;
}) {
  if (moneyToCents(input.movementAmount) !== moneyToCents(Math.abs(input.bankAmount)) || !input.sameAccount) return 0;
  let score = 65;
  const days = Math.abs(input.movementDate.getTime() - input.bankDate.getTime()) / 86_400_000;
  if (days === 0) score += 20;
  else if (days <= 2) score += 10;
  const left = (input.movementReference || '').trim().toLocaleLowerCase('es-MX');
  const right = (input.bankReference || '').trim().toLocaleLowerCase('es-MX');
  if (left && right && (left === right || left.includes(right) || right.includes(left))) score += 15;
  return Math.min(100, score);
}

export function reconciliationReasons(input: Parameters<typeof reconciliationScore>[0]) {
  if (moneyToCents(input.movementAmount) !== moneyToCents(Math.abs(input.bankAmount)) || !input.sameAccount) return [];
  const reasons = ['Importe exacto', 'Misma cuenta'];
  const days = Math.abs(input.movementDate.getTime() - input.bankDate.getTime()) / 86_400_000;
  if (days === 0) reasons.push('Misma fecha');
  else if (days <= 2) reasons.push('Fecha dentro de 2 días');
  const left = (input.movementReference || '').trim().toLocaleLowerCase('es-MX');
  const right = (input.bankReference || '').trim().toLocaleLowerCase('es-MX');
  if (left && right && (left === right || left.includes(right) || right.includes(left))) reasons.push('Referencia coincidente');
  return reasons;
}

export function canMutateFinancialRecord(status: string) {
  return ['BORRADOR', 'PENDIENTE', 'PENDIENTE_COMPROBANTE', 'LISTO_APLICAR'].includes(status);
}

export function movementStatusLabel(status: string) {
  const labels: Record<string, string> = {
    BORRADOR: 'Borrador', PENDIENTE: 'Pendiente', PENDIENTE_COMPROBANTE: 'Falta comprobante',
    LISTO_APLICAR: 'Listo para aplicar', APLICADO: 'Aplicado', RECIBIDO: 'Aplicado (histórico)',
    VALIDADO: 'Aplicado (histórico)', RECHAZADO: 'Rechazado', REVERTIDO: 'Revertido', CANCELADO: 'Cancelado',
  };
  return labels[status] || 'Estado no disponible';
}
