/**
 * What varies one league's week, what it is keyed by, and how long an answer may
 * be kept — which here is a question about *live* data and is answered much more
 * carefully than its rest-of-season sibling's.
 *
 * Pure, and the same split as `projections/read-cache`: the policy, the key, the
 * freshness bound and the memoiser live here with nothing behind them, and
 * `./week-read.ts` is where {@link memoizeLeagueWeek} is wired to the read that
 * touches Postgres.
 *
 * ## The week is not the outlook, and the difference is the whole file
 *
 * A rest-of-season outlook is stale about the projections sync and nothing else,
 * so it holds for as long as the rosters it was solved from. A week answers four
 * questions that move on their own clocks:
 *
 * - **the lineup a manager has actually set**, which they can change until
 *   kickoff — carried in the key, below, so a changed lineup is a changed key;
 * - **which seats have locked**, which changes at *every kickoff in the week*
 *   (`lockedPlayers` settles a player the minute his game starts) — bounded
 *   by {@link weekEntryTtlMs}, which reads the next kickoff off the very
 *   schedule the answer already carries;
 * - the week's projections, and the played weeks the form column averages, both
 *   on their syncs' own hourly-and-slower clocks — what the short TTL is for.
 *
 * So this cache is **not** the layer that stands behind a browser stale time,
 * which is what every other server cache in this app is for. Its TTL is
 * deliberately *shorter* than `LEAGUE_DETAIL_STALE_TIME` rather than longer:
 * what it exists to absorb is a **burst** — the tabs, readers and revalidations
 * that arrive inside one ~450ms computation of each other — and holding live
 * lineup data for as long as a browser calls it fresh would be trading a real
 * guarantee for a cheaper repeat. `features/shared/cache-layering.test.ts`
 * asserts that ordering too, so nobody "fixes" the inversion later.
 */

import { rosterRevision, sortedScoring } from "../projections/read-cache.ts";
import { TtlPromiseCache } from "../util/ttl-promise-cache.ts";

import type { LeagueWeekView } from "./league-week.ts";

/**
 * How long one league-week is worth reusing, and how many are kept.
 *
 * **A minute, and every part of that number is a ceiling rather than a target.**
 * The computation is the most expensive of the panel's three enrichments
 * (~420–520ms on a seeded corpus), so the window only has to be wide enough to
 * hold a burst of arrivals together; what a longer one would buy is repeat
 * readers, and what it would cost is the one thing this read must not get wrong.
 * The three inputs the key does not carry all move slower than this by an order
 * of magnitude (the projections sync's fastest tier is an hour; stat lines
 * likewise), and the one that moves *faster* — a game kicking off — is not left
 * to the clock at all: see {@link weekEntryTtlMs}, which cuts the entry short at
 * the next kickoff.
 *
 * It is bounded in whole week views, each a projection and a form reading per
 * rostered player plus a lineup per team, so 32 is a few megabytes at worst —
 * and far more than the working set, since an entry lives a minute.
 */
export const LEAGUE_WEEK_CACHE = {
  name: "league-week",
  ttlMs: 60 * 1000,
  max: 32,
} as const;

/** Everything {@link memoizeLeagueWeek}'s answer varies on. */
export type LeagueWeekInput = {
  leagueId: string;
  season: string;
  week: number;
  teams: readonly {
    roster_id: number;
    players: readonly string[];
    starters: readonly string[];
  }[];
  rosterPositions: readonly string[] | null;
  scoringSettings: Record<string, number> | null;
  bestBall: boolean;
  medianMatch: boolean;
};

/**
 * The cache key for one league's week.
 *
 * **The lineup is in the key, and that is what makes caching live data safe at
 * all.** Every team's `starters` is what this read compares against the best
 * lineup available, so a manager who moves somebody — and a reader who presses
 * the panel's sync key to fetch that move — arrives at a key this cache has
 * never been asked, in the same request that re-read the rosters
 * (`persistLeagueGraph` forgets the league's detail at the write). A cache keyed
 * on the league and the week alone would have answered that press from the
 * lineup it was pressed to replace, which is worse than not having the key.
 *
 * `week` is its own segment for the obvious reason and is worth stating because
 * it is the cross-contamination that would be invisible: two weeks of one league
 * are two different answers with the same rosters behind them.
 *
 * `bestBall` and `medianMatch` are in it because each changes the answer rather
 * than only the presentation — a best-ball league's current lineup *is* its
 * optimal one, and a median league carries a bar every team is measured against.
 */
export function leagueWeekCacheKey(input: LeagueWeekInput): string {
  return JSON.stringify([
    input.leagueId,
    input.season,
    input.week,
    input.rosterPositions,
    sortedScoring(input.scoringSettings),
    input.bestBall,
    input.medianMatch,
    rosterRevision(input.teams),
  ]);
}

