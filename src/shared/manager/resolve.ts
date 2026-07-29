import type { UserInfo } from "@/shared/contract";
import { getSleeperUser, sleeperAvatarUrl } from "@/shared/sleeper";
import type { SleeperUser } from "@/shared/sleeper";

/**
 * Resolving a searched username into the user the routes answer about.
 *
 * This lives here rather than in `@/shared/sleeper` because it is route policy,
 * not protocol: which HTTP status a blank or unknown username maps to is a fact
 * about this app's API, and the Sleeper client shouldn't know it.
 */

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
