import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';

export class ExpedienteFinanceValidationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export const moneyDecimal = (value: unknown, field = 'importe') => {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new ExpedienteFinanceValidationError('EXP008_MONEY_INVALID', `${field} debe ser un importe no negativo con máximo dos decimales.`);
  const amount = new Prisma.Decimal(normalized).toDecimalPlaces(2);
  if (amount.lte(0)) throw new ExpedienteFinanceValidationError('EXP008_MONEY_REQUIRED', `${field} debe ser mayor a cero.`);
  if (amount.gt('999999999999.99')) throw new ExpedienteFinanceValidationError('EXP008_MONEY_OUT_OF_RANGE', `${field} supera el máximo permitido.`);
  return amount;
};

export const validateIncomeAllocation = (total: unknown, honorarios: unknown, taxes: unknown) => {
  const totalAmount = moneyDecimal(total, 'Monto validado');
  const fees = new Prisma.Decimal(String(honorarios ?? '0')).toDecimalPlaces(2);
  const tax = new Prisma.Decimal(String(taxes ?? '0')).toDecimalPlaces(2);
  if (fees.isNegative() || tax.isNegative()) throw new ExpedienteFinanceValidationError('EXP008_ALLOCATION_NEGATIVE', 'La aplicación no admite importes negativos.');
  if (!fees.plus(tax).equals(totalAmount)) throw new ExpedienteFinanceValidationError('EXP008_ALLOCATION_UNBALANCED', 'Honorarios más Impuestos y derechos debe coincidir con el monto validado.');
  return { total: totalAmount, honorarios: fees, impuestosDerechos: tax };
};

export const hashVerificationToken = (token: string) => createHash('sha256').update(token).digest('hex');

const pdfText = (value: string) => value.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/[()\\]/g, '\\$&').slice(0, 110);
const renderSimplePdf = (title: string, lines: string[]) => {
  let y = 742;
  const content = [title, ...lines].map((line, index) => {
    const size = index === 0 ? 18 : 10;
    const command = `BT /F1 ${size} Tf 54 ${y} Td (${pdfText(line)}) Tj ET`;
    y -= index === 0 ? 34 : 18;
    return command;
  }).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
};

export const renderPaymentRequestPdf = (input: { folio: string; concept: string; amount: string; beneficiary?: string | null; dependency?: string | null; reference?: string | null; createdAt: string; formatSource: string }) => renderSimplePdf('Solicitud de pago PRAVIA', [
  `Expediente: ${input.folio}`, `Concepto: ${input.concept}`, `Importe: $${input.amount} MXN`,
  `Beneficiario: ${input.beneficiary || 'No indicado'}`, `Dependencia: ${input.dependency || 'No indicada'}`,
  `Referencia: ${input.reference || 'No indicada'}`, `Fecha: ${input.createdAt}`, `Formato: ${input.formatSource}`,
  '', 'Documento operativo. No acredita que el pago haya sido realizado.',
]);

export const renderPraviaReceiptPdf = (input: { receiptFolio: string; caseFolio: string; concept: string; amount: string; date: string; code: string; verificationUrl: string; formatSource: string }) => renderSimplePdf('Comprobante PRAVIA', [
  `Folio: ${input.receiptFolio}`, `Expediente: ${input.caseFolio}`, `Concepto: ${input.concept}`,
  `Importe validado: $${input.amount} MXN`, `Fecha: ${input.date}`, `Codigo verificable: ${input.code}`,
  `Verificacion: ${input.verificationUrl}`, `Formato: ${input.formatSource}`, '',
  'Comprobante operativo PRAVIA. No es CFDI ni comprobante fiscal.',
]);
