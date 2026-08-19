/**
 * What varies a league's rest-of-season outlook, what it is keyed by, and how
 * long an answer is kept.
 *
 * **Policy, keys and the memoiser — but not the loader**, which is the
 * `manager/read-cache` split and the `user-resolution`/`resolve` split in one:
 * everything here arrives as an erased `import type` or a relative `.ts` value
 * import, so the whole of it can be driven by Node's test runner with nothing
 * behind it. `./outlook-read.ts` is where {@link memoizeLeagueOutlook} is wired
 * to the read that actually touches Postgres. A cache key is exactly the kind of
 * thing that is wrong *silently* — too narrow and one league's lineups are
 * served under another's, too wide and the cache never hits — so it is the half
 * that has to be testable.
 *
 * ## What the key names, and why that is the invalidation
 *
 * The outlook is a pure function of the league's slots, its scoring, its rosters
 * and the projections stored for the weeks still ahead. The first three are
 * exactly what `LeagueDetail` carries, so **the key spells them out** rather
 * than naming the league and trusting a hook to notice when they change. That
 * choice is what makes this cache safe without an invalidation framework beside
 * it:
 *
 * - A roster move, a settings change or a slot change produces a **different
 *   key**, so a stale entry cannot be read at all — whatever the clock says, and
 *   whichever process wrote the rows. `persistLeagueGraph` already forgets the
 *   league's core detail in the process that served the press, so the panel's
 *   refetch resolves the *new* rosters and asks this cache a question it has
 *   never been asked.
 * - What is left outside the key is the projections rows, and that is what the
 *   TTL below is for. They move on the projections sync's own clock — an hour
 *   for the two nearest weeks — so a window well inside it is stale about
 *   nothing a reader could see.
 *
 * The invariant worth stating: **an entry here can never be staler than the
 * league detail it was computed from**, because that detail *is* its key.
 *
 * Spelled out field by field rather than `JSON.stringify(theWholeInput)`,
 * `manager/read-cache`'s rule — property order is not a fact about the values —
 * and the ids go in **verbatim rather than digested**, since a hash trades a
 * silent collision for a shorter key and a collision here is one league's
 * lineups served to another.
 */

import { deepFreeze } from "../util/deep-freeze.ts";
import { TtlPromiseCache } from "../util/ttl-promise-cache.ts";

import type { LeagueOutlook, OutlookRoster } from "./outlook.ts";

/**
 * How long one league's outlook is worth reusing, and how many are kept.
 *
 * **Eight minutes: exactly `LEAGUE_DETAIL_CACHE`'s window**, which is the
 * only number that reads as a claim rather than a guess. The outlook is solved
 * *from* that detail, so a window in which the rosters are worth reusing is the
 * window in which lineups solved over them are — the same argument
 * `LEAGUE_DETAIL_STALE_TIME` makes for holding one client stale time across all
 * four of the panel's entries. Longer would mean an outlook outliving the
 * rosters it describes; shorter would mean re-solving a dozen teams over
 * eighteen weeks for rosters this process is still answering from memory.
 *
 * It stands behind the browser's five (`LEAGUE_DETAIL_STALE_TIME`), which is the
 * ordering `features/shared/cache-layering.test.ts` asserts: a client entry going
 * stale costs a request this answers from memory rather than ~180ms of lineup
 * solving. What that leaves to the clock is the projections sync's writes, whose
 * fastest tier is an hour.
 *
 * An entry is a per-player total for every rostered player plus a lineup and a
 * weekly split per team — larger than a league detail and much smaller than an
 * ADP board — so 64 leagues is a handful of megabytes and far more than one
 * process's working set inside eight minutes. Eviction is recency, and a roster
 * change leaves the entry it superseded to be evicted rather than read.
 */
export const LEAGUE_OUTLOOK_CACHE = {
  name: "league-outlook",
  ttlMs: 8 * 60 * 1000,
  max: 64,
} as const;

/** Everything {@link memoizeLeagueOutlook}'s answer varies on. */
export type LeagueOutlookInput = {
  /**
   * The league — not read by the solve at all (it works off the rosters), and in
   * the key regardless: two leagues that happen to agree on every setting and
   * every roster are still two subjects, and a key that pooled them would make
   * the debug line unreadable and the eviction order meaningless.
   */
  leagueId: string;
  season: string;
  rosterPositions: readonly string[] | null;
  scoringSettings: Record<string, number> | null;
  teams: readonly OutlookRoster[];
};

