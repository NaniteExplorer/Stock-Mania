import { Kafka, type Producer, CompressionTypes, logLevel } from "kafkajs";
import type { EventBus, DomainEvent } from "./event-bus";

const globalWithKafka = globalThis as unknown as { _smKafkaProducer?: Producer };

async function getProducer(): Promise<Producer> {
  if (globalWithKafka._smKafkaProducer) return globalWithKafka._smKafkaProducer;

  const brokers = (process.env.KAFKA_BROKERS ?? "").split(",").map((b) => b.trim()).filter(Boolean);

  const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID ?? "stockmania",
    brokers,
    logLevel: logLevel.ERROR,
    ...(process.env.KAFKA_SASL_USERNAME
      ? {
          ssl: true,
          sasl: {
            mechanism: "plain" as const,
            username: process.env.KAFKA_SASL_USERNAME,
            password: (() => {
              if (!process.env.KAFKA_SASL_PASSWORD) {
                throw new Error(
                  "[kafka] KAFKA_SASL_PASSWORD is required when KAFKA_SASL_USERNAME is set.",
                );
              }
              return process.env.KAFKA_SASL_PASSWORD;
            })(),
          },
        }
      : {}),
  });

  const producer = kafka.producer({
    allowAutoTopicCreation: true,
    idempotent: true,
  });

  await producer.connect();

  // Graceful shutdown
  const shutdown = async () => {
    await producer.disconnect().catch(() => undefined);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  globalWithKafka._smKafkaProducer = producer;
  return producer;
}

export class KafkaEventBus implements EventBus {
  async publish(event: DomainEvent): Promise<void> {
    const producer = await getProducer();
    // "app/user.created"  →  "app.user.created"
    const topic = event.name.replace(/\//g, ".");

    await producer.send({
      topic,
      messages: [
        {
          key: (event.data.userId as string) ?? null,
          value: JSON.stringify({ event: event.name, data: event.data, ts: Date.now() }),
        },
      ],
      compression: CompressionTypes.GZIP,
    });
  }
}
