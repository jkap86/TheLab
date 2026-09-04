import { pool } from "@/shared/db";

/**
 * Write one visit.
 *
 * **This runs inside the proxy bundle, and reaches the database directly.** The
 * app this was ported from cannot: its middleware is on the Edge runtime, where
 * `pg` does not exist, so it fires an HTTP request at its own public hostname
 * and an API route does the insert — one extra inbound request per page view,
 * against a URL hardcoded in the source, through an axios instance carrying
 * three retries, so a failing log endpoint costs four requests a view. Next 16's
 * Proxy defaults to the Node.js runtime and the server loads it with a plain
 * `require()` in-process, so `globalThis.pgPool` here is the same pool the route
 * handlers use — which is exactly what `db/pool.ts` caches it for. The hop, the
 * hostname and the retries all go away.
 *
 * **It never throws.** A visit is not worth a page: the caller hands this to
 * `event.waitUntil`, which keeps the invocation alive long enough for the insert
 * to land but has no answer for a rejection.
 */
export async function recordVisit(visit: {
  ip: string | null;
  route: string;
  viewer: string | null;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO visitor_logs (ip, route, viewer) VALUES ($1, $2, $3)`,
      [visit.ip, visit.route, visit.viewer],
    );
  } catch (error) {
    console.error("[logs] Failed to record a visit:", error);
  }
}
