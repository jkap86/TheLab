/**
 * What the three Manager value lenses share, what it is keyed by, and how long
 * a shared answer is held.
 *
 * **Policy, keys, the one derivation rule and the memoiser — but not the
 * loaders**, which is `projections/read-cache`'s split and
 * `manager/read-cache`'s rule about what a pure module is for: everything here
 * arrives as an erased `import type` or a relative `.ts` value import, so the
 * whole of it can be driven by Node's test runner with nothing behind it.
 * `./manager-snapshot.ts` is where the loaders are wired to the reads that
 * actually touch Postgres. A cache key is exactly the kind of thing that is
 * wrong *silently* — too wide and one manager's rosters answer for another's,
 * too narrow and the layer never hits — so it is the half that has to be
 * testable, and a *call count* is the only assertion that can say the coalescing
 * works at all.
 *
 * ## What the duplication was
 *
 * A default Manager screen aims three of its columns at three separate batch
 * routes — the projected ranks, the KTC starter values and the ADP starter
 * values — and every one of them opened the same way:
 *
 * - `getManagerLeagueRosters(userId, season)`, two statements over `leagues` and
 *   `rosters` for the whole account, **three times**;
 * - every stat line of every remaining week for every player on every roster,
 *   plus the eligibility of all of them, **three times** (once inside each
 *   route's own `getWeeklyTeamPoints`/`getOptimalLineups`);
 * - and the rest-of-season lineup solve for every team in every league,
 *   **twice** — the KTC and ADP routes ask for the identical lineups off
 *   identical rosters, since a starter value is a sum over whoever starts and
 *   neither lens changes who that is.
 *
 * None of that is a bug: each route is correct on its own and the repetition is
 * invisible from inside any of them. It is CPU and pool connections on the web
 * process, multiplied by the number of lenses a reader has switched on.
 *
 * ## The three entries, and why they are three
 *
 * They age at different speeds and they fail independently, which is the whole
 * argument against one object with three lazy fields:
 *
 * - **the rosters** — cheap, wanted by all three lenses, and the thing every
 *   other entry is derived from;
 * - **the projection inputs** — the expensive read and much the largest value
 *   here, wanted by the ranks' weekly solves and by the aggregate lineup;
 * - **the aggregate lineups** — expensive CPU, wanted by the two value lenses
 *   and by neither the ranks nor anything else.
 *
 * A lens that only needs the first never waits on the third, and a projections
 * read that fails costs the two entries under it and not the rosters — which is
 * the failure isolation the routes already have and must keep: KTC and ADP
 * price a roster with no projection at all, they merely lose the split and the
 * rank. Sharing a read makes it neither fatal nor silent: the callers still wrap
 * it in `readOptional`, so a failure reaches the payload as a status rather than
 * as an empty answer, and a rejection is never stored here.
 *
 * **The ranks are deliberately not one of these entries.** They are already
 * cached and coalesced a layer up (`MANAGER_RANKS_CACHE`), and their weekly
 * solves are a genuinely different computation from the aggregate lineup — one
 * lineup per team per week against one lineup per team. What they share with
 * the other two is the *reads*, and that is exactly what they now take from
 * here; forcing them onto the aggregate lineup to widen the reuse would change
 * the number.
 *
 * ## Why the window is seconds rather than minutes
 *
 * This holds *user-specific roster state*, which is the one thing in this app
 * that a reader can change and then look straight at. So it is not a freshness
 * policy at all — it is a **burst window**, sized for the fan-out of one screen
 * load rather than for how fast rosters move, and the invalidation is what
 * actually bounds staleness:
 *
 * - `persistLeagueGraph` forgets every rostered manager's snapshot after its
 *   commit, beside the ranks and the league detail it already forgot, so a
 *   manager's own leagues sync and the on-demand league refresh are exact in the
 *   process that served them;
 * - and what the clock is left covering is the seconds between the first and the
 *   last request of one screen load.
 *
 * At these lifetimes the layer is close to pure in-flight coalescing — the
 * `TtlPromiseCache` in-flight map is what catches the three requests that
 * actually arrive together — and the few seconds of resolved life are there for
 * the request that arrives just *after* the read it would have shared resolved:
 * the ADP values are a POST whose league scope the client resolves first, so it
 * routinely starts a beat behind its two siblings.
 */

