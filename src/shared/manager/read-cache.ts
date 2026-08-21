/**
 * What varies the two expensive server-side reads, what they are keyed by, and
 * how long an answer is kept.
 *
 * **Keys and policy only — the caches themselves live beside the reads they
 * hold**, `getDraftAdp` in `./adp.ts` and `readManagerRanks` in
 * `./ranks-read.ts`. That split is what makes this module pure: everything it
 * touches from either arrives as an erased `import type`, so the keys can be
 * driven by Node's test runner with nothing behind them — the same bar
 * `adp-filters` and `rank` hold, and for the same reason. A cache key is exactly
 * the kind of thing that is wrong silently: too narrow and one board's answer is
 * served under another's filters, too wide and the cache never hits, and neither
 * shows up as an error.
 *
 * **Both keys name every input the answer varies on, spelled out rather than
 * `JSON.stringify(value)`.** Serialising an object straight puts its *property
 * order* in the key, so a filters object assembled field-by-field somewhere else
 * would miss against an identical one from the parser. Writing the fields into a
 * fixed-order array makes the key a fact about the values.
 *
 * The list fields are sorted and deduplicated on the way in, which is
 * normalisation rather than tidying: `= ANY(…)` and `<> ALL(…)` are set
 * comparisons, so `["snake","linear"]` and `["linear","snake"]` are one
 * population, and a key that told them apart would compute the same board twice.
 * The ids go in **verbatim rather than digested**, for the reason `boardSignature`
 * spells its league scope out: a hash trades a silent collision for a shorter
 * key, and a collision here is one reader's board served to another with nothing
 * to say so.
 *
 * ## Which way round the TTLs go
 *
 * **Every TTL here is longer than the browser stale time in front of it**, and
 * the three of them used to be the other way about — a rule stated in each of
 * these comments, and inverted in each of the numbers under them. What the two
 * layers do is not symmetrical, which is why the ordering is not a matter of
 * taste:
 *
 * - **The browser entry** (`LEAGUE_DETAIL_STALE_TIME`, `ADP_STALE_TIMES`,
 *   `MANAGER_STALE_TIMES`) answers *one device* with no request at all. When it
 *   goes stale React Query revalidates — it re-asks, and shows what it holds
 *   until the answer lands.
 * - **This layer** is what that revalidation should land on. It answers from
 *   memory, for every reader, every tab and every process-mate at once.
 * - **Postgres** is underneath both, and is the source of truth. A miss here is
 *   not a wrong answer, it is a second of aggregate over 1.9M picks, or four
 *   queries, or a thousand lineup solves.
 *
 * Read that way the old ordering was exactly backwards: with a server TTL
 * *shorter* than the client's, the first revalidation after a client entry goes
 * stale is a guaranteed miss here, so the layer that exists to absorb
 * revalidations was expiring just in time to miss every one of them. The rule
 * this file now keeps is `client stale < server TTL`, with the gap wide enough
 * to absorb the jitter between two readers rather than merely non-zero — a
 * server TTL a minute over the client's would still miss most of the time, since
 * a request arriving uniformly inside an entry's life finds `(ttl − stale) / ttl`
 * of it left. `features/shared/cache-layering.test.ts` is where that ordering is
 * asserted against the client's own constants; the ceilings below are asserted
 * here, because "not excessively stale" is a claim about what writes underneath.
 *
 * **Staleness is bounded by a write, not only by a clock, wherever a reader can
 * cause one.** `LEAGUE_DETAIL_CACHE` and `MANAGER_RANKS_CACHE` are both dropped
 * when a league's graph is persisted (see `persistLeagueGraph`), so the paths a
 * reader can *press* — the panel's sync key, a manager's own leagues sync — are
 * exact in the process serving them rather than TTL-bounded. That is what makes
 * these longer TTLs safe to hold: what they are stale about is a background
 * write nobody asked for, on its own slower clock.
 */

import { booleanFilter } from "../query/parse.ts";

import type { ManagerRanksPayload } from "../contract/index.ts";
import type { AdpFilters } from "./adp-filters.ts";

