import { describe, expect, it, vi } from 'vitest';
import { DomainEventOutboxService } from './domainEventOutbox.service';

describe('DomainEventOutboxService', () => {
  it('no marca como procesado un evento sin handlers registrados', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{
        id: 'event-without-handler',
        event_type: 'EventoSinHandlerDePrueba',
        aggregate_type: 'Expediente',
        aggregate_id: 'exp-1',
        payload: { actor_user_id: 'user-1' },
        occurred_at: new Date(),
        correlation_id: 'corr-1',
      }]),
      domainEventOutbox: { update },
    } as any;

    const processed = await new DomainEventOutboxService(prisma).processPendingOutboxEvents();

    expect(processed).toBe(0);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'event-without-handler' },
      data: expect.objectContaining({
        estatus: 'FALLIDO',
        last_error: 'NO_HANDLER_REGISTERED:EventoSinHandlerDePrueba',
      }),
    }));
  });
});
