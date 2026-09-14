/**
 * Who may hold a live stream open on this process, and how many.
 *
 * **The two SSE routes accepted anyone, without limit.** A gametime subscriber
 * holds their stored lineups, a delivery baseline of every league's serialised
 * answer, and a solve per tick; a picktracker subscriber pins a poller open.
 * Every bound in front of them was about something else — the Sleeper limiter
 * bounds what reaches Sleeper, per-stream backpressure bounds one socket's
 * backlog — and none of them said how many sockets, how many per address, how
 * many per room, or how many rooms could be cold-opening at once. A hundred
 * tabs on one week was a hundred solves a tick on a 512 MB dyno, and a
 * hundred distinct league ids was a hundred four-call Sleeper reads in flight
 * before any of them had a reader.
 *
 * Four bounds, one place, both stream kinds:
 *
 * - **A process-wide total**, counted from the moment a route *reserves* —
 *   before it resolves a user, reads lineups or opens a room — until the
 *   stream is torn down. A connection that is still initialising is a
 *   connection, and the expensive work happens during initialisation.
 * - **Per client**, keyed by the address the trusted proxy saw
 *   (`shared/request`). Sized for tabs and for households: several people
 *   behind one NAT, each with a tab or two, fit under it; a script opening
 *   streams in a loop does not.
 * - **Per subject** — one NFL week's room, one league's draft room. A room's
 *   cost is per subscriber, so a room is bounded on its own however the total
 *   is spread.
 * - **Cold openings**, counted per *distinct* subject. Same-subject joiners
 *   share the one read the room dedupes anyway; what this bounds is how many
 *   different rooms may be mid-open at once, which is the one shape the dedupe
 *   never touched.
 *
 * **Per process, and only per process.** These are in-memory counters, so on
 * two dynos the effective ceiling is twice the configured one and a client is
 * counted separately by each dyno the router happens to send them to. That is
 * stated rather than hidden: a deployment-wide bound needs a shared store, and
 * this is not one. On the one-dyno deployment this app ships as, the two are
 * the same thing.
 *
 * Pure: a factory over the config and nothing else, so the bounds are asserted
 * as counts under Node's own runner. The process singleton is built from it at
 * the bottom, on `sync-admission`'s exact terms.
 */

export type StreamKind = "gametime" | "picktracker";

export type StreamAdmissionConfig = {
  /** Streams held open on this process at once, both kinds together. */
  maxConnections: number;
  /** Streams one client address may hold at once. */
  maxPerClient: number;
  /** Streams one subject (a week room, a league room) may hold at once. */
  maxPerSubject: number;
  /** Distinct subjects that may be cold-opening at once. */
  maxOpening: number;
  /** What a refused caller is told to wait, in seconds. */
  retryAfterSeconds: number;
};

/**
 * The defaults, sized for one 512 MB dyno and roughly twenty-five people.
 *
 * Forty connections is twenty-five readers with room for a second tab or a
 * reconnect that overlaps the socket it replaces. Eight per client is a
 * household on one address with a couple of tabs each — the cap trips at the
 * ninth concurrent stream from one address, which is a script rather than a
 * family. Twenty-four per subject is a twelve-team league's draft room with
 * every manager on two devices, which is the picktracker's own stated use
 * case. Four cold openings is enough that a Sunday's readers arriving on the
 * same week share one room open, while a burst of distinct league ids is
 * held to four four-call reads in flight.
 */
export const DEFAULT_STREAM_ADMISSION: StreamAdmissionConfig = {
  maxConnections: 40,
  maxPerClient: 8,
  maxPerSubject: 24,
  maxOpening: 4,
  retryAfterSeconds: 15,
};

/** The variables, named once so the reader and the README cannot drift. */
export const STREAM_ADMISSION_VARS = {
  maxConnections: "STREAM_MAX_CONNECTIONS",
  maxPerClient: "STREAM_MAX_PER_CLIENT",
  maxPerSubject: "STREAM_MAX_PER_SUBJECT",
  maxOpening: "STREAM_MAX_OPENING",
  retryAfterSeconds: "STREAM_RETRY_AFTER_SECONDS",
} as const satisfies Record<keyof StreamAdmissionConfig, string>;

