import { getSleeperUser, type SleeperUser } from "@/shared/sleeper";

import { resolveManagerId } from "./resolve-manager-id";
import { memoizeManagerLookup } from "./memoize-manager-lookup";

export type ResolvedManager =
  | { ok: true; user: SleeperUser }
  | { ok: false; status: 400 | 404 | 502; error: string };

const lookupSleeperUser = memoizeManagerLookup(getSleeperUser);

/**
 * The entry point for callers that need the *profile* — the user route's avatar
 * and canonical name, the leagues route's `UserInfo`. Memoized, so two tools
 * asking about the same manager in the same minute cost one request.
 */
export async function resolveManagerUser(
  username: string,
): Promise<ResolvedManager> {
  const resolved = await resolveManagerId(username, lookupSleeperUser);
  if (!resolved.ok) return resolved;
  return { ok: true, user: resolved.user };
}
