import { http } from "@/shared/http";

import { createLimiter, sleeperConcurrency } from "./limiter";
import type { Limiter } from "./limiter";
import { isMissingResource } from "./missing";
import type { SleeperUser } from "./types/sleeper.types";

export const SLEEPER_API_BASE = "https://api.sleeper.app/v1";
export const SLEEPER_CDN_BASE = "https://sleepercdn.com";

const joinSegments = (segments: (string | number)[]): string =>
  segments.map((s) => encodeURIComponent(String(s))).join("/");

/** Build a Sleeper API URL, encoding every path segment. */
export function sleeperUrl(...segments: (string | number)[]): string {
  return `${SLEEPER_API_BASE}/${joinSegments(segments)}`;
}

/**
 * The one limiter every Sleeper request in this process passes through.
 *
 * Cached on `globalThis` because a route bundle carrying its own copy of this
 * module would get its own counter, and nothing in the process could tell — the
 * symptom being a "global" limit that is really one per bundle. Dev's module
 * reloading is the other half of the same argument.
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
 * does too.** See {@link sleeperLimiter}.
 *
 * The slot is held for the request *including* its retries, deliberately: a
 * retry is another request on Sleeper's doorstep, and a limiter that released
 * between attempts would admit a new caller for every one of them.
 */
export async function sleeperGet<T>(url: string, fallback: T): Promise<T> {
  const { data } = await sleeperLimiter.run(() => http.get<T | null>(url));
  return data ?? fallback;
}

/**
 * {@link sleeperGet} for an endpoint where a *missing* resource is an answer,
 * folding **both** of Sleeper's spellings of one into `fallback`.
 *
 * Sleeper's documented convention is 200 with a null body, which `sleeperGet`
 * already folds. A number of endpoints answer 404 for the same thing instead,
 * and which one you get is a fact about the endpoint rather than about the
 * request — so a caller that folds one and throws on the other is deciding by
 * spelling.
 *
 * **Two named functions rather than one taking a flag**, because these mean
 * different things and one function quietly serving both meanings is what the
 * naming exists to prevent. Reach for this where an absent resource is an answer
 * the caller can act on, and for `sleeperGet` where a 404 is a genuine fault.
 *
 * Only 404, and only with a response behind it — see {@link isMissingResource}
 * for why a 429 and a timeout must both keep throwing.
 */
export async function sleeperGetOptional<T>(
  url: string,
  fallback: T,
): Promise<T> {
  try {
    return await sleeperGet(url, fallback);
  } catch (error) {
    if (isMissingResource(error)) return fallback;
    throw error;
  }
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
 * Sleeper answers an unknown user with 200 and a `null` body, and this endpoint
 * 404s for some ids too, so both resolve to `null` rather than throwing — see
 * {@link sleeperGetOptional}, which is where that fold lives.
 */
export function getSleeperUser(
  usernameOrId: string,
): Promise<SleeperUser | null> {
  return sleeperGetOptional<SleeperUser | null>(
    sleeperUrl("user", usernameOrId),
    null,
  );
}