/** Past these a number is a typo rather than a decision. */
const CEILINGS: Record<keyof StreamAdmissionConfig, number> = {
  maxConnections: 1_000,
  maxPerClient: 1_000,
  maxPerSubject: 1_000,
  maxOpening: 100,
  retryAfterSeconds: 3_600,
};

/**
 * Read the config, one variable per bound.
 *
 * Junk, zero and a value past the ceiling each fall back to that bound's
 * default with a warning — a typo in a dashboard must not open the process to
 * everybody, nor close it to everybody.
 */
export function streamAdmissionConfig(
  env: Record<string, string | undefined> = process.env,
): StreamAdmissionConfig & { warnings: string[] } {
  const warnings: string[] = [];
  const read = (key: keyof StreamAdmissionConfig): number => {
    const name = STREAM_ADMISSION_VARS[key];
    const raw = env[name]?.trim();
    const fallback = DEFAULT_STREAM_ADMISSION[key];
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > CEILINGS[key]) {
      warnings.push(
        `Ignoring ${name}="${raw}"; expected an integer from 1 to ${CEILINGS[key]}. Using ${fallback}.`,
      );
      return fallback;
    }
    return parsed;
  };
  return {
    maxConnections: read("maxConnections"),
    maxPerClient: read("maxPerClient"),
    maxPerSubject: read("maxPerSubject"),
    maxOpening: read("maxOpening"),
    retryAfterSeconds: read("retryAfterSeconds"),
    warnings,
  };
}

export type StreamRefusalReason = "capacity" | "client" | "subject" | "opening";

/** A caller that was not admitted, and what to tell it. */
export type StreamRefusal = {
  ok: false;
  reason: StreamRefusalReason;
  /** 429 where the caller itself is the reason; 503 where the process is. */
  status: 429 | 503;
  retryAfterSeconds: number;
};

export type StreamReservation = {
  ok: true;
  /**
   * Seat this connection in `subject`'s room, once. A refusal releases the
   * reservation as it answers — there is nothing left to hold — so a caller
   * answers with the refusal and needs no cleanup of its own for it.
   */
  attach(subject: string): { ok: true } | StreamRefusal;
  /**
   * Claim a cold-open slot for the attached subject. Shared by every
   * reservation opening the same subject, so simultaneous joiners of one room
   * cost one slot; refused when as many *other* subjects are already opening
   * as the bound allows. Never refuses a subject already opening. A refusal
   * releases the reservation, as `attach` does.
   */
  beginOpening(): { ok: true } | StreamRefusal;
  /** Hand the opening slot back, idempotently. Called by `release` too. */
  endOpening(): void;
  /**
   * Give everything back — idempotent, so a `finally` reachable from an abort
   * listener, a stream's `cancel` and a terminal error can all call it and
   * only the first one counts. A doubled release would widen the bound.
   */
  release(): void;
  /** For a log line: what this reservation holds. */
  readonly subject: string | null;
};

export type StreamAdmissionStats = {
  connections: number;
  byKind: Record<StreamKind, number>;
  clients: number;
  subjects: number;
  opening: number;
  refused: Record<StreamRefusalReason, number>;
};

export type StreamAdmission = {
  reserve(input: { kind: StreamKind; client: string }): StreamReservation | StreamRefusal;
  stats(): StreamAdmissionStats;
  readonly config: StreamAdmissionConfig;
};

/** Count one more under `key`, or one fewer, dropping the entry at zero. */
function bump(map: Map<string, number>, key: string, by: 1 | -1): number {
  const next = (map.get(key) ?? 0) + by;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
  return next;
}

