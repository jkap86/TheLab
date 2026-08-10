import {
  getManagerLeagues,
  getManagerSyncState,
  managerSyncAdmission,
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

/**
 * Streams newline-delimited JSON for a manager's leagues using
 * stale-while-revalidate:
 *   - If we have cached leagues, they are sent immediately (`stale` flags
 *     whether a refresh is coming). When stale, a background refresh runs and a
 *     second `result` with fresh data is pushed over the same stream.
 *   - With no cache (first visit) it syncs in the foreground, emitting
 *     `progress` events so the client can show a bar for 100+ league accounts.
 *
 * Either shape of sync is admitted by `managerSyncAdmission` first, which is
 * where the process-wide bound and the per-manager dedupe both live. A caller
 * refused a permit degrades along the same axis it already sits on: one holding
 * cache sends it, marked stale, and skips the refresh; one holding nothing
 * answers 503, since an empty league list would read as "this manager has none".
 *
 * A client that disconnects mid-stream stops being written to and nothing else:
 * neither shape of sync is cancelled, and the permit each holds is released in a
 * `finally` whatever happens. Both halves of that are argued at {@link closed}.
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

  // Both reads happen before the stream opens, because the sync reservation
  // below has to be taken with no await between the check and the reservation —
  // and the check needs to know whether there is anything to serve. A failure
  // here therefore can't be a message on the stream, so it takes the app's own
  // read-failure answer: a busy pool is a 503 the client may retry, not a 500
  // telling it to stop.
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
  // to serve instead, and that path is bounded by the sync admission below and
  // by the per-manager advisory lock inside the sync.
  const wantRefresh = gate.run || !hasCache;
  // **Every sync this route runs is reserved, cold or not.** The reservation is
  // two bounds at once — the process's whole manager-sync budget and the
  // per-manager dedupe — and it is one call because the two have to be taken
  // together: see `managerSyncAdmission`, which also explains why the advisory
  // lock inside the sync is neither of them.
  //
  // It used to be a `refreshInFlight` set beside a counter that only cold
  // callers consulted, which left the expensive half unbounded: a *stale*
  // refresh is the same ~11-requests-per-league fan-out holding the same
  // advisory-lock connection, and any number of stale managers could run at
  // once — enough of them to take a ten-connection pool and then stall the
  // persistence they were queued to do.
  //
  // Reserved here, back-to-back with the gate and with no await between them.
  // The reservation used to happen inside the stream, after the cached-leagues
  // read, and two requests in that window both passed the check and both ran the
  // full forced sync.
  //
  // `dedupe: hasCache` is the one asymmetry, and it is the old behaviour intact:
  // a cold caller is never refused as a duplicate, because it has nothing to
  // serve instead and needs its own progress stream, and the advisory lock is
  // what keeps those from repeating each other's fan-out.
  const reservation = wantRefresh
    ? managerSyncAdmission.reserve(refreshKey, { dedupe: hasCache })
    : null;
  const willRefresh = reservation?.ok === true;

  // Nothing cached and no permit to fill it with: the only honest answer is to
  // say so. An empty league list would read as "this manager has none", which is
  // a different and permanent-looking claim. A caller that *can* serve cache
  // needs no such branch — it sends what is stored, marked stale, and the next
  // request is the retry.
  //
  // Written against `willRefresh` rather than against the refusal's reason: a
  // cold caller can only ever be refused for want of a permit (it is never
  // deduped), and if that ever stops being true an empty stream is still the one
  // answer this branch must not fall through to.
  if (!hasCache && !willRefresh) {
    console.warn(
      `[leagues] cold sync for ${user.user_id} shed; ` +
        `${managerSyncAdmission.stats().active} manager syncs already running.`,
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
  /**
   * Whether anybody is still reading this stream.
   *
   * Hoisted out of `start` so the underlying source's own `cancel` can set it:
   * that is the spec's notification that the consumer has gone away, and it
   * arrives when the browser disconnects rather than at whichever later
   * `enqueue` happens to throw. The `catch` in `send` stays as the backstop for
   * a disconnect nothing announced.
   *
   * **What it does not do is stop the sync, and that is deliberate rather than
   * missing.** Nothing in the sync stack takes an `AbortSignal` — `sleeperGet`
   * has no parameter for one, so neither do `fetchLeagueGraph`,
   * `syncLeagueGraphs`, `persistLeagueGraph`'s per-league transactions, or the
   * session advisory lock held across all of it — so honouring `request.signal`
   * here would mean threading a signal through every Sleeper call site and then
   * answering a question none of this code has an answer for: what a half-run
   * sync stamps. `attempt_at` and `synced_at` mean "we tried" and "this graph is
   * current" (see `sync-freshness`), and a run cancelled between two leagues is
   * neither cleanly, so a partial implementation would put a lie into the column
   * the whole throttle is read off.
   *
   * It is also not obviously the behaviour you want. A cold sync is the one
   * thing that fills this manager's graph, and it is filling *shared* Postgres
   * state, not this request's answer — the same reason a background refresh is
   * deliberately allowed to outlive the browser that started it. Cancelling on
   * disconnect would throw away the Sleeper budget already spent and leave the
   * next visitor to start over. What it costs is one admission permit for the
   * rest of the run: bounded by `managerSyncAdmission` (a share of the pool),
   * never leaked — the `finally` below releases on every path out, and
   * `release` is idempotent — and paid for by the work being finished rather
   * than repeated.
   */
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
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
        // still let a later request refresh this manager. It is idempotent, so
        // this `finally` is safe on every path out of the stream — and a permit
        // leaked on a thrown sync is a cap that tightens by one per Sleeper
        // failure until it admits nobody.
        if (reservation?.ok) reservation.release();
        if (!closed) {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
    cancel() {
      // The consumer stopped reading — a closed tab, a navigation, or React
      // Query cancelling the fetch. Everything after this point is for a reader
      // who is no longer there, so `send` becomes a no-op and `start`'s
      // `finally` must not try to close a stream that is already gone. The sync
      // itself runs on; see {@link closed} for why.
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
