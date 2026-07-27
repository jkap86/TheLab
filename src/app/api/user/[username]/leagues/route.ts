import { NextResponse } from "next/server";

import {
  getManagerLeagues,
  getManagerSyncedAt,
  syncManagerLeagues,
  SYNC_TTL_MS,
} from "@/shared/manager";
import type { ApiErrorPayload, LeaguesStreamMessage } from "@/shared/manager";
import { ensurePlayersFresh } from "@/shared/players";
import { DEFAULT_SEASON, resolveManagerUser, toUserInfo } from "@/shared/sleeper";

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
 * The message shapes are declared in `@/shared/manager`'s
 * {@link LeaguesStreamMessage}, which the client decodes against — see
 * `features/manager/hooks/use-manager-leagues`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  const resolved = await resolveManagerUser(username);
  if (!resolved.ok) {
    const error: ApiErrorPayload = { error: resolved.error };
    return NextResponse.json(error, { status: resolved.status });
  }
  const user = resolved.user;

  const searchParams = new URL(request.url).searchParams;
  const season = searchParams.get("season")?.trim() || DEFAULT_SEASON;
  const force = searchParams.get("refresh") === "1";

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
  const willRefresh = wantRefresh && !(hasCache && refreshInFlight.has(refreshKey));

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
          refreshInFlight.add(refreshKey);
          try {
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
              stale: false,
              refreshing: false,
              summary,
            });
          } finally {
            refreshInFlight.delete(refreshKey);
          }
        }
      } catch (error) {
        console.error("[leagues] sync failed:", error);
        send({ type: "error", error: "Failed to sync leagues" });
      } finally {
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
