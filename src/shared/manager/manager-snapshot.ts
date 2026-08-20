import {
  getOptimalLineups,
  readHorizonProjectionInputs,
} from "@/shared/projections";
import type { HorizonProjectionInputs, OptimalLineups } from "@/shared/projections";

import { getManagerLeagueRosters } from "./queries";
import { memoizeManagerSnapshot, toLeagueTeamsInput } from "./snapshot-cache";
import type { ManagerRosterSnapshot } from "./snapshot-cache";

/**
 * The expensive things a Manager screen's three value lenses share, read once.
 *
 * **The thin wiring half of `./snapshot-cache`**, which holds the policy, the
 * keys, the owned-league rule and the memoiser and takes its loaders as
 * arguments so all of that can be tested with nothing behind it. This is where
 * those arguments are the reads that touch Postgres — the split
 * `outlook-read.ts`/`read-cache.ts` already draws one concern along, and
 * `resolve.ts`/`user-resolution.ts` draws in this module's own folder.
 *
 * **What it is for.** A default Manager load fires three batch requests at once
 * — `…/ranks`, `…/ktc` and `…/adp-value` — and every one of them independently
 * read the account's whole roster graph, then independently read every stat line
 * of every remaining week for every player on it, and two of them then solved
 * the identical rest-of-season lineup for every team in every league. Nothing
 * about that was wrong from inside any one route; it was three copies of one
 * read and two copies of one solve, on the web process's own event loop and its
 * own pool.
 *
 * Held here, the three requests are one rosters read, one projections read and
 * one lineup solve. The lenses keep their own routes, their own payloads and
 * their own failure behaviour: what is shared is the *inputs*, never the
 * answers.
 *
 * Per process, like every cache in this app — Postgres stays the source of
 * truth, and at these lifetimes a second instance costs one extra read of an
 * answer that was seconds from expiring anyway. Nothing here wants Redis: it
 * would put a network hop and a serialisation of every roster on the hot path
 * this exists to shorten.
 */
const snapshots = memoizeManagerSnapshot({
  rosters: getManagerLeagueRosters,
  projectionInputs: (snapshot) =>
    // **Every league, not just the owned ones.** The ranks project leagues the
    // manager no longer holds a roster in, so the superset is what makes one
    // read answer for all three lenses; an extra league's rows are extra keys in
    // a map the value lenses never open.
    readHorizonProjectionInputs({
      season: snapshot.season,
      leagues: snapshot.leagues.map(toLeagueTeamsInput),
    }),
  optimalLineups: (snapshot, inputs) =>
    // The owned leagues alone, which is exactly what the KTC and ADP routes each
    // passed before: a lens that prices a roster has nothing to say about a
    // league holding none of the manager's.
    getOptimalLineups({
      season: snapshot.season,
      leagues: snapshot.owned.map(toLeagueTeamsInput),
      inputs,
    }),
});

/**
 * One manager's leagues and rosters for a season, cached and coalesced.
 *
 * The read all three lenses open with, and the thing every other entry here is
 * derived from. `owned` is the subset holding a roster of this manager's — the
 * `withOwn` filter the two value routes each applied for themselves — so a
 * starter value and the lineup it is summed over cannot be computed against
 * different populations.
 *
 * **Not frozen**, `readLeagueDetail`'s reasoning: it is handed straight to the
 * lineup solvers, and deep-freezing a thousand rosters on every miss is real
 * work on the path this exists to shorten. The contract instead: every consumer
 * reads and none writes.
 */
export function readManagerSnapshot(
  userId: string,
  season: string,
): Promise<ManagerRosterSnapshot> {
  return snapshots.rosters(userId, season);
}

/**
 * The projections and player positions behind every Manager projection, read
 * once for the account.
 *
 * Handed to `getWeeklyTeamPoints` and `getOptimalLineups` explicitly (their
 * optional `inputs`), which is the rule `readWeekProjectionInputs` set for the
 * League Week panel: a snapshot passed down is a fact about one request, where
 * one reached for from inside a callee is a cache with no key that could say
 * whose rosters it held. The key here *can* say — it is the manager and the
 * season — which is exactly why the holding is done at this level and not
 * inside the solvers.
 *
 * A read that fails is not stored, so the next request retries; and it fails
 * only the two things computed from it. The rosters above still answer, which is
 * what keeps a KTC or ADP total on screen with no projection behind it.
 */
export function readManagerProjectionInputs(
  userId: string,
  season: string,
): Promise<HorizonProjectionInputs> {
  return snapshots.projectionInputs(userId, season);
}

/**
 * The rest-of-season optimal lineup for every team in every league the manager
 * holds a roster in — solved once for the account.
 *
 * **The one entry point the KTC and ADP starter values now share.** They were
 * two identical calls to {@link getOptimalLineups} over two identical league
 * lists, and the identity was invisible from either route: same rosters, same
 * slots, same scoring, same horizon. A starter value is a sum over whoever
 * starts, and neither lens has any say in who that is.
 *
 * It is the aggregate lineup and not the weekly one, which is what the two
 * routes have always used and what the expanded panel lists as Starters — so a
 * chip, a column and the card they open still cannot disagree. The projected
 * ranks deliberately do **not** come through here: their number is a solve per
 * team per week, and handing them this lineup to widen the reuse would change
 * what they report.
 *
 * The same not-frozen contract as the snapshot above, and for the harder reason:
 * the answer carries `Map`s, where a freeze is a guarantee that cannot be kept.
 * Both callers only ever `get` from it.
 */
export function readManagerOptimalLineups(
  userId: string,
  season: string,
): Promise<OptimalLineups> {
  return snapshots.optimalLineups(userId, season);
}

/**
 * Forget one manager's snapshot in a season, because a league they are rostered
 * in has just been rewritten.
 *
 * Called from `persistLeagueGraph` beside {@link invalidateManagerRanks} and
 * {@link invalidateLeagueDetail}, for the reasons those two are: at the *write*
 * rather than at a route, so all three paths that rewrite a graph are covered,
 * and *after* the commit, so a read starting mid-write cannot store the rows the
 * write is replacing.
 *
 * The clock alone would already be honest here — these entries live seconds, not
 * minutes — but the press this covers is the one that would look broken without
 * it: a reader who syncs their leagues and watches the page refresh must not be
 * handed values priced off the rosters the sync just replaced.
 */
export function invalidateManagerSnapshot(
  userIds: readonly string[],
  season: string,
): void {
  for (const userId of userIds) snapshots.forget(userId, season);
}

/** For tests: drop everything. */
export function clearManagerSnapshotCache(): void {
  snapshots.clear();
}