export function createStreamAdmission(config: StreamAdmissionConfig): StreamAdmission {
  let connections = 0;
  const byKind: Record<StreamKind, number> = { gametime: 0, picktracker: 0 };
  // Every map below holds only keys with a live count: an entry is dropped the
  // moment its count reaches zero, so the maps are bounded by the connections
  // they describe rather than by every client or subject ever seen.
  const perClient = new Map<string, number>();
  const perSubject = new Map<string, number>();
  const opening = new Map<string, number>();
  const refused: Record<StreamRefusalReason, number> = {
    capacity: 0,
    client: 0,
    subject: 0,
    opening: 0,
  };

  const refuse = (reason: StreamRefusalReason): StreamRefusal => {
    refused[reason] += 1;
    return {
      ok: false,
      reason,
      status: reason === "client" ? 429 : 503,
      retryAfterSeconds: config.retryAfterSeconds,
    };
  };

  return {
    config,
    reserve({ kind, client }) {
      // Checked and taken in one synchronous step, which is what makes the
      // bound hold under concurrent arrivals: nothing awaits between the
      // check and the count.
      if (connections >= config.maxConnections) return refuse("capacity");
      if ((perClient.get(client) ?? 0) >= config.maxPerClient) return refuse("client");

      connections += 1;
      byKind[kind] += 1;
      bump(perClient, client, 1);

      let subject: string | null = null;
      let attached = false;
      let openingHeld = false;
      let released = false;

      const endOpening = () => {
        if (!openingHeld || subject === null) return;
        openingHeld = false;
        bump(opening, subject, -1);
      };

      const release = () => {
        if (released) return;
        released = true;
        endOpening();
        if (attached && subject !== null) bump(perSubject, subject, -1);
        bump(perClient, client, -1);
        byKind[kind] -= 1;
        connections -= 1;
      };

      const reservation: StreamReservation = {
        ok: true,
        get subject() {
          return subject;
        },
        attach(next) {
          if (released) return refuse("capacity");
          if (attached) throw new Error("A stream reservation attaches to one subject only");
          if ((perSubject.get(next) ?? 0) >= config.maxPerSubject) {
            release();
            return refuse("subject");
          }
          subject = next;
          attached = true;
          bump(perSubject, next, 1);
          return { ok: true };
        },
        beginOpening() {
          if (released) return refuse("capacity");
          if (subject === null) throw new Error("Attach a subject before opening its room");
          if (openingHeld) return { ok: true };
          // A subject already opening is joined, never refused: that is the
          // room's own dedupe, seen from here.
          if (!opening.has(subject) && opening.size >= config.maxOpening) {
            release();
            return refuse("opening");
          }
          openingHeld = true;
          bump(opening, subject, 1);
          return { ok: true };
        },
        endOpening,
        release,
      };
      return reservation;
    },
    stats: () => ({
      connections,
      byKind: { ...byKind },
      clients: perClient.size,
      subjects: perSubject.size,
      opening: opening.size,
      refused: { ...refused },
    }),
  };
}

/**
 * The 429 or 503 a refused caller is answered with, **before** any stream is
 * opened — so the status reaches the browser rather than being lost behind
 * headers that have already been flushed.
 */
export function streamRefusalResponse(refusal: StreamRefusal): Response {
  const error =
    refusal.reason === "client"
      ? "Too many live connections from your address. Close a tab and try again shortly."
      : "Too many live connections right now. Try again shortly.";
  return Response.json(
    { error },
    {
      status: refusal.status,
      headers: {
        "Retry-After": String(refusal.retryAfterSeconds),
        // A refusal is a fact about this instant, never one for a cache.
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * The process's admission, cached on `globalThis` in every environment — the
 * pool's rule, for the pool's reason: a route bundle that got its own copy of
 * this module would get its own counters and its own idea of how many streams
 * are open, and two copies of a cap of forty is a cap of eighty from nowhere.
 */
const globalForAdmission = globalThis as unknown as {
  streamAdmission?: StreamAdmission;
};

export const streamAdmission: StreamAdmission = (globalForAdmission.streamAdmission ??=
  buildProcessAdmission());

function buildProcessAdmission(): StreamAdmission {
  const { warnings, ...config } = streamAdmissionConfig();
  for (const warning of warnings) console.warn(`[streams] ${warning}`);
  return createStreamAdmission(config);
}
