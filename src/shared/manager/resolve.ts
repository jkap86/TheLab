import type { UserInfo } from "@/shared/contract";
import { getSleeperUser, sleeperAvatarUrl } from "@/shared/sleeper";
import type { SleeperUser } from "@/shared/sleeper";

import { memoizeManagerLookup, resolveManagerId } from "./user-resolution.ts";
import type { ResolvedManagerId } from "./user-resolution.ts";

/**
 * Resolving a searched username into the user the routes answer about.
 *
 * This lives here rather than in `@/shared/sleeper` because it is route policy,
 * not protocol: which HTTP status a blank or unknown username maps to is a fact
 * about this app's API, and the Sleeper client shouldn't know it. The *decision*
 * half is `./user-resolution`, which is pure and takes its lookup as an argument;
 * this is where that lookup is wired to Sleeper.
 */

/**
 * The one place a username is turned into a Sleeper user in this process.
 *
 * Memoised for a minute (see {@link memoizeManagerLookup}) as defence in depth
 * behind the id hint the dependent routes send: the hint removes the repeats a
 * *page* makes, and this removes the ones several readers, several tabs and a
 * cold navigation make between them.
 */
const lookupSleeperUser = memoizeManagerLookup(getSleeperUser);

/** For tests, and for anything that has just invalidated who a name resolves to. */
export const clearManagerLookupCache = (): void => lookupSleeperUser.clear();

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
  // No hint: this entry point is for the callers that need the *profile* — the
  // user route's avatar and canonical name, the leagues route's `UserInfo` — and
  // an id alone cannot supply one.
  const resolved = await resolveManagerId(username, null, lookupSleeperUser);
  if (!resolved.ok) return resolved;
  // With no hint the resolver always fetched, so `user` is present — checked
  // rather than asserted, because a null here would otherwise reach a caller
  // that has no way to notice it and every reason to dereference it.
  if (!resolved.user) return { ok: false, status: 404, error: "User not found" };
  return { ok: true, user: resolved.user as SleeperUser };
}

/**
 * Resolve a manager to an id, taking the caller's word for it when they have
 * one.
 *
 * This is what the Postgres-backed manager routes use: `hintedId` is the
 * canonical `user_id` the leagues response already carried, so a manager page's
 * four dependent reads cost no Sleeper request at all. Without one — a direct
 * navigation, a bookmark, a client that doesn't send it — it resolves the name
 * exactly as {@link resolveManagerUser} does, so nothing depends on the hint
 * being there.
 */
export async function resolveManagerUserId(
  username: string,
  hintedId: unknown,
): Promise<ResolvedManagerId> {
  return resolveManagerId(username, hintedId, lookupSleeperUser);
}

export { isSleeperUserId } from "./user-resolution.ts";
export type { ResolvedManagerId } from "./user-resolution.ts";