/**
 * The cache key for one league's outlook.
 *
 * `rosterPositions` and each team's `starters` go in **in their given order**,
 * because both are positional — a slot list is the lineup's shape and a starters
 * array is aligned with it — while `players` is a *set* of candidates and is
 * sorted, so two syncs that returned one roster in two orders are one key rather
 * than two solves.
 *
 * The teams themselves are **not** reordered: `LeagueOutlook.teams` comes back
 * in the order it was given, so team order is a fact about the answer.
 */
export function leagueOutlookCacheKey(input: LeagueOutlookInput): string {
  return JSON.stringify([
    input.leagueId,
    input.season,
    input.rosterPositions,
    sortedScoring(input.scoringSettings),
    rosterRevision(input.teams),
  ]);
}

/**
 * What about a set of rosters can change a lineup answer, in a stable spelling.
 *
 * One function because the two enrichment caches ask the same question of the
 * same rosters — `shared/stats/read-cache` keys a week on it too — and two
 * spellings of "what a roster is" would be two rules that could disagree about
 * whether a change matters. What is deliberately *not* here: records, points
 * for, picks and the manager behind a roster. None of them reach a solve, and
 * a key naming them would re-solve every league's lineups every time a game
 * finished somewhere.
 */
export function rosterRevision(
  teams: readonly { roster_id: number; players: readonly string[]; starters: readonly string[] }[],
): unknown[] {
  return teams.map((team) => [
    team.roster_id,
    [...team.players].sort(),
    // Positional: index i is the player in the league's i-th starting slot.
    team.starters,
  ]);
}

/**
 * A scoring blob as a key spells it: entries sorted by stat.
 *
 * Sorted rather than serialised as-is for `manager/read-cache`'s reason — the
 * property order of a blob assembled by two different reads is not a fact about
 * the league's scoring, and a key that told them apart would solve the same
 * lineups twice.
 */
export function sortedScoring(
  scoring: Record<string, number> | null,
): [string, number][] | null {
  if (!scoring) return null;
  return Object.entries(scoring).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** A cached, coalesced outlook read — see {@link memoizeLeagueOutlook}. */
export type MemoizedLeagueOutlook = {
  read(input: LeagueOutlookInput): Promise<LeagueOutlook | null>;
  /** Drop one league's entry, for a caller that has just rewritten it. */
  forget(input: LeagueOutlookInput): void;
  /** For tests, and for a caller that knows everything is invalidated. */
  clear(): void;
  /** Resolved entries held. */
  readonly size: number;
  /** Solves running right now. */
  readonly inFlight: number;
};

/**
 * Wrap an outlook loader in the process's cache.
 *
 * **The loader is an argument rather than an import**, which is what lets the
 * request *count* be the assertion — `memoizeManagerLookup`'s shape, for the
 * same reason. What this is for is the case neither the browser's cache nor the
 * league-detail cache underneath can reach: two tabs, two readers of one league,
 * a revalidation and a cold navigation arriving together each paid ~180ms of
 * lineup solving in full, on the web process's own event loop.
 *
 * A rejection is never stored and never lingers, `TtlPromiseCache`'s own rule:
 * the callers waiting on a failed solve all see the failure, and the next
 * request retries against a database that may well have recovered.
 *
 * **A null is a real answer and is cached like any other** — a league with no
 * slots on file, no scoring to score with or nothing left on the schedule cannot
 * be projected, and re-deriving that per request is exactly the repetition this
 * exists to stop. It is wrapped in an object because `TtlPromiseCache` reports
 * "nothing stored" as `undefined`.
 */
export function memoizeLeagueOutlook(
  load: (input: LeagueOutlookInput) => Promise<LeagueOutlook | null>,
  policy: { name: string; ttlMs: number; max: number } = LEAGUE_OUTLOOK_CACHE,
): MemoizedLeagueOutlook {
  const cache = new TtlPromiseCache<{ outlook: LeagueOutlook | null }>(policy);

  return {
    read(input) {
      return cache
        .read(leagueOutlookCacheKey(input), async () => ({
          // Frozen because it is shared: every caller inside the TTL holds this
          // same object, so a route that sorted or annotated it in place would
          // be editing what every later reader gets. It is plain objects and
          // arrays all the way down — unlike the week view's `Map`s, where the
          // freeze is a guarantee that cannot be kept.
          outlook: deepFreeze(await load(input)),
        }))
        .then((entry) => entry.outlook);
    },
    forget(input) {
      cache.forget(leagueOutlookCacheKey(input));
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
