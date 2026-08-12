const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const expId = '887f498c-8a97-4617-a6cb-c00ab04e100f';

  // First nullify all foreign key relations pointing to any movement in this expediente
  await prisma.movimientoFinanciero.updateMany({
    where: { expediente_id: expId },
    data: { movimiento_origen_id: null }
  });

  // Delete all movements except the single valid original movement
  const validId = '1bc6ea6c-5de0-4d17-84b3-dec925561ff5';

  const deleted = await prisma.movimientoFinanciero.deleteMany({
    where: {
      expediente_id: expId,
      id: { not: validId }
    }
  });

  console.log(`Eliminados ${deleted.count} movimientos duplicados/revertidos de prueba.`);

  const remaining = await prisma.movimientoFinanciero.findMany({
    where: { expediente_id: expId }
  });

  console.log(`=== MOVIMIENTOS RESTANTES EN DB (${remaining.length}) ===`);
  remaining.forEach(r => console.log(r.id, r.concepto, r.monto, r.estatus));
}

main().catch(console.error).finally(() => prisma.$disconnect());
