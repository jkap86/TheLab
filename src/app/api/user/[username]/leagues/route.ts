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
  const willRefresh = wantRefresh && !(hasCache && refreshInFlight.has(refreshKey));
  if (willRefresh) refreshInFlight.add(refreshKey);

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