import type {
  HorizonProjectionInputs,
  LeagueTeamsInput,
  OptimalLineups,
} from "../projections/outlook.ts";
import { TtlPromiseCache } from "../util/ttl-promise-cache.ts";

import type { LeagueRosterSet } from "./types.ts";

/**
 * How long one manager's roster set is worth reusing, and how many managers are
 * kept.
 *
 * **Thirty seconds, which is shorter than every other cache in this app by two
 * orders of magnitude, and deliberately so.** What the other server caches hold
 * is either everybody's (an ADP board) or already invalidated on write with a
 * clock only covering background syncs (the ranks, a league's detail). This
 * holds one account's rosters, and a reader who sets a lineup and reloads is
 * looking straight at it — so the number is chosen as "long enough for one
 * screen's requests to be one read", not as "how long rosters stay true".
 *
 * It is under the browser's own stale times rather than over them, which
 * inverts the rule the long-lived caches keep (`manager/read-cache`), and the
 * inversion is the point: this layer is not standing behind a revalidation, it
 * is standing behind the *fan-out of a single load*. A revalidation five
 * minutes later should re-read.
 *
 * An entry is every roster of every league the manager fielded a team in —
 * a hundred-league account is well over a thousand rosters — so the bound is in
 * *managers* and it is small: eight is the handful being loaded at once inside
 * half a minute, and eviction is recency.
 */
export const MANAGER_SNAPSHOT_CACHE = {
  name: "manager-snapshot",
  ttlMs: 30 * 1000,
  max: 8,
} as const;

/**
 * How long the account-wide projection inputs are worth reusing.
 *
 * **The shortest window and the smallest bound here, because this is by far the
 * largest value.** An entry is every stored stat line of every remaining week
 * for every player on every roster of the account — tens of thousands of rows
 * for a large one — so it is held for the burst that shares it and no longer.
 * Fifteen seconds covers the gap between the ranks' weekly solves and the value
 * lenses' aggregate lineup starting off the same rosters, which is microseconds
 * in the ordinary case and a scheduling hiccup at worst.
 *
 * Three entries rather than eight: the readers of this are two computations of
 * one screen load, so the working set is the accounts genuinely being loaded at
 * this instant. **A non-positive lifetime would still be correct** — it stores
 * nothing and the layer degrades to exactly the in-flight coalescing, see
 * `BoundedCache.set` — which is the honest reading of how little of this
 * window's value is in the *resolved* half.
 */
export const MANAGER_PROJECTION_INPUTS_CACHE = {
  name: "manager-projection-inputs",
  ttlMs: 15 * 1000,
  max: 3,
} as const;

/**
 * How long the account-wide aggregate lineups are worth reusing.
 *
 * The rosters' own window, because this is a pure function of the rosters and
 * the projections rows: an entry outliving the rosters it was solved over is
 * the one thing the pairing must not allow, and a shorter one would re-solve
 * every team in every league for rosters this process is still answering from
 * memory.
 *
 * An entry is small — a league per key holding a roster per team holding a
 * handful of player ids — so this is the cheapest of the three to hold and is
 * bounded with the rosters it belongs to rather than on its own account.
 */
export const MANAGER_LINEUPS_CACHE = {
  name: "manager-lineups",
  ttlMs: 30 * 1000,
  max: 8,
} as const;

/** A cache's policy, as the three constants above spell one. */
export type SnapshotCachePolicy = {
  name: string;
  ttlMs: number;
  max: number;
};

/**
 * The cache key for everything one manager's snapshot holds.
 *
 * **Keyed on the canonical Sleeper id rather than the searched name**, which is
 * `managerRanksCacheKey`'s rule and the reason the routes resolve before they
 * read: `Jkap` and `jkap` are one account, and keying on what was typed would
 * read the same rosters once per spelling.
 *
 * The season is a segment of its own because it selects a different set of
 * rosters *and* a different set of projections — two seasons are two subjects
 * and must never answer for each other — and it is spelled out into a fixed
 * array rather than concatenated, so no id or season containing the separator
 * can collide with another pair.
 */
