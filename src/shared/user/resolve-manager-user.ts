import { awaitShared, getSleeperUser, type SleeperUser } from "@/shared/sleeper";

import { resolveManagerId } from "./resolve-manager-id";
import type { ManagerLookup } from "./resolve-manager-id";
import { memoizeManagerLookup } from "./memoize-manager-lookup";

export type ResolvedManager =
  | { ok: true; user: SleeperUser }
  | { ok: false; status: 400 | 404 | 502; error: string };

const memoizedLookup = memoizeManagerLookup(getSleeperUser);

/**
 * The memo, with each caller waiting only as long as its own request has left.
 *
 * **The waiter half of `sleeper/shared-wait`'s split; the producer half is
 * deliberately not taken here.** Every other in-process Sleeper cache
 * populates itself inside `withBackgroundSleeper`, because a projections board
 * or an NFL state is read by both classes and outlives whoever asked. This one
 * is not: `resolveManagerUser` is reached from route handlers and nothing else,
 * so there is no background caller to protect from a reader's ladder — and the
 * fan-out is one distinct fetch per distinct username anyone can type, which
 * under the background ladder would be a permit held for two minutes rather
 * than twelve seconds per name. It is this request's own answer, memoized for a
 * minute so the tools on one page do not each ask again.
 *
 * What the wrap still buys is the case that *does* arise: a second request for
 * the same manager, arriving with less of its own budget left than the first
 * one has, joins the fetch and gives up on its own clock.
 */
const lookupSleeperUser: ManagerLookup = (usernameOrId) =>
  awaitShared(memoizedLookup(usernameOrId), {
    label: `the Sleeper user "${usernameOrId}"`,
  });

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