/**
 * How long a full ADP board is worth reusing, and how many are kept.
 *
 * **Thirty minutes, the same TTL as the per-player board next to it** — and for
 * the same two reasons.
 *
 * The first is what writes underneath: the league crawler, whose fastest tier is
 * fifteen minutes and whose effect on any one board is a handful of new drafts
 * among thousands. A board is an *average* over ~1.5M picks, so a half-hour-old
 * one and a fresh one differ by nothing a reader could see — this is the read in
 * the app where a longer TTL costs the least.
 *
 * The second is the browser in front of it. `ADP_STALE_TIMES.board` is fifteen
 * minutes, so at the old ten this expired *before* the client entry it was
 * standing behind: every revalidation the browser made was a guaranteed miss
 * here, and the miss is a second of aggregate over ~1.5M picks plus a count
 * statement. Twice the client's window is what makes the layer useful — a
 * revalidation lands inside a live entry rather than just after one lapsed, and
 * the drawer's other two reads (`density` and `leagues`, both thirty minutes in
 * the browser) sit level with it rather than past it.
 *
 * Nothing invalidates this on write, which is the honest reason it may be the
 * longest TTL here: no reader can ask for a draft to be crawled, so there is no
 * press for a stale board to make look broken.
 *
 * The bound is in *boards*, and a board is the largest entry any cache in this
 * app holds — the drawer asks for `limit=1000`, so one entry is a thousand rows
 * carrying two five-number board splits each, a few hundred kilobytes. Sixteen
 * is a few megabytes at the worst case and far more than the working set: the
 * population is the same for every reader who has not narrowed it, so the
 * default board is *one* key however many people are reading it, and the
 * distinct entries are the handful of seasons, windows and league-rule sets in
 * play at once. Eviction is recency, so the reader who has stopped scrolling
 * loses their board to the one who hasn't.
 */
export const ADP_BOARD_CACHE = {
  name: "adp-board",
  ttlMs: 30 * 60 * 1000,
  max: 16,
} as const;

/**
 * How long a *priced* board — ADP for a named set of players, both boards in one
 * entry — is worth reusing, and how many are kept.
 *
 * It is policy in this module rather than a pair of constants beside the read
 * for the reason the other three are: it stands behind a browser stale time, and
 * an ordering nothing can see from either side is one that drifts. It was
 * `BOARD_TTL_MS`/`BOARD_CACHE_MAX`, private to `./adp.ts`, so
 * `cache-layering.test.ts` could not name it — which is how it came to be ten
 * minutes behind a fifteen-minute client entry, the same inversion the paged
 * board had.
 *
 * **Two different client stale times sit in front of this one**, which is what
 * decides the number: `/api/user/[username]/adp-value` is
 * `MANAGER_STALE_TIMES.adpValue` (fifteen minutes) and
 * `/api/league/[leagueId]/values` is `LEAGUE_DETAIL_STALE_TIME` (five). The TTL
 * has to clear the *longer* of them, or the valuation's revalidation misses
 * while the panel's hits. Thirty covers both, and matches the paged board it
 * shares a population and a crawler with.
 *
 * The steepness slider is the reason the entry earns its keep at all: the curve
 * is applied by the caller *after* this returns, so every notch asks for a board
 * that is byte-identical to the one just read. See `getDraftAdpForPlayers`.
 *
 * The bound is in *boards*, and each is a map of up to ~1,100 players, so this
 * is the one cache here whose entries are large enough to be worth counting:
 * ~64 of them is a few megabytes at worst. A manager's page reads four (one per
 * distinct scoring/superflex group), so it holds a dozen-odd readers, and the
 * eviction is recency — a reader who has stopped scrolling loses their board to
 * one who hasn't.
 */
export const ADP_PLAYER_BOARD_CACHE = {
  name: "adp-players",
  ttlMs: 30 * 60 * 1000,
  max: 64,
} as const;

/**
 * How long one page's worth of **auction spend** is worth reusing.
 *
 * It stands behind `ADP_STALE_TIMES.board`, exactly as the paged board it rides
 * on the same response as does, and it is the same thirty minutes for the same
 * two reasons: the crawler underneath moves a board by a handful of drafts among
 * thousands, and a client entry going stale at fifteen minutes has to land
 * inside a live entry here or the layer absorbs none of the revalidations it
 * exists for. Matching the paged board rather than picking a number of its own
 * is deliberate — the two are read on the *same request*, so a shorter TTL here
 * would make every board revalidation a guaranteed miss on half its payload
 * while hitting on the other half, which is the asymmetry
 * `cache-layering.test.ts` exists to keep out.
 *
 * The bound is smaller than the paged board's because an entry is: it is a page
 * of ids and four numbers per board, no names and no rows, and it is keyed on
 * the *page* (limit and offset are in the key by way of the ids), so the working
 * set is the handful of boards being scrolled rather than one entry per reader.
 */
export const ADP_AUCTION_CACHE = {
  name: "adp-auction",
  ttlMs: 30 * 60 * 1000,
  max: 32,
} as const;

