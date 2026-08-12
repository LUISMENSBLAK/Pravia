import { Prisma } from '@prisma/client';

/**
 * Reserva el siguiente folio dentro de la transacción que crea el expediente.
 * Todos los puntos de alta deben usar esta función para compartir el mismo lock.
 */
export async function reserveExpedienteFolio(
  tx: Prisma.TransactionClient,
  effectiveDate = new Date(),
) {
  const year = effectiveDate.getFullYear();
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:expediente-folio:${year}`}))`);
  const yearlyFolios = await tx.expediente.findMany({
    where: { numero_pravia: { startsWith: `EXP-${year}-` } },
    select: { numero_pravia: true },
  });
  const nextSequence = yearlyFolios.reduce((highest, expediente) => {
    const match = expediente.numero_pravia.match(new RegExp(`^EXP-${year}-(\\d+)$`));
    return Math.max(highest, match ? Number(match[1]) : 0);
  }, 0) + 1;
  return `EXP-${year}-${String(nextSequence).padStart(4, '0')}`;
}
