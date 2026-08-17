import 'dotenv/config';
import prisma from '../src/config/prisma';
import { moneyToCents } from '../src/domain/financeCore';

async function main() {
  const movements = await prisma.movimientoFinanciero.findMany({
    select: {
      folio: true,
      monto: true,
      distribuciones: { select: { monto: true } },
    },
    orderBy: { fecha_movimiento: 'asc' },
  });

  const invalid = movements.flatMap((movement) => {
    const movementCents = Math.abs(moneyToCents(Number(movement.monto)));
    const distributionCents = movement.distribuciones.reduce((sum, item) => sum + moneyToCents(Number(item.monto)), 0);
    if (distributionCents <= movementCents) return [];
    return [{
      folio: movement.folio || 'SIN_FOLIO',
      difference: (distributionCents - movementCents) / 100,
    }];
  });

  console.log(JSON.stringify({
    mode: 'READ_ONLY',
    inspected: movements.length,
    invalidCount: invalid.length,
    invalid,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
