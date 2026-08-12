export const FINANCIAL_CATEGORIES = [
  'CLIENTE_FONDOS',
  'HONORARIOS_PRAVIA',
  'NOTARIA',
  'IMPUESTOS_DERECHOS',
  'TERCEROS',
  'PRAVIA',
  'DEVOLUCION',
  'REVERSO',
] as const;

export type FinancialCategory = typeof FINANCIAL_CATEGORIES[number];

export class FinancialLedgerError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
  }
}

export const normalizeFinancialCategory = (value: unknown): FinancialCategory => {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s/]+/g, '_');
  const aliases: Record<string, FinancialCategory> = {
    CLIENTE: 'CLIENTE_FONDOS',
    FONDOS_CLIENTE: 'CLIENTE_FONDOS',
    HONORARIOS: 'HONORARIOS_PRAVIA',
    INGRESO_PRAVIA: 'HONORARIOS_PRAVIA',
    IMPUESTOS: 'IMPUESTOS_DERECHOS',
    DERECHOS: 'IMPUESTOS_DERECHOS',
  };
  const result = aliases[normalized] || normalized;
  if (!FINANCIAL_CATEGORIES.includes(result as FinancialCategory)) {
    throw new FinancialLedgerError('Selecciona una categoría financiera válida.', 'FINANCIAL_CATEGORY_INVALID');
  }
  return result as FinancialCategory;
};

export function validateMovementSemantics(input: {
  tipo: string;
  naturaleza: 'INGRESO' | 'EGRESO';
  categoria: FinancialCategory;
  monto: number;
}) {
  if (!Number.isFinite(input.monto) || input.monto <= 0) {
    throw new FinancialLedgerError('El monto debe ser mayor a cero.', 'FINANCIAL_AMOUNT_INVALID');
  }
  const expenseTypes = ['EGRESO_NOTARIA', 'EGRESO_TERCEROS', 'DEVOLUCION'];
  if (expenseTypes.includes(input.tipo) && input.naturaleza !== 'EGRESO') {
    throw new FinancialLedgerError('Este tipo de movimiento debe registrarse como egreso.', 'FINANCIAL_NATURE_MISMATCH');
  }
  if (!expenseTypes.includes(input.tipo) && input.tipo !== 'AJUSTE' && input.naturaleza !== 'INGRESO') {
    throw new FinancialLedgerError('Este tipo de movimiento debe registrarse como ingreso.', 'FINANCIAL_NATURE_MISMATCH');
  }
  if (input.categoria === 'HONORARIOS_PRAVIA' && input.naturaleza !== 'INGRESO') {
    throw new FinancialLedgerError('Los honorarios recibidos de PRAVIA deben ser un ingreso.', 'FINANCIAL_CATEGORY_NATURE_MISMATCH');
  }
  if (['NOTARIA', 'IMPUESTOS_DERECHOS', 'TERCEROS'].includes(input.categoria) && input.naturaleza !== 'EGRESO') {
    throw new FinancialLedgerError('Los pagos a Notaría, impuestos o terceros deben ser egresos.', 'FINANCIAL_CATEGORY_NATURE_MISMATCH');
  }
  if (input.categoria === 'CLIENTE_FONDOS' && input.naturaleza !== 'INGRESO') {
    throw new FinancialLedgerError('Los fondos recibidos del cliente deben registrarse como ingreso.', 'FINANCIAL_CATEGORY_NATURE_MISMATCH');
  }
  if (['PRAVIA', 'DEVOLUCION'].includes(input.categoria) && input.naturaleza !== 'EGRESO') {
    throw new FinancialLedgerError('Los gastos internos y devoluciones deben registrarse como egresos.', 'FINANCIAL_CATEGORY_NATURE_MISMATCH');
  }
  if (input.categoria === 'REVERSO') {
    throw new FinancialLedgerError('La categoría REVERSO está reservada para el sistema.', 'FINANCIAL_CATEGORY_RESERVED');
  }
}

interface LedgerMovement {
  naturaleza: 'INGRESO' | 'EGRESO';
  categoria: string;
  tipo_movimiento: string;
  monto: number;
  estatus: string;
}

export function calculateFinancialPosition(input: {
  totalCliente: number;
  participacionPravia: number;
  movements: LedgerMovement[];
}) {
  // Un reverso compensa un movimiento que ya dejó de estar activo. Por ello el
  // renglón técnico REVERSO también se excluye de los saldos operativos.
  const active = input.movements.filter(
    (movement) => ['VALIDADO', 'RECIBIDO'].includes(movement.estatus) && movement.categoria !== 'REVERSO',
  );
  const ingresosCliente = active
    .filter((movement) => movement.naturaleza === 'INGRESO')
    .reduce((sum, movement) => sum + Number(movement.monto), 0);
  const devoluciones = active
    .filter((movement) => movement.tipo_movimiento === 'DEVOLUCION' || movement.categoria === 'DEVOLUCION')
    .reduce((sum, movement) => sum + Number(movement.monto), 0);
  const recibidoClienteNeto = Math.max(0, ingresosCliente - devoluciones);
  const honorariosPraviaRecibidos = active
    .filter((movement) => movement.naturaleza === 'INGRESO' && movement.categoria === 'HONORARIOS_PRAVIA')
    .reduce((sum, movement) => sum + Number(movement.monto), 0);
  const egresosTerceros = active
    .filter((movement) => movement.naturaleza === 'EGRESO' && ['NOTARIA', 'IMPUESTOS_DERECHOS', 'TERCEROS'].includes(movement.categoria))
    .reduce((sum, movement) => sum + Number(movement.monto), 0);
  const egresosPravia = active
    .filter((movement) => movement.naturaleza === 'EGRESO' && movement.categoria === 'PRAVIA')
    .reduce((sum, movement) => sum + Number(movement.monto), 0);
  const tercerosPresupuestados = Math.max(0, input.totalCliente - input.participacionPravia);

  return {
    recibido_cliente_neto: recibidoClienteNeto,
    saldo_cliente: Math.max(0, input.totalCliente - recibidoClienteNeto),
    honorarios_pravia_recibidos: honorariosPraviaRecibidos,
    terceros_presupuestados: tercerosPresupuestados,
    egresos_terceros: egresosTerceros,
    saldo_terceros: Math.max(0, tercerosPresupuestados - egresosTerceros),
    egresos_pravia: egresosPravia,
    utilidad_pravia: honorariosPraviaRecibidos - egresosPravia,
    fondos_retenidos: Math.max(0, recibidoClienteNeto - honorariosPraviaRecibidos - egresosTerceros),
  };
}
