import http from "@thelab/http";
import type { AxiosError } from "@thelab/http";

import { createLimiter, sleeperConcurrency } from "./limiter";
import type { Limiter } from "./limiter";
import type { SleeperUser } from "./types";

export const SLEEPER_API_BASE = "https://api.sleeper.app/v1";
export const SLEEPER_CDN_BASE = "https://sleepercdn.com";

/**
 * Host serving the undocumented, unversioned endpoints (projections, stats).
 *
 * Kept separate from `SLEEPER_API_BASE` because the v1 host answers those paths
 * too — `api.sleeper.app/v1/projections/nfl/2025/1` returns HTTP 200 with an
 * object of empty objects, which parses fine and means nothing. Anything reading
 * projections must build its URL from this base.
 */
export const SLEEPER_DATA_BASE = "https://api.sleeper.com";

/** Build a Sleeper API URL, encoding every path segment. */
export function sleeperUrl(...segments: (string | number)[]): string {
  return `${SLEEPER_API_BASE}/${joinSegments(segments)}`;
}

/** Build a URL on the undocumented data host — see {@link SLEEPER_DATA_BASE}. */
export function sleeperDataUrl(...segments: (string | number)[]): string {
  return `${SLEEPER_DATA_BASE}/${joinSegments(segments)}`;
}

const joinSegments = (segments: (string | number)[]): string =>
  segments.map((s) => encodeURIComponent(String(s))).join("/");

/**
 * The one limiter every Sleeper request in this process passes through.
 *
 * Cached on `globalThis` for the reason the pg pool is: a route bundle carrying
 * its own copy of this module would get its own counter, and nothing in the
 * process could tell — the symptom being a "global" limit that is really one per
 * bundle. Dev's module reloading is the other half of the same argument.
 */
const LIMITER_KEY = Symbol.for("thelab.sleeper.limiter");
const globalScope = globalThis as typeof globalThis & {
  [LIMITER_KEY]?: Limiter;
};
export const sleeperLimiter: Limiter = (globalScope[LIMITER_KEY] ??=
  createLimiter(sleeperConcurrency()));

/** In flight, queued and the peak — for a log line or a health check. */
export const sleeperLimiterStats = () => sleeperLimiter.stats();

/**
 * GET a Sleeper endpoint, returning `fallback` when Sleeper responds with a null
 * body — its convention for "no data" (e.g. a user with no leagues).
 *
 * **Every path to Sleeper goes through here, which is why the concurrency bound
 * does too.** The crawler, the manager syncs, the on-demand league hydration and
 * the players/projections/state reads all end up in this function, and each of
 * them used to carry only its own local cap — so two manager syncs plus a crawl
 * tick was three unrelated fan-outs adding up to a number nobody had chosen. See
 * {@link sleeperLimiter}.
 *
 * The slot is held for the request *including* axios' retries, deliberately: a
 * retry is another request on Sleeper's doorstep, and a limiter that released
 * between attempts would admit a new caller for every one of them.
 *
 * **No transaction is ever open across this wait**, which is the property that
 * matters: `fetchLeagueGraph` reads Sleeper whole and `persistLeagueGraph` opens
 * its transaction afterwards, so a queue here can never be a queue on a
 * transaction. The two long-lived *session* advisory locks — a manager's sync
 * and the crawl tick — do hold a pooled connection across their Sleeper work,
 * as they always have; what bounds that is that the limiter's default width is
 * above the largest single fan-out any one of them takes, and that the number of
 * concurrent cold syncs is capped where they are started (see the leagues
 * route). Nothing waits on this limiter while holding something this limiter
 * waits on, so there is no cycle to deadlock on.
 */
export async function sleeperGet<T>(url: string, fallback: T): Promise<T> {
  const { data } = await sleeperLimiter.run(() => http.get<T | null>(url));
  return data ?? fallback;
}

/** Build a full avatar URL from a Sleeper avatar id, or null when there is none. */
export function sleeperAvatarUrl(
  avatar: string | null,
  size: "full" | "thumb" = "full",
): string | null {
  if (!avatar) return null;
  const path = size === "thumb" ? "avatars/thumbs" : "avatars";
  return `${SLEEPER_CDN_BASE}/${path}/${avatar}`;
}

/**
 * Fetch a Sleeper user by username (or user_id).
 *
 * Sleeper returns HTTP 200 with a `null` body for unknown users, so this
 * resolves to `null` rather than throwing when no such user exists.
 */
export async function getSleeperUser(
  usernameOrId: string,
): Promise<SleeperUser | null> {
  try {
    return await sleeperGet<SleeperUser | null>(
      sleeperUrl("user", usernameOrId),
      null,
    );
  } catch (error) {
    if ((error as AxiosError).response?.status === 404) return null;
    throw error;
  }
}