export function managerSnapshotCacheKey(userId: string, season: string): string {
  return JSON.stringify([userId, season]);
}

/**
 * One manager's leagues for a season, and the subset holding a roster of theirs.
 *
 * Both halves travel together because the split is exactly what the two value
 * lenses each computed for themselves before — see {@link ownedLeagues}.
 */
export type ManagerRosterSnapshot = {
  userId: string;
  season: string;
  /**
   * Every league the manager fielded a team in, as `getManagerLeagueRosters`
   * returns them. The projected ranks read this one: a league the manager has
   * left a roster in still has a standing to rank against.
   */
  leagues: readonly LeagueRosterSet[];
  /** {@link ownedLeagues} of the above — what the KTC and ADP lenses price. */
  owned: readonly LeagueRosterSet[];
};

/**
 * The leagues this manager currently holds a roster in.
 *
 * **One function because two lenses were spelling it out separately**, and a
 * roster set they disagreed about would be a starter value priced over one
 * population and ranked over another — invisible in both payloads. It is not a
 * new rule: it is the `withOwn` filter the KTC and ADP routes each opened with,
 * moved to where the lineups they share are solved from it.
 *
 * Deliberately *not* the same question as `FIELDED_A_TEAM_SQL`, which is what
 * put these leagues in the list at all: that one keeps a league a manager
 * fielded a team in at some point, and this one asks who owns a roster *now*.
 * A value lens needs a roster to price; a rank does not.
 */
export function ownedLeagues(
  userId: string,
  leagues: readonly LeagueRosterSet[],
): LeagueRosterSet[] {
  return leagues.filter((league) =>
    league.teams.some((team) => team.owner_id === userId),
  );
}

/**
 * One league as the lineup entry points want it.
 *
 * **One function because three callers were spelling it out**, and it is here
 * with `ownedLeagues` rather than beside the wiring for the same reason: two
 * spellings of "what a league is to the solver" is a difference no type can
 * catch, and the whole value of sharing a read is that the callers cannot
 * disagree about what it was taken over.
 *
 * `best_ball` is deliberately not carried: it is read only by the week's lineup
 * solve, which is a different entry point and does not come through here.
 */
export function toLeagueTeamsInput(league: LeagueRosterSet): LeagueTeamsInput {
  return {
    league_id: league.league_id,
    rosterPositions: league.roster_positions,
    scoringSettings: league.scoring_settings,
    teams: league.teams,
  };
}

/** The reads {@link memoizeManagerSnapshot} coalesces, as arguments. */
export type ManagerSnapshotLoaders = {
  /** Every league and roster of one manager's season. */
  rosters(userId: string, season: string): Promise<LeagueRosterSet[]>;
  /**
   * The projections and positions for **every** league on the snapshot, not just
   * the owned ones — the superset is what makes one read answer for a caller
   * holding any subset of it.
   */
  projectionInputs(
    snapshot: ManagerRosterSnapshot,
  ): Promise<HorizonProjectionInputs>;
  /** The rest-of-season lineup for every team in the owned leagues. */
  optimalLineups(
    snapshot: ManagerRosterSnapshot,
    inputs: HorizonProjectionInputs,
  ): Promise<OptimalLineups>;
};

/** A cached, coalesced manager snapshot — see {@link memoizeManagerSnapshot}. */
export type MemoizedManagerSnapshot = {
  rosters(userId: string, season: string): Promise<ManagerRosterSnapshot>;
  projectionInputs(
    userId: string,
    season: string,
  ): Promise<HorizonProjectionInputs>;
  optimalLineups(userId: string, season: string): Promise<OptimalLineups>;
  /** Drop all three entries for one manager and season. */
  forget(userId: string, season: string): void;
  /** For tests, and for a caller that knows everything is invalidated. */
  clear(): void;
  /** Resolved entries held across the three caches. */
  readonly size: number;
  /** Reads running right now across the three caches. */
  readonly inFlight: number;
};

