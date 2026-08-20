import type { LeagueRankSet, ManagerRanksPayload } from "@/shared/contract";
import { getWeeklyTeamPoints } from "@/shared/projections";
import type { WeeklyTeamPoints } from "@/shared/projections";
import { TtlPromiseCache, deepFreeze, errorMessage } from "@/shared/util";

import {
  readManagerProjectionInputs,
  readManagerSnapshot,
} from "./manager-snapshot";
import { projectedRank, rankOf, standingScore } from "./rank";
import { toLeagueTeamsInput } from "./snapshot-cache";
import type { ManagerRosterSnapshot } from "./snapshot-cache";
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
 * Forget one manager's ranks in a season, because a league they are rostered in
 * has just been rewritten.
 *
 * **This is what the TTL cannot get right, and the reason it may be as long as
 * it is.** The browser retires this entry the moment a manager's leagues sync
 * reports it changed something — `publishManagerLeagues` invalidates
 * `dependentManagerQueryKeys`, ranks among them — and the refetch that follows
 * is, without this, answered from a payload computed *before* the sync ran. That
 * is the client doing exactly the right thing and being handed the number it was
 * trying to replace: a standing that stays wrong for the rest of the window, on
 * a page the reader has just watched refresh.
 *
 * Called from `persistLeagueGraph`, beside {@link invalidateLeagueDetail} and
 * for the same reasons: at the *write* rather than at a route, so all three
 * paths that rewrite a graph are covered (a manager's own sync, the on-demand
 * league refresh, and the crawler when it runs in this process), and after the
 * commit, so a read starting mid-write cannot cache the rows being replaced.
 *
 * Both option variants go, because `?projections=0` is a different key over the
 * same rosters — the cheap answer is as wrong about a standing as the full one.
 *
 * It reaches this process only, which is the bound every cache here has. What
 * that leaves to the clock is the crawler's writes from the worker dyno; what it
 * makes exact is every path a reader can press.
 */
export function invalidateManagerRanks(
  userIds: readonly string[],
  season: string,
): void {
  for (const userId of userIds) {
    for (const projections of [true, false]) {
      ranksCache.forget(managerRanksCacheKey(userId, season, { projections }));
    }
  }
}

/** For tests: drop everything. */
export function clearManagerRanksCache(): void {
  ranksCache.clear();
}

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
  // the first read. Through the account's snapshot rather than straight at the
  // query, so the two value lenses loading beside this one share the read
  // instead of each making it — see `./manager-snapshot`.
  const { leagues } = await readManagerSnapshot(userId, season);

  // A projections read that fails costs the projected ranks and not the payload
  // — the same call the KTC and ADP-value routes make, degraded the same way and
  // for the same reason. Two of the four ranks here are read straight off the
  // rosters this read already has, so failing the whole request would throw away
  // answers that are already in hand. The fallback is the *empty* triple
  // `getWeeklyTeamPoints` itself returns when there is nothing to project, so the
  // degraded shape is one the payload already describes — which is also what a
  // caller asking for no projections gets, by the same construction.
  const { weeks, points, bench } = options.projections
    ? await weeklyPoints(userId, season, leagues).catch(
        (error): WeeklyTeamPoints => {
          console.error(
            `[ranks] weekly points failed for ${label}:`,
            errorMessage(error),
          );
          return NO_PROJECTIONS;
        },
      )
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

/**
 * The weekly solves, over the account's shared projection reads.
 *
 * **The reads are shared and the solve is not**, which is the whole of what this
 * function is for. The stat lines and the positions are identical to the ones
 * the KTC and ADP starter values are computed from — the same players over the
 * same remaining weeks — so reading them three times per screen load was
 * arithmetic rather than judgement. What each week's own best lineup scores is a
 * different question from what one aggregate lineup does, and is still solved
 * here, per team per week, exactly as before.
 *
 * Its failures are the projections read's and the solve's alike, which is why it
 * is a function rather than two awaits: both land in the single `catch` above,
 * so the degraded answer is the one the payload already describes.
 */
async function weeklyPoints(
  userId: string,
  season: string,
  leagues: ManagerRosterSnapshot["leagues"],
): Promise<WeeklyTeamPoints> {
  const inputs = await readManagerProjectionInputs(userId, season);
  return getWeeklyTeamPoints({
    season,
    // Every league on the snapshot, not just the owned ones: a league the
    // manager has left still has a standing to be ranked against. The mapping is
    // the shared one, so this and the aggregate lineups cannot disagree about
    // what a league is to the solver.
    leagues: leagues.map(toLeagueTeamsInput),
    inputs,
  });
}
