import http from "@thelab/http";
import type { AxiosError } from "@thelab/http";

import type { SleeperUser } from "./types";

export const SLEEPER_API_BASE = "https://api.sleeper.app/v1";
export const SLEEPER_CDN_BASE = "https://sleepercdn.com";

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
    const { data } = await http.get<SleeperUser | null>(
      `${SLEEPER_API_BASE}/user/${encodeURIComponent(usernameOrId)}`,
    );
    return data ?? null;
  } catch (error) {
    if ((error as AxiosError).response?.status === 404) return null;
    throw error;
  }
}