/**
 * Wrap the three reads in this process's caches, chained.
 *
 * **The loaders are arguments rather than imports**, which is what lets the read
 * *count* be the assertion — `memoizeLeagueOutlook`'s shape and
 * `memoizeManagerLookup`'s, for the same reason.
 *
 * The chaining is here rather than in the wiring file because it is the part
 * that has to be right: `projectionInputs` reads the rosters *through the cache*
 * and `optimalLineups` reads both through it, so a caller asking only for the
 * lineups still costs one rosters read shared with whoever asked for those. A
 * loader that reached for its own inputs would be the duplication this exists to
 * remove, wearing a cache.
 *
 * Rejections are never stored and never linger — `TtlPromiseCache`'s own rule —
 * so a database blip costs the requests that met it and the next caller retries.
 * That matters more here than anywhere else in the app: these entries are seconds
 * long, and a poisoned one would blank a Manager screen's columns for the whole
 * of the reader's next few reloads.
 *
 * **Nothing is frozen**, unlike the ranks payload and the league outlook. Two of
 * these three carry `Map`s, where `Object.freeze` is a guarantee that cannot be
 * kept; and the third is the largest structure this process holds, so deep
 * freezing tens of thousands of rows on every miss would be real work on the
 * exact path this exists to shorten. What replaces it is the contract
 * `readLeagueDetail` already keeps: every consumer here reads and none writes —
 * the solvers copy (`lineupCandidates`, `weeklyRosters`, `aggregateWeeklyStats`
 * all build fresh objects) and the routes only look things up.
 */
export function memoizeManagerSnapshot(
  loaders: ManagerSnapshotLoaders,
  policies: {
    rosters?: SnapshotCachePolicy;
    projectionInputs?: SnapshotCachePolicy;
    optimalLineups?: SnapshotCachePolicy;
  } = {},
): MemoizedManagerSnapshot {
  const rosterCache = new TtlPromiseCache<ManagerRosterSnapshot>(
    policies.rosters ?? MANAGER_SNAPSHOT_CACHE,
  );
  const inputsCache = new TtlPromiseCache<HorizonProjectionInputs>(
    policies.projectionInputs ?? MANAGER_PROJECTION_INPUTS_CACHE,
  );
  const lineupCache = new TtlPromiseCache<OptimalLineups>(
    policies.optimalLineups ?? MANAGER_LINEUPS_CACHE,
  );

  const rosters = (userId: string, season: string) =>
    rosterCache.read(managerSnapshotCacheKey(userId, season), async () => {
      const leagues = await loaders.rosters(userId, season);
      return {
        userId,
        season,
        leagues,
        owned: ownedLeagues(userId, leagues),
      };
    });

  const projectionInputs = (userId: string, season: string) =>
    inputsCache.read(managerSnapshotCacheKey(userId, season), async () =>
      loaders.projectionInputs(await rosters(userId, season)),
    );

  const optimalLineups = (userId: string, season: string) =>
    lineupCache.read(managerSnapshotCacheKey(userId, season), async () => {
      // Sequential rather than parallel: the inputs are read *from* the rosters,
      // and both are cache reads the siblings are already sharing.
      const snapshot = await rosters(userId, season);
      return loaders.optimalLineups(
        snapshot,
        await projectionInputs(userId, season),
      );
    });

  return {
    rosters,
    projectionInputs,
    optimalLineups,
    forget(userId, season) {
      const key = managerSnapshotCacheKey(userId, season);
      rosterCache.forget(key);
      inputsCache.forget(key);
      lineupCache.forget(key);
    },
    clear() {
      rosterCache.clear();
      inputsCache.clear();
      lineupCache.clear();
    },
    get size() {
      return rosterCache.size + inputsCache.size + lineupCache.size;
    },
    get inFlight() {
      return rosterCache.inFlight + inputsCache.inFlight + lineupCache.inFlight;
    },
  };
}
