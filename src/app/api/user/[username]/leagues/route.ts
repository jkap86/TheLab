import {
  getManagerLeagues,
  getManagerSyncState,
  managerSyncGate,
  syncManagerLeagues,
  toUserInfo,
} from "@/shared/manager";
import type { LeaguesStreamMessage } from "@/shared/contract";
import { ensurePlayersFresh } from "@/shared/players";

import { isInternalRequest } from "../../../internal-auth";
import { readFailureResponse } from "../../../read-failure";
import { resolveManagerRequest } from "../manager-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Managers whose background refresh is currently running (per server process). */
const refreshInFlight = new Set<string>();

/**
 * How many *cold* syncs this process will run at once.
 *
 * A cold sync is the expensive shape of this route: no cached leagues to serve,
 * so the full ~11-requests-per-league fan-out runs in the foreground, and its
 * size is the account's — a hundred-league power user is a thousand Sleeper
 * requests. `refreshInFlight` above dedupes *one manager* asked for twice; what
 * it cannot answer is a caller naming a hundred different uncached usernames,
 * which is a hundred unrelated fan-outs and a hundred advisory locks that never
 * contend.
 *
 * The global Sleeper limiter already bounds what reaches Sleeper. This bounds
 * what *queues* for it: without it those thousand-request syncs all get accepted
 * and sit in the limiter's queue behind each other, holding a streaming response
 * each, long past the platform deadline any of them will be answered within.
 *
 * `MANAGER_COLD_SYNC_LIMIT` overrides it. Small on purpose — a cold sync is a
 * rare event on a warm database, since the crawler is what fills it.
 */