/**
 * How long a manager's ranks are worth reusing, and how many managers are kept.
 *
 * **Fifteen minutes, against the browser's five** (`MANAGER_STALE_TIMES.ranks`).
 * What it buys is the case the browser cache cannot reach: a second reader, a
 * second tab, a reload, and the boundary where one browser's entry goes stale
 * all land on a payload that costs a lineup solve per team per remaining week
 * across every league the manager plays in — thousands of solves for a large
 * account, none of which the previous reader's cache entry can be shared with.
 *
 * **The two used to be equal, which is the one relationship that reliably wastes
 * the layer.** Nothing lines the clocks up: the client entry is stamped when its
 * request *resolved* and this one when the computation *started*, so at equal
 * TTLs the revalidation at five minutes arrives a beat after the entry it wanted
 * expired — the miss is not a risk at the boundary, it is the normal case, and
 * the read that pays for it is the most expensive in the app that is not a
 * single statement (CPU on the web process, so two readers are two spells of a
 * blocked event loop). Three times the client's window makes the layer hold
 * across a revalidation with room for the jitter between two readers.
 *
 * **What bounds the staleness is a write rather than the clock.** Ranks are read
 * off rosters and projections; the projections sync's fastest tier is an hour,
 * so fifteen minutes is well inside it, and the roster half is invalidated
 * exactly — `persistLeagueGraph` forgets the ranks of every manager rostered in
 * a league it has just rewritten, so a reader whose leagues sync has *just* run
 * recomputes rather than reading a payload from before it. See
 * {@link invalidateManagerRanks}.
 *
 * An entry is small — one rank set per league, so a hundred-odd short objects —
 * so the bound is generous: sixty-four managers is a few megabytes and covers
 * every account a single process is likely to be asked about inside the window.
 */
export const MANAGER_RANKS_CACHE = {
  name: "manager-ranks",
  ttlMs: 15 * 60 * 1000,
  max: 64,
} as const;

/**
 * How long one league's **core** detail is worth reusing, and how many leagues
 * are kept.
 *
 * **Eight minutes, against the browser's five** (`LEAGUE_DETAIL_STALE_TIME`), so
 * a client entry going stale costs a request this answers from memory rather
 * than four queries. It was three, which is the same number the other way round:
 * the panel's revalidation at five minutes could not hit an entry that expired
 * at three, so every reader who kept a card open past their own stale time went
 * to Postgres, and the second reader behind them went again.
 *
 * What it protects is not one reader — the browser cache does that — but the
 * case the browser cannot reach: a second tab, a second reader, a reload, a
 * process that has just restarted, and the **three enrichment routes beside
 * it**, each of which needs the same league, rosters and settings to do its own
 * work. Splitting one payload into four requests would otherwise have multiplied
 * that read by four; cached, the split costs one.
 *
 * An entry is a dozen rosters, their members and their picks — tens of
 * kilobytes — so 256 leagues is a handful of megabytes and far more than the
 * working set of a single process inside eight minutes.
 *
 * **What keeps eight minutes honest is that this is invalidated on write.** It
 * is the one read a *reader* can force a refresh of (the lineup checker's sync
 * key), and a panel that re-read a stale roster straight after Sleeper confirmed
 * the change would make that key look broken — so the TTL is not what that path
 * rests on: `persistLeagueGraph` forgets the league after its transaction
 * commits, in the process that served the press. What is left for the clock is
 * the **crawler's** own writes, which land on the worker dyno and cannot reach
 * this process's memory. Those are bounded by the crawl's fastest tier (fifteen
 * minutes) plus this window; the ceiling is deliberately kept at that tier so
 * this cache stays the smaller of the two terms rather than the dominant one.
 * See `invalidateLeagueDetail`.
 */
export const LEAGUE_DETAIL_CACHE = {
  name: "league-detail",
  ttlMs: 8 * 60 * 1000,
  max: 256,
} as const;

/**
 * Which ranks a request wants — the one option that changes the *work* rather
 * than only the answer.
 *
 * `projections: false` skips the weekly lineup solves entirely, which is the
 * whole cost of this route; see {@link readManagerRanks}. It is in the key
 * because the two answers genuinely differ: the cheap one carries no `weeks` and
 * a null `proj`/`proj_bench` on every league, and serving that to a caller
 * asking for the full one would blank two columns with nothing to say why.
 */
export type ManagerRanksOptions = {
  /** Compute the projected starter and bench ranks. */
  projections: boolean;
};

