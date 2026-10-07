// Synthetic, non-fiscal evidence for the isolated pre-release AI extraction test.
const fs = require('node:fs/promises');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function main() {
  const documents = [{ destination: '/tmp/pravia-pre-release-income-qa-20261005.pdf', width: 612, height: 792, lines: [
    'Fecha de operacion: 05/10/2026',
    'Banco: Banco de Prueba QA',
    'Referencia: QA-INGRESO-20261005-001',
    'Concepto: Anticipo de honorarios QA',
    'Moneda: MXN',
    'Monto recibido: $12,345.67',
    'Este documento es una prueba sintetica. No representa un pago real.',
  ] }, { destination: '/tmp/pravia-pre-release-income-multi-qa-20261006.pdf', width: 612, height: 792, lines: [
    'Fecha de operacion: 06/10/2026',
    'Referencia: QA-INGRESO-MULTI-001',
    'Concepto: Pago de honorarios QA',
    'Subtotal: $10,000.00 MXN',
    'IVA: $1,600.00 MXN',
    'TOTAL PAGADO: $11,600.00 MXN',
    'Saldo anterior: $25,000.00 MXN',
    'Documento sintetico sin valor fiscal.',
  ] }, { destination: '/tmp/pravia-pre-release-income-visual-qa-20261006.pdf', width: 360, height: 600, lines: [
    'RECIBO QA - FORMATO VERTICAL',
    'Operacion 06/10/2026',
    'Referencia QA-VISUAL-001',
    'Transferencia de prueba',
    'PAGADO',
    '$ 789.40 MXN',
    'No representa un pago real.',
  ] }, { destination: '/tmp/pravia-pre-release-income-unreadable-qa-20261006.pdf', width: 360, height: 600, lines: [
    'RECIBO QA - SIN INFORMACION DE PAGO',
    'Imagen de prueba sin monto, fecha ni referencia.',
    'No representa una operacion real.',
  ] }];
  for (const document of documents) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([document.width, document.height]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    page.drawText('QA SINTETICO - SIN VALIDEZ FISCAL', {
      x: 28, y: document.height - 40, size: document.width < 400 ? 10 : 15,
      font: bold, color: rgb(0.1, 0.2, 0.35),
    });
    document.lines.forEach((line, index) => page.drawText(line, {
      x: document.width < 400 ? 28 : 44,
      y: document.height - 95 - index * (document.width < 400 ? 47 : 43),
      size: line.includes('$') ? (document.width < 400 ? 15 : 18) : 11,
      font: line.includes('$') ? bold : font,
      color: rgb(0.08, 0.12, 0.18),
    }));
    await fs.writeFile(document.destination, await pdf.save());
    process.stdout.write(`${document.destination}\n`);
  }
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
