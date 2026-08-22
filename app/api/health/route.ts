import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Readiness probe. `k8s/` points at this path, so the path and the response
 * shape are load-bearing even though the body shrank a lot.
 *
 * v1 probed Mongo, Redis and Kafka and reported "disabled" for whichever was
 * unconfigured — which meant a deployment with no database at all still returned
 * `ok`. v2 has exactly one dependency, so the probe either round-trips a query
 * against libSQL or reports unhealthy. There is no degraded state to hide in.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const startedAt = Date.now();
  let database: "ok" | "unreachable" = "ok";
  let detail: string | undefined;

  try {
    await db.run(sql`select 1`);
  } catch (error) {
    database = "unreachable";
    detail = error instanceof Error ? error.message : String(error);
  }

  const healthy = database === "ok";
  return Response.json(
    {
      status: healthy ? "ok" : "unhealthy",
      database,
      ...(detail ? { detail } : {}),
      latencyMs: Date.now() - startedAt,
      uptimeSeconds: Math.round(process.uptime()),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