/**
 * How long this week view may be kept: the cache's own window, cut short at the
 * next kickoff.
 *
 * **A kickoff is the one boundary a clock cannot be set for in advance**, and it
 * is the boundary that matters: `lockedPlayers` settles a player's seat the
 * minute his game starts (`kickoff <= now` locks), so at every instant in the
 * `games` map the answer changes — the gap column, the swap marks and the
 * kickoff re-seat all move together. An entry written at 12:59 on a Sunday and
 * held for a minute is an entry describing the 1pm games as movable *after they
 * kicked off*, which is the failure this read is least allowed: it names a swap
 * Sleeper would refuse.
 *
 * Read off the **answer** rather than off a second schedule fetch, which is why
 * `TtlPromiseCache.read` takes a `ttlMsFor`: the instants are already in the view
 * (`view.games`), so the bound and the answer cannot disagree about what the
 * schedule said.
 *
 * A boundary already reached, or one arriving now, gives **zero** — and a
 * non-positive lifetime stores nothing at all (`BoundedCache.set`), so the
 * minutes around a kickoff degrade to in-flight coalescing alone rather than to
 * a wrong answer. Every other degradation is in the same direction: a week
 * Sleeper has not dated (no `games`, or none with an instant) simply takes the
 * full window, which is what the day-accurate lock fallback underneath it is
 * already doing.
 */
export function weekEntryTtlMs(
  kickoffs: Iterable<number | null>,
  now: number,
  maxMs: number = LEAGUE_WEEK_CACHE.ttlMs,
): number {
  let ttlMs = maxMs;
  for (const kickoff of kickoffs) {
    // A kickoff already past is not a boundary ahead: it is part of what this
    // answer already says.
    if (kickoff === null || kickoff <= now) continue;
    ttlMs = Math.min(ttlMs, kickoff - now);
  }
  return Math.max(0, ttlMs);
}

/**
 * A cached, coalesced week read — see {@link memoizeLeagueWeek}.
 *
 * Generic in its input so the wiring can hand the loader the league teams it
 * actually wants (`LeagueTeam`, records and picks and all) while the key here
 * reads the three fields a lineup answer varies on and nothing else.
 */
export type MemoizedLeagueWeek<I extends LeagueWeekInput = LeagueWeekInput> = {
  read(input: I): Promise<LeagueWeekView>;
  /** Drop one entry, for a caller that has just rewritten what is behind it. */
  forget(input: I): void;
  /** For tests, and for a caller that knows everything is invalidated. */
  clear(): void;
  /** Resolved entries held. */
  readonly size: number;
  /** Reads running right now. */
  readonly inFlight: number;
};

/**
 * Wrap a week loader in the process's cache.
 *
 * **What this is really for is the in-flight half.** Two tabs, two readers of
 * one league, a revalidation and a cold navigation arriving inside the same
 * ~450ms window each ran the whole read — a projection and a form reading per
 * rostered player, a lineup solve per team, and the schedule — and none of them
 * could be shared with any of the others. Coalesced, the first computes and the
 * rest wait on it, which is the guarantee that costs no freshness whatsoever:
 * every waiter asked for this answer before it existed.
 *
 * The resolved half on top of it is small and bounded twice — by
 * {@link LEAGUE_WEEK_CACHE}'s minute and by {@link weekEntryTtlMs}'s next
 * kickoff — and by the key, which carries the lineup itself.
 *
 * **Deliberately not frozen**, unlike the outlook beside it: the view carries
 * `Map`s, and `Object.freeze` on a `Map` is a guarantee that cannot be kept
 * (`deepFreeze`'s own note). What replaces it is the contract every consumer
 * already keeps — the route serialises this view and writes nothing to it.
 *
 * The loader and the clock are both arguments, for the same reason: it is what
 * lets the request *count* and the freshness boundary be asserted with nothing
 * behind them.
 */
export function memoizeLeagueWeek<I extends LeagueWeekInput>(
  load: (input: I) => Promise<LeagueWeekView>,
  options: {
    policy?: { name: string; ttlMs: number; max: number };
    now?: () => number;
  } = {},
): MemoizedLeagueWeek<I> {
  const policy = options.policy ?? LEAGUE_WEEK_CACHE;
  const now = options.now ?? Date.now;
  const cache = new TtlPromiseCache<LeagueWeekView>(policy);

  return {
    read(input) {
      return cache.read(leagueWeekCacheKey(input), () => load(input), {
        ttlMsFor: (view) =>
          weekEntryTtlMs(
            // The instants this very answer was computed against.
            [...view.games.values()].map((game) => game.kickoff),
            now(),
            policy.ttlMs,
          ),
      });
    },
    forget(input) {
      cache.forget(leagueWeekCacheKey(input));
    },
    clear() {
      cache.clear();
    },
    get size() {
      return cache.size;
    },
    get inFlight() {
      return cache.inFlight;
    },
  };
}
