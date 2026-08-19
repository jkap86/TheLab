import type { LeagueTeam } from "@/shared/manager";

import { getLeagueWeekView } from "./league-week";
import type { LeagueWeekView } from "./league-week";
import { memoizeLeagueWeek } from "./read-cache";
import type { LeagueWeekInput } from "./read-cache";

/**
 * One league-week per process, and the reads still running.
 *
 * **The thin wiring half of `./read-cache`**, which holds the policy, the key,
 * the freshness bound and the memoiser and takes its loader as an argument so
 * all four can be tested with nothing behind them —
 * `projections/outlook-read.ts`'s shape, and `resolve.ts`/`user-resolution.ts`'s
 * before it.
 *
 * **This is the panel's most expensive read and its most time-sensitive one at
 * once**, which is why the two halves of the cache are set so differently. The
 * in-flight half is free of any freshness question at all: callers arriving
 * while a read is running asked for an answer that did not exist yet, so
 * sharing it costs nothing and saves a whole second copy of ~450ms of
 * projections, form averages and lineup solving — which React Query cannot do
 * for two tabs, two readers, or a revalidation landing beside a cold
 * navigation. The resolved half is bounded three ways over: by the key, which
 * carries every team's actual lineup; by the next kickoff, read off the answer's
 * own schedule; and by a minute, for the syncs underneath.
 *
 * **No invalidation hook, and that is a design rather than an omission.** The
 * one press a reader can make — the lineup checker's sync key — writes the
 * league graph, which forgets the league's core detail in the process that
 * served it; the panel's refetch then resolves the new rosters and asks this
 * cache a question keyed on them, which it has never been asked. A hook would
 * also have to be a listener rather than a call, since `shared/stats` reads
 * `shared/manager`'s tables and the invalidation would have to run the other
 * way — machinery for a guarantee the key already gives.
 */

/**
 * What this read needs: the key's own inputs, with the league teams spelled as
 * the league read hands them out.
 */
export type LeagueWeekReadInput = LeagueWeekInput & {
  teams: readonly LeagueTeam[];
};

const weekCache = memoizeLeagueWeek<LeagueWeekReadInput>((input) =>
  getLeagueWeekView({
    leagueId: input.leagueId,
    season: input.season,
    week: input.week,
    teams: input.teams,
    // The loader takes the mutable spellings the league read hands out; nothing
    // downstream writes to either, and the cache's own view of them is readonly
    // because a key must not be able to edit what it is keying.
    rosterPositions: input.rosterPositions ? [...input.rosterPositions] : null,
    scoringSettings: input.scoringSettings,
    bestBall: input.bestBall,
    medianMatch: input.medianMatch,
  }),
);

/**
 * One league's week, cached and coalesced.
 *
 * There is no null: `getLeagueWeekView` answers with a view for every league it
 * is asked about, so a caller that could not read one has a failure rather than
 * an answer — see the week route, which is where that distinction is spent.
 */
export function readLeagueWeekView(
  input: LeagueWeekReadInput,
): Promise<LeagueWeekView> {
  return weekCache.read(input);
}

/** For tests: drop everything. */
export function clearLeagueWeekCache(): void {
  weekCache.clear();
}
