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

const _global = globalThis as unknown as { _smEventBus?: EventBus };

async function resolveImpl(): Promise<EventBus> {
  if (_global._smEventBus) return _global._smEventBus;
  if (process.env.KAFKA_BROKERS) {
    const { KafkaEventBus } = await import("./kafka");
    _global._smEventBus = new KafkaEventBus();
  } else {
    _global._smEventBus = new InngestEventBus();
  }
  return _global._smEventBus;
}

export const eventBus: EventBus = {
  publish: (event) => resolveImpl().then((b) => b.publish(event)),
};
