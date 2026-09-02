type ScreeningReportPdfInput = {
  queryId: string;
  generatedAt: string;
  queryKind: string;
  executionState: string;
  identityLabel: string;
  sources: Array<{ name: string; version: number | null; state: string }>;
  candidates: Array<{ reference: string; name: string; score: string; decision: string }>;
};

const pdfText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\xFF]/g, ' ');

/** Historical, human-readable report. It never claims to be an official clearance certificate. */
export function renderScreeningQueryReportPdf(data: ScreeningReportPdfInput): Buffer {
  const lines = [
    'PRAVIA OS', 'REPORTE DE CONSULTA',
    `Consulta: ${data.queryId}`,
    `Fecha de corte: ${data.generatedAt}`,
    `Tipo: ${data.queryKind}`,
    `Estado tecnico: ${data.executionState}`,
    `Identidad consultada: ${data.identityLabel}`,
    '', 'Fuentes consultadas',
    ...(data.sources.length ? data.sources.map((source) => `${source.name} | version ${source.version ?? 'no configurada'} | ${source.state}`) : ['No hay fuentes oficiales configuradas.']),
    '', 'Resultados y revision humana',
    ...(data.candidates.length ? data.candidates.map((candidate) => `${candidate.reference} | ${candidate.name} | ${candidate.score} | ${candidate.decision}`) : ['Sin candidatos persistidos.']),
    '', 'Este reporte conserva la evidencia historica de la consulta. No constituye una constancia oficial ni una determinacion juridica.',
  ];
  let y = 760;
  const content = lines.map((line, index) => {
    const size = index === 1 ? 18 : 9;
    const command = `BT /F1 ${size} Tf 44 ${y} Td (${pdfText(line).slice(0, 115)}) Tj ET`;
    y -= line ? 16 : 8;
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
