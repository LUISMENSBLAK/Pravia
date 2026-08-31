import type { ISRCalculationInput, ISRCalculationResult } from './isrTaxEngine';

export type ISRDeterminationPdfData = {
  folio: string;
  version: number;
  generatedDate: string;
  input: ISRCalculationInput;
  result: ISRCalculationResult;
  formatSource: string;
};

const text = (value: unknown) => String(value ?? '')
  .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  .replace(/[^\x20-\xFF]/g, ' ');

const money = (value: string) => `$${value} MXN`;

/**
 * Presentational renderer only. Tax amounts always come from the immutable
 * calculation version produced by isrTaxEngine; this function never computes tax.
 */
export function renderISRDeterminationPdf(data: ISRDeterminationPdfData): Buffer {
  const lines = [
    'PRAVIA OS',
    'DETERMINACION PROVISIONAL DE ISR',
    `Calculo: ${data.folio} | Version: ${data.version}`,
    `Fecha de generacion: ${data.generatedDate}`,
    `Contribuyente: ${data.input.taxpayer.fullName}`,
    `RFC: ${data.input.taxpayer.rfc}`,
    `Inmueble: ${data.input.property.description}`,
    `Fecha de adquisicion: ${data.input.acquisitionDate}`,
    `Fecha de enajenacion: ${data.input.saleDate}`,
    `Precio de enajenacion: ${money(data.input.salePrice)}`,
    '',
    `Ingreso gravado considerado: ${money(data.result.taxableIncome)}`,
    `Deducciones consideradas: ${money(data.result.consideredDeductions)}`,
    `Ganancia determinada: ${money(data.result.gain)}`,
    `Base para tarifa: ${money(data.result.tariffBase)}`,
    `ISR provisional federal: ${money(data.result.provisionalFederalISR)}`,
    '',
    'Fundamento: LISR 119, 121 y 126; tarifa normativa versionada.',
    `Fuente normativa: ${data.result.ruleSet.normativeSource}`,
    `Jurisdiccion: ${data.result.ruleSet.jurisdiction}`,
    `Vigencia: ${data.result.ruleSet.validFrom} a ${data.result.ruleSet.validTo}`,
    `Regla: ${data.result.ruleSet.key} / ${data.result.ruleSet.version}`,
    `Formato: ${data.formatSource}`,
    '',
    'Documento informativo sujeto a revision humana. No sustituye la determinacion fiscal definitiva.',
  ];
  let y = 760;
  const content = lines.map((line, index) => {
    const size = index === 1 ? 16 : index === 15 ? 13 : 9;
    const command = `BT /F1 ${size} Tf 48 ${y} Td (${text(line)}) Tj ET`;
    y -= line ? 17 : 9;
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
}
