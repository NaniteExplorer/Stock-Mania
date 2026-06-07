import { inngest } from "@/core/queue/client";

export interface DomainEvent {
  name: string;
  data: Record<string, unknown>;
}

/**
 * Event-publishing abstraction. Today it forwards to Inngest; next session a
 * KafkaEventBus can implement the same interface. Call sites publish domain
 * events without knowing the transport.
 */
export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
}

class InngestEventBus implements EventBus {
  async publish(event: DomainEvent): Promise<void> {
    await inngest.send({ name: event.name, data: event.data });
  }
}

export const eventBus: EventBus = new InngestEventBus();
