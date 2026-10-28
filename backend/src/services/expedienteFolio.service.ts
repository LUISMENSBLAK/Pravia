import { Prisma } from '@prisma/client';
import { reserveOrganizationFolio } from './organizationFolio.service';

/**
 * Reserva el siguiente folio dentro de la transacción que crea el expediente.
 * Todos los puntos de alta deben usar esta función para compartir el mismo lock.
 */
export async function reserveExpedienteFolio(
  tx: Prisma.TransactionClient,
  organizationId: string,
  effectiveDate = new Date(),
  seriesCode?: string | null,
) {
  return reserveOrganizationFolio(tx, organizationId, 'EXP', effectiveDate, seriesCode);
}
