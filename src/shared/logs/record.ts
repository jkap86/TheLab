import { pool } from "@/shared/db";

import { anyDropped, createVisitAdmission, visitAdmissionConfig } from "./visit-admission";
import type { VisitAdmission, VisitRefusal } from "./visit-admission";

/**
 * Write one visit — or decline to, which is the half this file gained.
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
 * **Every write is admitted first, here, so neither writer can forget.** The
 * proxy and the beacon route both end up in this function, and the bound on
 * what the log will spend on inserts — a dedupe window, an in-flight cap, a
 * per-client rate and a process rate — is `./visit-admission`'s and is applied
 * before the pool is touched. A refused visit is counted, and the counts are
 * printed at most once a minute rather than once per refusal.
 *
 * **It never throws.** A visit is not worth a page: the caller hands this to
 * `event.waitUntil`, which keeps the invocation alive long enough for the insert
 * to land but has no answer for a rejection.
 */

export type VisitOutcome =
  | { recorded: true }
  | { recorded: false; reason: VisitRefusal | "failed" };

const ADMISSION_KEY = Symbol.for("thelab.logs.visit-admission");
const globalForAdmission = globalThis as unknown as {
  [key: symbol]: VisitAdmission | undefined;
};

/**
 * On `globalThis` for the live rooms' reason: under `next dev` an edit
 * re-evaluates this module, and a fresh admission would hand a flooding client
 * a new budget on every save.
 */
function admission(): VisitAdmission {
  const held = globalForAdmission[ADMISSION_KEY];
  if (held) return held;
  const { config, warnings } = visitAdmissionConfig(process.env);
  for (const warning of warnings) console.warn(`[logs] ${warning}`);
  return (globalForAdmission[ADMISSION_KEY] = createVisitAdmission(config));
}

/** For a test or a diagnostic: the process's admission. */
export const visitAdmission = admission;

const DROP_REPORT_MS = 60_000;
let lastDropReport = 0;

export async function recordVisit(visit: {
  ip: string | null;
  route: string;
}): Promise<VisitOutcome> {
  const gate = admission();
  const now = Date.now();
  const admitted = gate.admit({ client: visit.ip ?? "unknown", route: visit.route }, now);
  if (!admitted.ok) {
    if (now - lastDropReport >= DROP_REPORT_MS) {
      lastDropReport = now;
      const counts = gate.drain();
      if (anyDropped(counts)) {
        console.warn(
          `[logs] Visits not written in the last minute: ` +
            `budget ${counts.budget}, client ${counts.client}, ` +
            `in-flight ${counts["in-flight"]}, duplicate ${counts.duplicate}.`,
        );
      }
    }
    return { recorded: false, reason: admitted.reason };
  }

  try {
    await pool.query(`INSERT INTO visitor_logs (ip, route) VALUES ($1, $2)`, [
      visit.ip,
      visit.route,
    ]);
    return { recorded: true };
  } catch (error) {
    console.error("[logs] Failed to record a visit:", error);
    return { recorded: false, reason: "failed" };
  } finally {
    admitted.release();
  }
}
