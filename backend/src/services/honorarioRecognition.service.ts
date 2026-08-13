import type { Prisma } from '@prisma/client';
import { FinanceDomainError } from '../domain/financeCore';

type Tx = Prisma.TransactionClient;

export async function recognizeAcceptedQuote(tx: Tx, input: { cotizacionId: string; actorUserId: string; recognizedAt?: Date }) {
  const quote = await tx.cotizacion.findUnique({
    where: { id: input.cotizacionId },
    include: {
      versiones: { where: { aprobada: true }, orderBy: { version: 'desc' }, take: 1 },
      expediente: { select: { id: true, abogado_id: true, notaria_id: true } },
    },
  });
  if (!quote) throw new FinanceDomainError('Cotización no encontrada.', 'QUOTE_NOT_FOUND', 404);
  const version = quote.versiones[0];
  if (!version) throw new FinanceDomainError('La cotización no tiene una versión económica aprobada.', 'APPROVED_QUOTE_VERSION_REQUIRED');
  const amount = Number(version.honorarios_pravia);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new FinanceDomainError('La versión aprobada no contiene honorarios reconocibles.', 'GENERATED_FEE_INVALID');
  }
  return tx.honorarioGenerado.upsert({
    where: { cotizacion_id: quote.id },
    create: {
      clave_origen: `COTIZACION:${quote.id}`,
      cotizacion_id: quote.id,
      cotizacion_version_id: version.id,
      expediente_id: quote.expediente?.id,
      notaria_id: quote.expediente?.notaria_id || quote.notaria_id,
      responsable_id: quote.expediente?.abogado_id || quote.user_id,
      monto: amount,
      fecha_reconocimiento: input.recognizedAt || new Date(),
      evento_reconocimiento: 'COTIZACION_ACEPTADA',
      reconocido_por_id: input.actorUserId,
    },
    update: quote.expediente ? { expediente_id: quote.expediente.id } : {},
  });
}

export async function attachGeneratedFeeToExpediente(tx: Tx, input: { cotizacionId: string; expedienteId: string }) {
  return tx.honorarioGenerado.updateMany({
    where: { cotizacion_id: input.cotizacionId, expediente_id: null },
    data: { expediente_id: input.expedienteId },
  });
}
