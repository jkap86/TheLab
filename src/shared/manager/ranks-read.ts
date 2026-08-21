import type { LeagueRankSet, ManagerRanksPayload } from "@/shared/contract";
import { getWeeklyTeamPoints } from "@/shared/projections";
import type { WeeklyTeamPoints } from "@/shared/projections";
import { TtlPromiseCache, deepFreeze, readOptional } from "@/shared/util";

import { getManagerLeagueRosters } from "./queries";
import { projectedRank, rankOf, standingScore } from "./rank";
import {
  MANAGER_RANKS_CACHE,
  managerRanksCacheKey,
  rankEntryTtlMs,
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

/**
 * The empty triple `getWeeklyTeamPoints` itself returns with nothing to project.
 *
 * It stands in for two different things and the payload now says which: a caller
 * who asked for no projections, and a projections read that fell over. It is
 * deliberately *not* what a successful-but-empty read produces — that comes back
 * from `getWeeklyTeamPoints` and is already this shape, which is exactly why the
 * substitution was invisible.
 */
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
 * caller a failure is reported to — a thrown failure is never cached, and
 * neither is a payload whose projections half failed (see {@link rankEntryTtlMs}).
 */
export function readManagerRanks(
  userId: string,
  season: string,
  options: ManagerRanksOptions,
  label: string = userId,
): Promise<ManagerRanksPayload> {
  return ranksCache.read(
    managerRanksCacheKey(userId, season, options),
    () => computeManagerRanks(userId, season, options, label),
    // **A degraded answer is served and never stored.** The lifetime is read off
    // the answer for the reason the league week's is (`TtlPromiseCache.read`):
    // what makes this payload unfit to keep is a fact about the payload, not
    // about its key, and computing it anywhere else is two places that can
    // disagree. A non-positive lifetime stores nothing at all
    // (`BoundedCache.set`), so a projections failure degrades to *coalescing* —
    // the callers already waiting share this computation, and the next request
    // recomputes against a database that may well have recovered.
    //
    // This is the whole reason `projections` is on the payload. Without it the
    // fabricated empty triple was indistinguishable from a real one, so the
    // cache had nothing to decide on and held a second of database trouble for
    // fifteen minutes as "this manager has no projections".
    { ttlMsFor: rankEntryTtlMs },
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
  // answers that are already in hand.
  //
  // What changed is that the degradation is now *reported*. The fallback is the
  // empty triple `getWeeklyTeamPoints` itself returns with nothing to project —
  // which is the point: the two were indistinguishable, so a failure was cached
  // as a fact. `readOptional` keeps the partial answer and hands back which of
  // the two happened, and {@link rankEntryTtlMs} is what acts on it.
  const projected = options.projections
    ? await readOptional(`[ranks] weekly points for ${label}`, () =>
        getWeeklyTeamPoints({
          season,
          leagues: leagues.map((l) => ({
            league_id: l.league_id,
            rosterPositions: l.roster_positions,
            scoringSettings: l.scoring_settings,
            teams: l.teams,
          })),
        }),
      )
    : null;

  const { weeks, points, bench }: WeeklyTeamPoints =
    projected?.value ?? NO_PROJECTIONS;
  const projections: ManagerRanksPayload["projections"] =
    projected === null ? "skipped" : projected.status;

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
  return deepFreeze({ season, weeks, projections, ranks });
}