const MAX_COLD_SYNCS = (() => {
  const parsed = Number(process.env.MANAGER_COLD_SYNC_LIMIT?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3;
})();

let coldSyncs = 0;

/**
 * Streams newline-delimited JSON for a manager's leagues using
 * stale-while-revalidate:
 *   - If we have cached leagues, they are sent immediately (`stale` flags
 *     whether a refresh is coming). When stale, a background refresh runs and a
 *     second `result` with fresh data is pushed over the same stream.
 *   - With no cache (first visit) it syncs in the foreground, emitting
 *     `progress` events so the client can show a bar for 100+ league accounts.
 *
 * The message shapes are declared in `@/shared/contract`'s
 * {@link LeaguesStreamMessage}, which the client decodes against — see
 * `features/manager/hooks/use-manager-leagues`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { user, season, searchParams } = resolved;

  // `?refresh=1` forces the full ~11-requests-per-league fan-out past the TTL, so
  // it is an operator knob, not a public one: anonymous callers get the ordinary
  // stale-while-revalidate behaviour and the parameter is ignored. The route
  // itself stays public — this is a read every manager page makes, and the whole
  // point is that it answers from cache.
  const force = searchParams.get("refresh") === "1" && isInternalRequest(request);

  // Warm the players cache in the background (no-op when fresh).
  void ensurePlayersFresh().catch((error) => {
    console.error("[players] warm-up failed:", error);
  });

  const userInfo = toUserInfo(user);
  const refreshKey = `${user.user_id}:${season}`;

  // Both reads happen before the stream opens, because the cold-sync
  // reservation below has to be taken with no await between the check and the
  // reservation — and the check needs to know whether there is anything to
  // serve. A failure here therefore can't be a message on the stream, so it
  // takes the app's own read-failure answer: a busy pool is a 503 the client
  // may retry, not a 500 telling it to stop.
  let cached: Awaited<ReturnType<typeof getManagerLeagues>>;
  let syncState: Awaited<ReturnType<typeof getManagerSyncState>>;
  try {
    [syncState, cached] = await Promise.all([
      getManagerSyncState(user.user_id, season),
      getManagerLeagues(user.user_id, season),
    ]);
  } catch (error) {
    console.error("[leagues] cache read failed:", error);
    return readFailureResponse(error, "Failed to load leagues");
  }

  // The same gate `syncManagerLeagues` applies inside the lock, asked here so a
  // refresh that would only be skipped never opens a stream to be skipped on.
  // `requestedAt: now` because nothing has been queued for yet — the race arms
  // of the gate are for the caller that has just waited on the lock.
  const now = Date.now();
  const gate = managerSyncGate(syncState, { now, requestedAt: now, force });
  /**
   * Whether there is an honest answer to send immediately.
   *
   * Leagues we hold, **or** a complete sync inside its TTL saying this manager
   * genuinely has none — the second half matters because without it a manager
   * with no leagues would be re-synced in the foreground on every request. It is
   * deliberately not "a `manager_syncs` row exists": with `synced_at` now
   * advancing only on a complete sync, a manager whose graph keeps half-failing
   * would otherwise read as cold forever and take the cold path — a full
   * foreground fan-out — while 97 of their 100 leagues sat in the database.
   */
  const hasCache = cached.length > 0 || gate.complete;
  /** Cached leagues that are not known-current, which is what `stale` promises. */
  const isStale = !gate.complete;
  // `gate.run` is what carries the retry throttle: after a partial or failed
  // sync `synced_at` no longer advances, so `isStale` alone would ask Sleeper for
  // the whole graph again on *every* request until it recovered. `attempt_at`
  // is what buys the quiet the old always-advancing `synced_at` used to buy by
  // lying. A caller with nothing to show is never throttled — there is no cache
  // to serve instead, and that path is bounded by `MAX_COLD_SYNCS` below and by
  // the per-manager advisory lock inside the sync.
  const wantRefresh = gate.run || !hasCache;
  // Skip a duplicate background refresh only when we can still serve cache.
  // Check and reserve back-to-back with no await between them — the reservation
  // used to happen inside the stream, after the cached-leagues read, and two
  // requests in that window both passed the check and both ran the full forced
  // sync. (Cold requests deliberately don't dedupe here: each caller needs a
  // progress stream, and the per-manager advisory lock inside
  // `syncManagerLeagues` keeps the losers from repeating the winner's fan-out.)
  const deduped = hasCache && refreshInFlight.has(refreshKey);
  // A cold caller takes a slot out of the process's cold-sync budget, and is
  // *refused* rather than queued when there is none: it has nothing cached to
  // fall back on, so queueing would hold a streaming response open through a
  // wait it cannot be answered within. Reserved here, back-to-back with the
  // check and with no await between them, for the same reason the dedupe
  // reservation is.
  const coldAdmitted = hasCache || coldSyncs < MAX_COLD_SYNCS;
  const willRefresh = wantRefresh && !deduped && coldAdmitted;
  if (willRefresh) refreshInFlight.add(refreshKey);
  const heldColdSlot = willRefresh && !hasCache;
  if (heldColdSlot) coldSyncs += 1;

  // Nothing cached and no slot to fill it with: the only honest answer is to say
  // so. An empty league list would read as "this manager has none", which is a
  // different and permanent-looking claim.
  if (!hasCache && !coldAdmitted) {
    console.warn(
      `[leagues] cold sync for ${user.user_id} shed; ${coldSyncs} already running.`,
    );
    const message: LeaguesStreamMessage = {
      type: "error",
      error: "Too many new managers are syncing right now. Try again shortly.",
    };
    return new Response(JSON.stringify(message) + "\n", {
      status: 503,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "10",
      },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (message: LeaguesStreamMessage) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(message) + "\n"));
        } catch {
          closed = true; // client disconnected
        }
      };

      try {
        // 1. Serve cached leagues immediately when we have them.
        if (hasCache) {
          send({
            type: "result",
            user: userInfo,
            season,
            leagues: cached,
            stale: isStale,
            refreshing: willRefresh,
          });
        }

        // 2. Sync — background refresh (cache already sent) or cold foreground.
        if (willRefresh) {
          const summary = await syncManagerLeagues(user.user_id, season, {
            force: true,
            onProgress: (progress) =>
              send({
                type: "progress",
                phase: hasCache ? "refresh" : "initial",
                ...progress,
              }),
          });
          const leagues = await getManagerLeagues(user.user_id, season);
          send({
            type: "result",
            user: userInfo,
            season,
            leagues,
            // **`complete` is the only thing that licenses `stale: false`.**
            // Three outcomes leave the list below short of final and they used
            // to be spelled two different ways: a sync that lost the lock (the
            // holder is mid-write, so on a first visit this is a fraction of the
            // leagues), a sync that ran and dropped leagues to a Sleeper
            // failure, and a skip that skipped because the last *attempt* is
            // still inside its throttle window. Reported `stale: false` any of
            // them is a partial list wearing the word "final": the client caches
            // it, closes its progress bar and counts a refresh it never saw. It
            // still ships, because a partial list is worth more than an error
            // and the client's own stale time brings it back.
            stale: !summary.complete,
            // False either way: no second `result` follows on this stream, and
            // that is exactly what this flag promises.
            refreshing: false,
            summary,
          });
        }
      } catch (error) {
        console.error("[leagues] sync failed:", error);
        send({ type: "error", error: "Failed to sync leagues" });
      } finally {
        // Released here rather than around the sync alone: the reservation is
        // taken before the stream starts, so a cache read that throws must
        // still let a later request refresh this manager.
        if (willRefresh) refreshInFlight.delete(refreshKey);
        if (heldColdSlot) coldSyncs -= 1;
        if (!closed) {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
