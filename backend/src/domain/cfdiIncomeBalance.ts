import { Prisma } from '@prisma/client';

export const RESERVING_CFDI_DRAFT_STATES = new Set(['DRAFT', 'BORRADOR', 'PREFACTURA']);
export const ISSUED_CFDI_STATES = new Set(['VIGENTE', 'TIMBRADO', 'CANCELACION_SOLICITADA', 'SUSTITUIDO']);

/** Single balance rule shared by CFDI V2 and its Mi Día reader. */
export function cfdiIncomeBalance(input: {
  amount: Prisma.Decimal;
  facturaEstado: string | null;
  linked: ReadonlyArray<{ estado: string; total: Prisma.Decimal }>;
}) {
  const issued = input.linked.filter((item) => ISSUED_CFDI_STATES.has(item.estado));
  const issuedAmount = issued.reduce((sum, item) => sum.plus(item.total), new Prisma.Decimal(0));
  const reservedDraftAmount = input.linked.filter((item) => RESERVING_CFDI_DRAFT_STATES.has(item.estado))
    .reduce((sum, item) => sum.plus(item.total), new Prisma.Decimal(0));
  const facturableAmount = input.amount;
  const invoicedAmount = input.facturaEstado === 'CARGADA' && !issued.length ? input.amount : issuedAmount;
  const remainingInvoiceableAmount = Prisma.Decimal.max(new Prisma.Decimal(0),
    facturableAmount.minus(invoicedAmount).minus(reservedDraftAmount));
  return { facturableAmount, invoicedAmount, reservedDraftAmount, remainingInvoiceableAmount };
}
