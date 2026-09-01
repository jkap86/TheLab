import { getSleeperUser, type SleeperUser } from "@/shared/sleeper";

import { resolveManagerId } from "./resolve-manager-id";
import { memoizeManagerLookup } from "./memoizeManagerLookup";

export type ResolvedManager =
  | { ok: true; user: SleeperUser }
  | { ok: false; status: 400 | 404 | 502; error: string };

const lookupSleeperUser = memoizeManagerLookup(getSleeperUser);

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
  if (!resolved.user) {
    return { ok: false, status: 404, error: "User not found" };
  }
  return { ok: true, user: resolved.user as SleeperUser };
}
