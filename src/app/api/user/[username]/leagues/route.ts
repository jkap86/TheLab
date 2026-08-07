import {
  getManagerLeagues,
  getManagerSyncedAt,
  syncManagerLeagues,
  toUserInfo,
  SYNC_TTL_MS,
} from "@/shared/manager";
import type { LeaguesStreamMessage } from "@/shared/contract";
import { ensurePlayersFresh } from "@/shared/players";

import { isInternalRequest } from "../../../internal-auth";
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

  const syncedAt = await getManagerSyncedAt(user.user_id, season);
  const hasCache = syncedAt !== null;
  const isStale = !syncedAt || Date.now() - syncedAt.getTime() >= SYNC_TTL_MS;
  const wantRefresh = force || isStale;
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
          const leagues = await getManagerLeagues(user.user_id, season);
          send({
            type: "result",
            user: userInfo,
            season,
            leagues,
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
            // **A sync that lost the lock did not write these leagues, and the
            // holder has not finished writing them.** Every other outcome here
            // leaves a complete graph — a real sync, or a skip because the
            // winner finished while we queued — and only this one leaves
            // whatever has been committed so far, which on a manager's first
            // visit is a fraction of their leagues. Reported `stale: false` it
            // was a partial list wearing the word "final": the client cached it,
            // closed its progress bar and counted a refresh it never saw. It
            // still ships, because a partial list is worth more than an error
            // and the client's own stale time brings it back.
            stale: summary.locked,
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
