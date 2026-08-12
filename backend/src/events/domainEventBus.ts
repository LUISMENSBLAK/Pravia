import { PrismaClient } from '@prisma/client';

export interface DomainEvent<T = Record<string, unknown>> {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  actor_user_id: string;
  occurred_at: Date;
  correlation_id: string;
  payload: T;
}

export type EventHandler<T = Record<string, unknown>> = (event: DomainEvent<T>) => Promise<void>;

export class DomainEventBus {
  private static handlers: Map<string, Array<{ name: string; handler: EventHandler }>> = new Map();

  public static register(eventType: string, handlerName: string, handler: EventHandler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push({ name: handlerName, handler });
  }

  public static getHandlers(eventType: string) {
    return this.handlers.get(eventType) || [];
  }
}
