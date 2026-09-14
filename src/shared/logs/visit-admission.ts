/**
 * How many visits the log will *write*, and which — the admission in front of
 * both writers, applied inside `recordVisit` so neither the proxy nor the
 * beacon route can forget it.
 *
 * **Why a bound on a write nobody reads back for.** A visit is fire-and-forget:
 * the proxy hands it to `event.waitUntil` and the beacon route answers 204
 * before the insert lands, so nothing in the request path ever waits on the
 * table. That is also why nothing in the request path ever *refused* one — a
 * scanner walking a thousand invented paths, or a script posting to the beacon
 * in a loop, was a thousand inserts against a pool of ten connections that the
 * lineups read is also waiting on, and a table nothing prunes growing at
 * whatever rate the internet felt like. `loggedRoute` now refuses the invented
 * paths; this bounds the rest.
 *
 * **Four bounds, checked cheapest first, and a refusal costs no token.**
 *
 * 1. **A repeat of one route from one client inside `dedupeMs`** is dropped —
 *    the throttle the beacon route used to keep for itself, sized against a
 *    double-fired effect and a script in a loop rather than a reader who
 *    genuinely opened the same page twice.
 * 2. **In-flight inserts are capped**, which is the one that protects the pool:
 *    however fast visits arrive, no more than `maxInFlight` connections are ever
 *    spent on them at once.
 * 3. **A client's own budget**, a token bucket refilled at
 *    `perClientPerMinute`, so one address cannot spend the process's budget.
 * 4. **The process's budget**, a bucket refilled at `writesPerMinute`, which is
 *    the whole-table bound: at the default a full day of a dyno being hammered
 *    is under half a million rows, which the retention loop removes on its own
 *    schedule.
 *
 * A bucket's capacity is one minute's refill, so a quiet minute followed by a
 * page of twenty tabs opening is admitted whole; what is shed is a *sustained*
 * rate, which is what an attack is and a reader is not.
 *
 * **Drops are counted, not logged one by one** — `drain()` hands the counts to
 * whoever reports them (`record.ts`, once a minute at most). A log line per
 * refused write under load is a second flood standing in for the first.
 *
 * **Per process.** The buckets live in one dyno's memory, so a deployment
 * with several web dynos admits `writesPerMinute` per dyno, not in total. The
 * retention loop is the deployment-wide bound on the table; this is the bound
 * on what one process spends getting rows into it.
 *
 * Pure: the clock is an argument, and nothing here reaches the pool.
 */

export type VisitAdmissionConfig = {
  /** Writes admitted per minute, process-wide. */
  writesPerMinute: number;
  /** Writes admitted per minute from one client. */
  perClientPerMinute: number;
  /** Inserts allowed in flight at once. */
  maxInFlight: number;
  /** A repeat of one route from one client inside this window is dropped. */
  dedupeMs: number;
  /** The most client buckets — and dedupe keys — held; the oldest go past it. */
  maxKeys: number;
};

export const DEFAULT_VISIT_ADMISSION: VisitAdmissionConfig = {
  writesPerMinute: 300,
  perClientPerMinute: 30,
  maxInFlight: 4,
  dedupeMs: 2_000,
  maxKeys: 5_000,
};

export const VISIT_ADMISSION_VARS = {
  writesPerMinute: "VISITOR_LOG_WRITES_PER_MINUTE",
  perClientPerMinute: "VISITOR_LOG_WRITES_PER_CLIENT_PER_MINUTE",
  maxInFlight: "VISITOR_LOG_MAX_IN_FLIGHT",
} as const;

const BOUNDS: Record<keyof typeof VISIT_ADMISSION_VARS, [number, number]> = {
  writesPerMinute: [1, 100_000],
  perClientPerMinute: [1, 10_000],
  maxInFlight: [1, 64],
};

