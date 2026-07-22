import http from "@thelab/http";
import type { AxiosError } from "@thelab/http";

import type { SleeperUser } from "./types";

export const SLEEPER_API_BASE = "https://api.sleeper.app/v1";
export const SLEEPER_CDN_BASE = "https://sleepercdn.com";

/** Build a Sleeper API URL, encoding every path segment. */
export function sleeperUrl(...segments: (string | number)[]): string {
  const path = segments.map((s) => encodeURIComponent(String(s))).join("/");
  return `${SLEEPER_API_BASE}/${path}`;
}

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

/** The public user shape returned by the app's user/leagues APIs. */
export type UserInfo = {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  avatar_url: string | null;
};

/** Project a Sleeper user into the app's API user shape (adds `avatar_url`). */
export function toUserInfo(user: SleeperUser): UserInfo {
  return {
    user_id: user.user_id,
    username: user.username,
    display_name: user.display_name,
    avatar: user.avatar,
    avatar_url: sleeperAvatarUrl(user.avatar),
  };
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

/** A resolved manager, or a normalized failure with the HTTP status to return. */
export type ResolvedManager =
  | { ok: true; user: SleeperUser }
  | { ok: false; status: 400 | 404 | 502; error: string };

/**
 * Resolve a manager by username with the failure handling shared by the user and
 * leagues API routes: blank → 400, Sleeper unreachable → 502, unknown user → 404.
 */
export async function resolveManagerUser(
  username: string,
): Promise<ResolvedManager> {
  if (!username?.trim()) {
    return { ok: false, status: 400, error: "Username is required" };
  }

  let user: SleeperUser | null;
  try {
    user = await getSleeperUser(username);
  } catch {
    return { ok: false, status: 502, error: "Failed to reach Sleeper" };
  }

  if (!user) {
    return { ok: false, status: 404, error: "User not found" };
  }
  return { ok: true, user };
}
