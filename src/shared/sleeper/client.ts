import http from "@thelab/http";
import type { AxiosError } from "@thelab/http";

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
 * GET a Sleeper endpoint, returning `fallback` when Sleeper responds with a null
 * body — its convention for "no data" (e.g. a user with no leagues).
 */
export async function sleeperGet<T>(url: string, fallback: T): Promise<T> {
  const { data } = await http.get<T | null>(url);
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