/**
 * `?projections=` off a ranks request — **defaulting to on**.
 *
 * The default is the compatibility half and is not negotiable: a bookmark, an
 * older client or anything else that omits the parameter has to get the payload
 * it has always got, so the *caller* opts out of work rather than opting into
 * it. `booleanFilter` rather than `booleanFlag` for exactly that reason — the
 * flag primitive reads an absent key as `false`, which is the opposite meaning,
 * and the two spellings being separate functions is what keeps that from being
 * a silent choice (see `shared/query/parse`).
 *
 * A junk value is refused rather than falling back to the default: `?projections=maybe`
 * is a caller that believes it has turned something off.
 */
export function parseManagerRanksOptions(
  params: URLSearchParams,
): { ok: true; options: ManagerRanksOptions } | { ok: false; error: string } {
  const parsed = booleanFilter(params, "projections");
  if (!parsed.ok) return parsed;
  return { ok: true, options: { projections: parsed.value ?? true } };
}

/**
 * The cache key for one ADP board.
 *
 * Every field of {@link AdpFilters} appears, because the query is a pure
 * function of precisely those and nothing else: the draft/league `WHERE` is
 * built from the first fourteen, `min_picks` gates which players come back, and
 * `limit`/`offset` decide the page. `adp-filters.test.ts` pins that agreement
 * field by field, which is the assertion no type can carry — a filter added to
 * the type and forgotten here would serve one board's page under another's
 * filters.
 */
export function adpBoardCacheKey(filters: AdpFilters): string {
  return JSON.stringify([
    sorted(filters.seasons),
    filters.start_after,
    filters.start_before,
    sorted(filters.draft_types),
    sorted(filters.draft_statuses),
    sorted(filters.league_ids),
    sorted(filters.exclude_league_ids),
    sorted(filters.scoring),
    filters.best_ball,
    filters.superflex,
    filters.rounds_min,
    filters.rounds_max,
    filters.teams_min,
    filters.teams_max,
    filters.min_picks,
    filters.limit,
    filters.offset,
  ]);
}

/**
 * How long one ranks payload is worth keeping: {@link MANAGER_RANKS_CACHE}'s own
 * window, or **nothing at all** when the projections half failed.
 *
 * This is the policy half of the fix for the one degraded answer in this app
 * that a long-lived cache used to hold as a fact. `computeManagerRanks` keeps
 * serving the partial payload — the record and points ranks are read off rosters
 * already in hand, and throwing them away because a second read failed is a
 * worse answer — but the degraded payload is indistinguishable *by shape* from a
 * manager with nothing left to project, so it went into fifteen minutes of
 * process memory and five of browser cache as exactly that. Zero here means
 * `BoundedCache.set` stores nothing, so the failure costs the callers already
 * waiting on this computation and nobody after them.
 *
 * **`"skipped"` is cached normally, and that is the load-bearing half.** Nothing
 * failed on a `?projections=0` read: it is the cheap answer the caller asked
 * for, its empty `weeks` is exactly right, and treating it as degraded would
 * make the read every columns-aimed-elsewhere reader makes uncacheable.
 *
 * It is here rather than beside the cache for the reason every key in this file
 * is: it takes its input as an argument and imports nothing at runtime, so the
 * rule can be asserted directly. A TTL rule that fires on the wrong status is
 * silent in both directions — one too broad never caches, one too narrow caches
 * the failure — which is the same shape of mistake a cache key makes.
 */
export function rankEntryTtlMs(payload: ManagerRanksPayload): number {
  return payload.projections === "error" ? 0 : MANAGER_RANKS_CACHE.ttlMs;
}

/**
 * The cache key for one manager's ranks.
 *
 * **Keyed on the canonical Sleeper id rather than the searched name**, which is
 * the whole reason the route resolves before it reads: `Jkap` and `jkap` are one
 * account, and keying on what was typed would compute the same thousands of
 * lineup solves once per spelling. The season is a separate segment because it
 * selects a different set of rosters *and* a different set of projections, and
 * the option because it selects a different amount of work.
 */
export function managerRanksCacheKey(
  userId: string,
  season: string,
  options: ManagerRanksOptions,
): string {
  return JSON.stringify([userId, season, options.projections]);
}

/**
 * A list as the key spells it: sorted and deduplicated, or null left as null.
 *
 * Null is not the same answer as `[]` anywhere in {@link AdpFilters} — an absent
 * `league_ids` narrows nothing where an empty one is rules that matched no
 * league — so the two must not collapse into each other here either.
 */
function sorted<T extends string>(values: readonly T[] | null): T[] | null {
  return values === null ? null : [...new Set(values)].sort();
}
