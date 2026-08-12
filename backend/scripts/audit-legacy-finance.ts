import prisma from '../src/config/prisma';
import { classifyLegacyPayment } from '../src/domain/legacyFinanceMigration';
import fs from 'fs';
import path from 'path';

async function main() {
  const limitArg = process.argv.find((item) => item.startsWith('--limit='));
  const outputArg = process.argv.find((item) => item.startsWith('--output-dir='));
  const limit = Math.min(Math.max(Number(limitArg?.split('=')[1] || 10_000), 1), 50_000);
  const payments = await prisma.pago.findMany({ orderBy: { fecha_registro: 'asc' }, take: limit });
  const movements = await prisma.movimientoFinanciero.findMany({ orderBy: { fecha_movimiento: 'asc' }, take: 100_000 });
  const rows = payments.map((payment) => {
    const decision = classifyLegacyPayment({
      ...payment,
      monto: Number(payment.monto),
    }, movements.map((movement) => ({ ...movement, monto: Number(movement.monto) })));
    return {
      legacy_pago_id: payment.id,
      importe: Number(payment.monto),
      origen: `Pago.${payment.categoria_ingreso}`,
      expediente_id: payment.expediente_id,
      cotizacion_id: payment.cotizacion_id,
      clasificacion: decision.classification,
      destino_propuesto: decision.proposal || null,
      posibles_duplicados: decision.possible_duplicate_ids,
      razon: decision.reason,
    };
  });
  const summary = rows.reduce<Record<string, { registros: number; importe: number }>>((acc, row) => {
    acc[row.clasificacion] ||= { registros: 0, importe: 0 };
    acc[row.clasificacion].registros += 1;
    acc[row.clasificacion].importe += row.importe;
    return acc;
  }, {});
  const report = { mode: 'DRY_RUN_READ_ONLY', generated_at: new Date().toISOString(), summary, rows };
  if (outputArg) {
    const outputDir = path.resolve(outputArg.split('=').slice(1).join('='));
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'legacy-finance.json'), `${JSON.stringify(report, null, 2)}\n`);
    const mdRows = rows.map((row) => `| ${row.legacy_pago_id} | ${row.clasificacion} | ${row.importe.toFixed(2)} | ${String(row.razon).replace(/\|/g, '\\|')} |`).join('\n');
    fs.writeFileSync(path.join(outputDir, 'legacy-finance.md'), `# Auditoría financiera legacy\n\nModo: **DRY_RUN_READ_ONLY**\n\n| Pago | Clasificación | Importe | Razón |\n| --- | --- | ---: | --- |\n${mdRows}\n`);
    const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csvRows = rows.map((row) => [row.legacy_pago_id, row.clasificacion, row.importe, row.expediente_id, row.cotizacion_id, row.posibles_duplicados.join('|'), row.razon].map(csvCell).join(',')).join('\n');
    fs.writeFileSync(path.join(outputDir, 'legacy-finance.csv'), `legacy_pago_id,clasificacion,importe,expediente_id,cotizacion_id,posibles_duplicados,razon\n${csvRows}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`No fue posible generar la auditoría: ${error.message}\n`);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
