import { Inngest } from "inngest";

/**
 * Inngest application client. The app `id` namespaces all functions + events.
 *
 * SCALE: Inngest is the durable event/queue + cron layer today. To move to
 * Kafka, publish via the EventBus (./event-bus) and replace this client and the
 * Inngest functions with Kafka producers/consumers — publishers stay unchanged.
 */
export const inngest = new Inngest({
  id: "stockmania",
  ai: { gemini: { apiKey: process.env.GEMINI_API_KEY ?? "" } },
});
