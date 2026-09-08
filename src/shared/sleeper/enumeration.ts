import type { SleeperLeague } from "./types/sleeper.types";

/**
 * Whether a manager's league enumeration was an *answer*.
 *
 * **A confirmed `[]` and an unreadable body are two different facts and the
 * client could not tell them apart.** `sleeperGet` folds a 200-with-null into
 * whatever fallback its caller passed, which is right for a collection nobody
 * acts on and wrong here: the manager sync makes this enumeration authoritative
 * for which leagues are a manager's, so "Sleeper says none" empties their page.
 * A body nobody could parse must never be allowed to do that, and it arrives
 * spelled identically.
 *
 * Split into its own module — pure, one erased type import — so Node's own test
 * runner can resolve it; `./client` and `./leagues` reach the network and are
 * written with extensionless relative imports it cannot follow. It is the same
 * arrangement `sleeper/missing.ts` makes for the other decision in this folder
 * that is silent when wrong.
 */
export type UserLeaguesEnumeration =
  | { ok: true; leagues: SleeperLeague[] }
  | { ok: false; reason: "unreadable" };

/**
 * Classify an enumeration body.
 *
 * **Only a genuine JSON array is an answer.** Sleeper's documented convention is
 * that a null body means "no data", and this deliberately refuses to act on it:
 * null is equally what an unresolvable user, a truncated response and a proxy's
 * empty answer look like from here, and the evidence in this repo is that the
 * endpoint really does send `[]` for an empty enumeration — `seasonSyncTier`'s
 * own note records that an unknown league year comes back as an empty list. So
 * reading null as confirmed-empty would buy nothing and would risk emptying a
 * page on a hiccup.
 *
 * The cost of the conservative call is one extra attempt for a manager Sleeper
 * answers null for: their scope is left alone, their sync is not stamped
 * complete, and their stored list stays on screen marked stale.
 */
export function classifyUserLeagues(body: unknown): UserLeaguesEnumeration {
  if (Array.isArray(body)) return { ok: true, leagues: body as SleeperLeague[] };
  return { ok: false, reason: "unreadable" };
}
