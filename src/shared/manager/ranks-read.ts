import type { LeagueRankSet, ManagerRanksPayload } from "@/shared/contract";
import { getWeeklyTeamPoints } from "@/shared/projections";
import type { WeeklyTeamPoints } from "@/shared/projections";
import { TtlPromiseCache, deepFreeze, errorMessage } from "@/shared/util";

import { getManagerLeagueRosters } from "./queries";
import { projectedRank, rankOf, standingScore } from "./rank";
import {
  MANAGER_RANKS_CACHE,
  managerRanksCacheKey,
  type ManagerRanksOptions,
} from "./read-cache";

/**
 * Where a manager's roster sits in each of their leagues — by record, by points
 * for, by projected starters and by projected bench.
 *
 * **It is here rather than in the route because of the cache below**, which has
 * to be module state that outlives a request, and because everything above the
 * `NextResponse` is domain logic the route had no business holding. The route is
 * the HTTP adaptation and nothing else now, which is the split
 * `resolveManagerUser`/`resolveManagerRequest` already draws.
 *
 * Nothing about the ranking changed in the move: the same three reads, the same
 * `rankOf` over the same scores, the same rule that a league contributing none
 * of the four is left out of the payload entirely.
 */

/** The empty triple `getWeeklyTeamPoints` itself returns with nothing to project. */
const NO_PROJECTIONS: WeeklyTeamPoints = {
  weeks: [],
  points: new Map(),
  bench: new Map(),
};

/**
 * One manager's ranks per process, and the computations still running.
 *
 * **This is the most expensive read in the app that is not a single statement.**
 * It is a lineup solve per team per remaining week in every projectable league
 * the manager plays in — a hundred-league account is thousands of solves off one
 * request — and, unlike the ADP board, all of that is *CPU on the web process*,
 * so two readers of the same manager are two spells of the event loop blocked
 * rather than two queries a database can interleave.
 *
 * The browser's five-minute stale time never reached any of that: it is per
 * device, so a second tab, a second reader, a reload and a process restart each
 * paid in full. Held here, one manager's ranks are computed once per process per
 * {@link MANAGER_RANKS_CACHE} window however many callers name them, and
 * concurrent cold callers share a single computation rather than racing.
 */
const ranksCache = new TtlPromiseCache<ManagerRanksPayload>(MANAGER_RANKS_CACHE);

/**
 * The ranks payload for one manager and season, cached and coalesced.
 *
 * `options.projections` decides whether the weekly solves run at all — see
 * {@link ManagerRanksOptions} — and is in the key, so the two answers cannot be
 * served for each other.
 *
 * `label` is the searched name, and it is used for a log line and nothing else:
 * two spellings of one account are one manager, so putting it in the key would
 * compute the same thousands of solves once per spelling. It can only ever
 * describe the caller that actually ran the computation, which is the only
 * caller a failure is reported to — failures are never cached.
 */
export function readManagerRanks(
  userId: string,
  season: string,
  options: ManagerRanksOptions,
  label: string = userId,
): Promise<ManagerRanksPayload> {
  return ranksCache.read(managerRanksCacheKey(userId, season, options), () =>
    computeManagerRanks(userId, season, options, label),
  );
}

async function computeManagerRanks(
  userId: string,
  season: string,
  options: ManagerRanksOptions,
  label: string,
): Promise<ManagerRanksPayload> {
  // Sequential rather than parallel: which rosters to project is the answer to
  // the first read.
  const leagues = await getManagerLeagueRosters(userId, season);

  // A projections read that fails costs the projected ranks and not the payload
  // — the same call the KTC and ADP-value routes make, degraded the same way and
  // for the same reason. Two of the four ranks here are read straight off the
  // rosters this read already has, so failing the whole request would throw away
  // answers that are already in hand. The fallback is the *empty* triple
  // `getWeeklyTeamPoints` itself returns when there is nothing to project, so the
  // degraded shape is one the payload already describes — which is also what a
  // caller asking for no projections gets, by the same construction.
  const { weeks, points, bench } = options.projections
    ? await getWeeklyTeamPoints({
        season,
        leagues: leagues.map((l) => ({
          league_id: l.league_id,
          rosterPositions: l.roster_positions,
          scoringSettings: l.scoring_settings,
          teams: l.teams,
        })),
      }).catch((error): WeeklyTeamPoints => {
        console.error(
          `[ranks] weekly points failed for ${label}:`,
          errorMessage(error),
        );
        return NO_PROJECTIONS;
      })
    : NO_PROJECTIONS;

  const ranks: ManagerRanksPayload["ranks"] = {};
  for (const league of leagues) {
    const own = league.teams.find((t) => t.owner_id === userId);
    if (!own) continue;

    // Standings and points for come straight from the roster settings this read
    // carries, so they answer even for a league nothing is projected in.
    const standing = rankOf(
      new Map(
        league.teams.map((t) => [
          t.roster_id,
          standingScore(t.record.wins, t.fpts),
        ]),
      ),
      own.roster_id,
    );
    const pointsRank = rankOf(
      new Map(league.teams.map((t) => [t.roster_id, t.fpts])),
      own.roster_id,
    );

    const totals = points.get(league.league_id);
    const proj = totals ? projectedRank(totals, own.roster_id) : null;
    // Ranked by the bench half of the same solve, so depth places a roster the
    // way its starters do — highest bench first, null where nothing is behind a
    // starter (rankOf's all-zero guard).
    const benchTotals = bench.get(league.league_id);
    const projBench = benchTotals
      ? projectedRank(benchTotals, own.roster_id)
      : null;

    if (!standing && !pointsRank && !proj && !projBench) continue;
    ranks[league.league_id] = {
      standing,
      points: pointsRank ? { ...pointsRank, pointsFor: own.fpts } : null,
      proj,
      proj_bench: projBench,
    } satisfies LeagueRankSet;
  }

  // Frozen because it is shared: every caller inside the TTL holds this object,
  // so a route that sorted or annotated it in place would be editing what every
  // later reader gets.
  return deepFreeze({ season, weeks, ranks });
}
