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
    where: {
      OR: [
        { numero_pravia: { startsWith: `EXP-${year}-` } },
        { AND: [{ numero_pravia: { startsWith: 'EXP-' } }, { numero_pravia: { endsWith: `-${year}` } }] },
      ],
    },
    select: { numero_pravia: true },
  });
  const nextSequence = yearlyFolios.reduce((highest, expediente) => {
    const historical = expediente.numero_pravia.match(new RegExp(`^EXP-${year}-(\\d+)$`));
    const current = expediente.numero_pravia.match(new RegExp(`^EXP-(\\d+)-${year}$`));
    const sequence = historical?.[1] || current?.[1];
    return Math.max(highest, sequence ? Number(sequence) : 0);
  }, 0) + 1;
  return `EXP-${String(nextSequence).padStart(4, '0')}-${year}`;
}
