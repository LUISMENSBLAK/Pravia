import { PrismaClient } from '@prisma/client';
import { DomainEventBus, DomainEvent } from '../events/domainEventBus';

export class DomainEventOutboxService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Procesador del Outbox con Reclamación Atómica (FOR UPDATE SKIP LOCKED)
   * y Garantía Estricta de Idempotencia por Handler.
   */
  public async processPendingOutboxEvents(batchSize: number = 10, workerId: string = `worker-${process.pid}`): Promise<number> {
    // 1. Reclamación Atómica de Eventos usando FOR UPDATE SKIP LOCKED
    // Esto garantiza que múltiples workers concurrentes nunca reclamen ni procesen el mismo evento.
    const claimedEvents: any[] = await this.prisma.$queryRawUnsafe(`
      UPDATE "domain_event_outbox"
      SET "estatus" = 'PROCESANDO',
          "locked_at" = NOW(),
          "locked_by" = $1,
          "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "domain_event_outbox"
        WHERE "estatus" IN ('PENDIENTE', 'FALLIDO')
          AND "attempts" < 5
          AND "available_at" <= NOW()
        ORDER BY "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      RETURNING *;
    `, workerId, batchSize);

    if (!claimedEvents || claimedEvents.length === 0) {
      return 0;
    }

    let processedCount = 0;

    for (const outboxRecord of claimedEvents) {
      const handlers = DomainEventBus.getHandlers(outboxRecord.event_type);
      if (handlers.length === 0) {
        await this.prisma.domainEventOutbox.update({
          where: { id: outboxRecord.id },
          data: {
            estatus: 'FALLIDO',
            last_error: `NO_HANDLER_REGISTERED:${outboxRecord.event_type}`,
            locked_at: null,
            locked_by: null,
          },
        });
        continue;
      }
      let allHandlersSucceeded = true;
      let lastErrorMsg: string | null = null;

      const domainEvent: DomainEvent = {
        event_id: outboxRecord.id,
        event_type: outboxRecord.event_type,
        aggregate_type: outboxRecord.aggregate_type,
        aggregate_id: outboxRecord.aggregate_id,
        actor_user_id: (outboxRecord.payload as any)?.actor_user_id || 'system',
        occurred_at: outboxRecord.occurred_at,
        correlation_id: outboxRecord.correlation_id,
        payload: outboxRecord.payload as Record<string, unknown>
      };

      for (const { name: handlerName, handler } of handlers) {
        // Flujo recomendado para Idempotencia Estricta:
        // 1. Consultar el estado existente antes de ejecutar
        const existingLog = await this.prisma.domainEventProcessingLog.findUnique({
          where: {
            event_id_handler_name: {
              event_id: domainEvent.event_id,
              handler_name: handlerName
            }
          }
        });

        // 2. Si ya está COMPLETADO, omitir el procesamiento inmediatamente
        if (existingLog && existingLog.estatus === 'COMPLETADO') {
          continue;
        }

        // 3. Si está FALLIDO, reintentar; si no existe, crearlo como PROCESANDO
        let procLog;
        if (!existingLog) {
          procLog = await this.prisma.domainEventProcessingLog.create({
            data: {
              event_id: domainEvent.event_id,
              handler_name: handlerName,
              estatus: 'PROCESANDO',
              correlation_id: domainEvent.correlation_id,
              started_at: new Date(),
              attempts: 1
            }
          });
        } else {
          procLog = await this.prisma.domainEventProcessingLog.update({
            where: { id: existingLog.id },
            data: {
              estatus: 'PROCESANDO',
              attempts: existingLog.attempts + 1,
              started_at: new Date()
            }
          });
        }

        try {
          // Ejecutar handler de manera segura
          await handler(domainEvent);

          // Actualizar a COMPLETADO tras ejecución exitosa
          await this.prisma.domainEventProcessingLog.update({
            where: { id: procLog.id },
            data: {
              estatus: 'COMPLETADO',
              processed_at: new Date(),
              last_error: null
            }
          });
        } catch (err: any) {
          allHandlersSucceeded = false;
          lastErrorMsg = err.message || 'Error desconocido en handler';

          await this.prisma.domainEventProcessingLog.update({
            where: { id: procLog.id },
            data: {
              estatus: 'FALLIDO',
              last_error: lastErrorMsg
            }
          });
        }
      }

      if (allHandlersSucceeded) {
        await this.prisma.domainEventOutbox.update({
          where: { id: outboxRecord.id },
          data: {
            estatus: 'PROCESADO',
            processed_at: new Date(),
            last_error: null,
            locked_at: null,
            locked_by: null
          }
        });
        processedCount++;
      } else {
        await this.prisma.domainEventOutbox.update({
          where: { id: outboxRecord.id },
          data: {
            estatus: 'FALLIDO',
            last_error: lastErrorMsg,
            locked_at: null,
            locked_by: null
          }
        });
      }
    }

    return processedCount;
  }
}