/** The configured admission, each variable falling back on its own. */
export function visitAdmissionConfig(
  env: Record<string, string | undefined>,
): { config: VisitAdmissionConfig; warnings: string[] } {
  const config = { ...DEFAULT_VISIT_ADMISSION };
  const warnings: string[] = [];
  for (const key of Object.keys(VISIT_ADMISSION_VARS) as Array<keyof typeof VISIT_ADMISSION_VARS>) {
    const variable = VISIT_ADMISSION_VARS[key];
    const raw = env[variable]?.trim();
    if (!raw) continue;
    const parsed = Number(raw);
    const [min, max] = BOUNDS[key];
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      warnings.push(
        `${variable}=${JSON.stringify(raw)} is not a whole number between ${min} and ${max}; ` +
          `using ${DEFAULT_VISIT_ADMISSION[key]}.`,
      );
      continue;
    }
    config[key] = parsed;
  }
  return { config, warnings };
}

export type VisitRefusal = "duplicate" | "in-flight" | "client" | "budget";

export type VisitAdmitted = { ok: true; release: () => void };
export type VisitDecision = VisitAdmitted | { ok: false; reason: VisitRefusal };

export type VisitDropCounts = Record<VisitRefusal, number>;

export type VisitAdmission = {
  admit(visit: { client: string; route: string }, now: number): VisitDecision;
  /** Live counters, for a test. */
  stats(): { inFlight: number; dropped: VisitDropCounts };
  /** The drop counts since the last drain, and a reset. */
  drain(): VisitDropCounts;
  readonly config: VisitAdmissionConfig;
};

type Bucket = { tokens: number; at: number };

const zeroDrops = (): VisitDropCounts => ({ duplicate: 0, "in-flight": 0, client: 0, budget: 0 });

export function createVisitAdmission(
  config: VisitAdmissionConfig = DEFAULT_VISIT_ADMISSION,
): VisitAdmission {
  const global: Bucket = { tokens: config.writesPerMinute, at: 0 };
  const clients = new Map<string, Bucket>();
  const recent = new Map<string, number>();
  let inFlight = 0;
  let dropped = zeroDrops();

  const refill = (bucket: Bucket, ratePerMinute: number, now: number): void => {
    if (now > bucket.at) {
      bucket.tokens = Math.min(ratePerMinute, bucket.tokens + ((now - bucket.at) / 60_000) * ratePerMinute);
      bucket.at = now;
    }
  };

  const clientBucket = (client: string, now: number): Bucket => {
    let bucket = clients.get(client);
    if (!bucket) {
      bucket = { tokens: config.perClientPerMinute, at: now };
      clients.set(client, bucket);
      if (clients.size > config.maxKeys) {
        const oldest = clients.keys().next().value;
        if (oldest !== undefined) clients.delete(oldest);
      }
    }
    refill(bucket, config.perClientPerMinute, now);
    return bucket;
  };

  const refuse = (reason: VisitRefusal): VisitDecision => {
    dropped[reason] += 1;
    return { ok: false, reason };
  };

  return {
    config,
    admit({ client, route }, now) {
      const key = `${client}|${route}`;
      const last = recent.get(key);
      if (last !== undefined && now - last < config.dedupeMs) return refuse("duplicate");

      if (inFlight >= config.maxInFlight) return refuse("in-flight");

      const mine = clientBucket(client, now);
      if (mine.tokens < 1) return refuse("client");

      refill(global, config.writesPerMinute, now);
      if (global.tokens < 1) return refuse("budget");

      // Everything passed: spend both tokens, remember the pair, take a slot.
      mine.tokens -= 1;
      global.tokens -= 1;
      recent.delete(key);
      recent.set(key, now);
      if (recent.size > config.maxKeys) {
        const oldest = recent.keys().next().value;
        if (oldest !== undefined) recent.delete(oldest);
      }
      inFlight += 1;
      let released = false;
      return {
        ok: true,
        release: () => {
          if (released) return;
          released = true;
          inFlight -= 1;
        },
      };
    },
    stats: () => ({ inFlight, dropped: { ...dropped } }),
    drain: () => {
      const out = dropped;
      dropped = zeroDrops();
      return out;
    },
  };
}

/** Whether any drop was counted. */
export function anyDropped(counts: VisitDropCounts): boolean {
  return Object.values(counts).some((n) => n > 0);
}
