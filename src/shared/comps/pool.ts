import { getDraftAdpForPlayers, ADP_FILTER_DEFAULTS } from "@/shared/manager";
import { getKtcSfHistoryAsOf, getKtcValuesAsOf } from "@/shared/ktc";
import { getNflDraftPicks } from "@/shared/nfl-draft";
import { getPlayerProfiles } from "@/shared/players";
import { getActiveSeason } from "@/shared/season";
import {
  listSeasonStatLines,
  listStoredPlayerSeasons,
  listStoredSeasons,
  onStatsSeasonWritten,
} from "@/shared/stats";
import { deepFreeze, TtlPromiseCache } from "@/shared/util";

import { applyCompsEnrichment, assemblePoolRows } from "./assemble";
import { COMPS_ENRICHMENTS } from "./fields";
import { anyCompsEnrichment, listCompsEnrichments } from "./enrichment";
import { foldCompsPlayerIndex } from "./player-index";
import { compsReadAdmission } from "./read-admission";
import {
  COMPS_ENRICHMENT_CACHE,
  COMPS_PLAYER_INDEX_CACHE,
  COMPS_POOL_CACHE,
  compsEnrichmentCacheKey,
  compsPoolCacheKey,
  getCompsSeasonTtlMs,
} from "./read-cache";
import { compsSeasonAnchor } from "./resolve";
import { collectSeasonPools } from "./season-pools";

import type { AdpFilters } from "@/shared/manager";
import type { CompsEnrichmentInputs, CompsDraftInput } from "./assemble";
import type { CompsSeasonPool } from "./career";
import type { CompsEnrichment } from "./fields";
import type { CompsEnrichmentNeeds } from "./enrichment";
import type { CompsPlayerOption } from "./player-index";
import type { CompsPoolRow } from "./knn";

/**
 * The comps reads behind their caches — thin I/O over `assemble.ts`, which
 * holds every rule worth testing. This concern owns no table: stats, players,
 * KTC, ADP and the NFL draft are each read through the module that owns them.
 *
 * **The pool is composed rather than assembled whole**, which is the shape the
 * rest of this module exists to serve:
 *
 *   season pool (stat lines + profiles, one entry per season, every board's)
 *     + KTC          ┐
 *     + KTC history  │ each its own entry per season, loaded only where the
 *     + ADP          │ board being run weighs a field that names it
 *     + NFL draft    ┘
 *
 * A default board weighs none of the four (every market field defaults to 0),
 * so the common request now reads a season's stats and its profiles and stops
 * — where it used to make six queries per season on a cold corpus, four of them
 * for numbers no field was going to read. Enabling one KTC weight adds one
 * dataset, not four, and does not disturb the entry the stats live in, so
 * moving a market weight never re-reads a season's stat lines.
 *
 * **Every read here passes `compsReadAdmission`**, because the fan-out is
 * seasons × datasets and neither factor is a constant — see that module for why
 * the pool is not itself the bound, and for the rule that a slot is never held
 * across another slot.
 *
 * A shared answer is frozen, because every caller inside the TTL holds the same
 * rows and an in-place sort by one would edit what every later reader gets —
 * the bug that appears on the second request and never on the first.
 */

const poolCache = new TtlPromiseCache<readonly CompsPoolRow[]>(COMPS_POOL_CACHE);

/**
 * One entry per (dataset, season). Typed as the union of what the four loaders
 * answer with, narrowed back at the point each is merged — the alternative is a
 * cache per dataset, which is four policies to keep in step for four maps with
 * one lifetime.
 */
type CompsEnrichmentValue = NonNullable<
  | CompsEnrichmentInputs["ktc"]
  | CompsEnrichmentInputs["ktcHistory"]
  | CompsEnrichmentInputs["adp"]
  | CompsEnrichmentInputs["draft"]
>;

const enrichmentCache = new TtlPromiseCache<CompsEnrichmentValue>(
  COMPS_ENRICHMENT_CACHE,
);

/**
 * The stored-seasons list rides its own small entry on the same policy: it is
 * one `DISTINCT` query, but it is asked on every comps request and changes
 * roughly once a year.
 */
const seasonsCache = new TtlPromiseCache<string[]>({
  name: `${COMPS_POOL_CACHE.name}-seasons`,
  ttlMs: COMPS_POOL_CACHE.ttlMs,
  max: 1,
});

const playerIndexCache = new TtlPromiseCache<readonly CompsPlayerOption[]>(
  COMPS_PLAYER_INDEX_CACHE,
);

/**
 * Draft picks for a handful of ids — what the *printed* rows need, which is a
 * different question from the `draft_capital` field's.
 *
 * A comps payload prints where each player went ("1.05", "Undrafted") beside
 * his name, for the subject and the ten or so results. That is metadata on a
 * dozen rows; `draft_capital` is a comparison dimension over the whole corpus,
 * and loading the second to print the first is what made every default board
 * pay for the draft crosswalk. So the field keeps the per-season enrichment and
 * the label takes this: one indexed read over the ids actually being sent.
 *
 * Bounded and TTL'd like everything else here, keyed on the ids verbatim — a
 * digest would trade a shorter key for a collision, and a collision here prints
 * one player's draft slot under another's name.
 */
const displayDraftCache = new TtlPromiseCache<CompsDraftInput>({
  name: `${COMPS_POOL_CACHE.name}-display-draft`,
  ttlMs: COMPS_POOL_CACHE.ttlMs,
  max: 256,
});

/**
 * Today on the NFL's clock — Eastern, the `TODAY_ET` side of the two-todays
 * rule, because it decides what market data a season read gets (a fact about
 * the data, not about any reader).
 */
function todayEasternIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * One anchor for every market read of a season, so "entering that season" means
 * the same date to KTC and to ADP. Not in any cache key: for a past season it
 * never moves, and for the current one it drifts by at most the TTL.
 */
const anchorFor = (season: string): string =>
  compsSeasonAnchor(season, todayEasternIso());

/** The season's stat lines and the profiles behind them — every board's floor. */
async function loadSeasonPool(season: string): Promise<readonly CompsPoolRow[]> {
  const statLines = await compsReadAdmission.run(() =>
    listSeasonStatLines({ season }),
  );
  const ids = [...new Set(statLines.map((line) => line.player_id))];
  const profiles = await compsReadAdmission.run(() => getPlayerProfiles(ids));

  return deepFreeze(assemblePoolRows({ statLines, profiles, season }));
}

/**
 * How long this season's entries are worth holding — its age against the
 * season the app is operating in, per {@link getCompsSeasonTtlMs}.
 *
 * `getActiveSeason` is asked rather than derived from the calendar because
 * *which season the app is in* is exactly what it answers, and it answers from
 * a process-local cache without waiting on Sleeper once warm (it serves a stale
 * value and refreshes behind the request, and never throws). A cold process
 * pays for it once, against reads that are about to run several statements
 * anyway.
 *
 * **It decides a cache lifetime and never an answer**, which is what keeps it
 * inside the rule that an explicitly requested season must not be resolved
 * here: a board for 2024 reads 2024's rows whatever this returns, and the worst
 * a wrong answer buys is an entry held for fifteen minutes instead of a day.
 */
async function seasonTtlMs(season: string, staggerKey: string): Promise<number> {
  return getCompsSeasonTtlMs(season, await getActiveSeason(), staggerKey);
}

/**
 * One season's pool, from the cache or one shared computation.
 *
 * The entry's lifetime is the *season's*, not the cache's: 2008's stat lines
 * have not moved in seventeen years and were being rebuilt four times an hour
 * along with the rest of the corpus. See {@link getCompsSeasonTtlMs}.
 */
export async function getCompsPool(
  season: string,
): Promise<readonly CompsPoolRow[]> {
  const key = compsPoolCacheKey(season);
  return poolCache.read(key, () => loadSeasonPool(season), {
    ttlMs: await seasonTtlMs(season, key),
  });
}

/** The ids a season's dataset reads are narrowed to — its pool's own. */
async function seasonPlayerIds(season: string): Promise<string[]> {
  return (await getCompsPool(season)).map((row) => row.player_id);
}

async function loadKtc(season: string): Promise<CompsEnrichmentValue> {
  const ktc = await compsReadAdmission.run(() =>
    getKtcValuesAsOf(anchorFor(season)),
  );
  return deepFreeze(ktc.values);
}

async function loadKtcHistory(season: string): Promise<CompsEnrichmentValue> {
  return deepFreeze(
    await compsReadAdmission.run(() => getKtcSfHistoryAsOf(anchorFor(season))),
  );
}

async function loadAdp(season: string): Promise<CompsEnrichmentValue> {
  // The ids are resolved *before* a slot is taken: this read depends on the
  // season's pool, and awaiting it from inside a slot is a queue waiting on
  // itself.
  const ids = await seasonPlayerIds(season);
  const filters: AdpFilters = {
    seasons: [season],
    start_after: null,
    start_before: anchorFor(season),
    league_ids: null,
    exclude_league_ids: null,
    scoring: null,
    best_ball: null,
    superflex: null,
    rounds_min: null,
    rounds_max: null,
    teams_min: null,
    teams_max: null,
    ...ADP_FILTER_DEFAULTS,
  };
  // Not admitted here: `getDraftAdpForPlayers` carries `adpComputeAdmission` of
  // its own, and a comps slot held across a wait for an ADP slot is two
  // limiters stacked on one read.
  const adp = await getDraftAdpForPlayers(filters, ids);
  // A `Map` cannot be frozen in any sense worth claiming (the per-player ADP
  // board's own exception), so this one is shared unfrozen — nothing downstream
  // writes to it, and `applyCompsEnrichment` only ever reads.
  return adp.values;
}

async function loadDraft(season: string): Promise<CompsEnrichmentValue> {
  // No anchor, unlike the market reads beside it: where a player was drafted is
  // the same fact in every season of his career, so it is exact for a
  // historical row rather than as-of.
  const ids = await seasonPlayerIds(season);
  return compsReadAdmission.run(() => getNflDraftPicks(ids));
}

const LOADERS: Record<
  CompsEnrichment,
  (season: string) => Promise<CompsEnrichmentValue>
> = {
  ktc: loadKtc,
  ktc_history: loadKtcHistory,
  adp: loadAdp,
  draft: loadDraft,
};

/**
 * One dataset for one season, from the cache or one shared computation.
 *
 * On the season's own clock like the pool it decorates, and for the same
 * reason: every market read here is taken *as of* the season's anchor
 * ({@link anchorFor}), so a past season's KTC snapshot and ADP average are as
 * fixed as its stat lines. The stagger is keyed on the dataset's own cache key,
 * so a season's four entries don't expire in one instant with its pool.
 */
async function getCompsEnrichment(
  enrichment: CompsEnrichment,
  season: string,
): Promise<CompsEnrichmentValue> {
  const key = compsEnrichmentCacheKey(enrichment, season);
  return enrichmentCache.read(key, () => LOADERS[enrichment](season), {
    ttlMs: await seasonTtlMs(season, key),
  });
}

/** The datasets `needs` asks for, loaded together and keyed for assembly. */
async function loadEnrichmentInputs(
  season: string,
  needs: CompsEnrichmentNeeds,
): Promise<CompsEnrichmentInputs> {
  const wanted = listCompsEnrichments(needs);
  // Started together and bounded by the admission each one takes inside itself,
  // rather than by a count here: what must not be unbounded is *database* work,
  // and four promises waiting on a limiter cost nothing.
  const loaded = await Promise.all(
    wanted.map((enrichment) => getCompsEnrichment(enrichment, season)),
  );

  const inputs: CompsEnrichmentInputs = {};
  for (const [i, enrichment] of wanted.entries()) {
    const value = loaded[i];
    // One narrowing per dataset, at the one seam where the union is opened —
    // each loader's own return type is what makes these assertions safe, and
    // `enrichment.test.ts` pins that a field's dataset reaches its value.
    if (enrichment === "ktc") inputs.ktc = value as CompsEnrichmentInputs["ktc"];
    else if (enrichment === "ktc_history") {
      inputs.ktcHistory = value as CompsEnrichmentInputs["ktcHistory"];
    } else if (enrichment === "adp") {
      inputs.adp = value as CompsEnrichmentInputs["adp"];
    } else inputs.draft = value as CompsEnrichmentInputs["draft"];
  }
  return inputs;
}

/** Every season with stats stored, newest first — what makes the pool deepen. */
export async function getCompsSeasons(): Promise<string[]> {
  return seasonsCache.read("seasons", () =>
    compsReadAdmission.run(listStoredSeasons),
  );
}

/**
 * Every stored season's pool, newest season first — the whole comp corpus, as
 * every board reads it before any market dataset is merged on.
 *
 * Assembled per season so a season already cached costs nothing when another
 * misses, and at most `COMPS_SEASON_BUILD_CONCURRENCY` builds at once. The walk
 * itself is `collectSeasonPools`, pure and tested; the bound on the *database*
 * work underneath it is `compsReadAdmission`, which is the one that holds when
 * two readers arrive on a cold process at once.
 */
export async function getCompsPools(): Promise<CompsSeasonPool[]> {
  return collectSeasonPools(await getCompsSeasons(), getCompsPool);
}

/**
 * The corpus with the datasets `needs` asks for written onto every row.
 *
 * **A board needing nothing gets the pools it was handed, unchanged** — the
 * same arrays, not copies of them. That is the common case (every market field
 * defaults to 0), and it is what keeps a default request free of this pass
 * entirely.
 *
 * **A board that does need one pays the merge on every request, and that is
 * deliberately not cached** — `withWindowValues`' own trade, for its own
 * reason. What a cache would hold is a fresh row and a fresh `values` object
 * for every player-season on file, per combination of datasets in use, to save
 * a `map` over rows already in memory; and it would hand `withCareerValues` a
 * different corpus per board to keep in one slot, so two readers on different
 * boards would take turns rebuilding the career pass. The *datasets* are cached,
 * which is where the queries are.
 *
 * Applied **after** the career pass rather than before, and the two commute:
 * career values are arithmetic over games and points, which no market dataset
 * touches. Taking it in this order is what keeps the memo's one slot pointed at
 * the corpus every board shares.
 */
export async function enrichCompsPools(
  pools: readonly CompsSeasonPool[],
  needs: CompsEnrichmentNeeds,
): Promise<readonly CompsSeasonPool[]> {
  if (!anyCompsEnrichment(needs)) return pools;

  // The same bounded walk the corpus is built with: a season's datasets are
  // four cached reads, and a cold corpus should not start every season's at
  // once. `compsReadAdmission` is what bounds the queries themselves.
  return collectSeasonPools(
    pools.map((pool) => pool.season),
    async (season, index) =>
      applyCompsEnrichment(
        pools[index].rows,
        await loadEnrichmentInputs(season, needs),
      ),
  );
}

/**
 * The picker's list: every player with stored stats at a supported position,
 * with the seasons each has stats in.
 *
 * Two cheap reads and a pure fold — deliberately *not* the pools, which is what
 * this used to be folded from. See `player-index.ts` for what that cost.
 */
export function getCompsPlayerIndex(): Promise<readonly CompsPlayerOption[]> {
  return playerIndexCache.read("index", async () => {
    const rows = await compsReadAdmission.run(listStoredPlayerSeasons);
    const ids = [...new Set(rows.map((row) => row.player_id))];
    const profiles = await compsReadAdmission.run(() => getPlayerProfiles(ids));
    return deepFreeze(foldCompsPlayerIndex(rows, profiles));
  });
}

/**
 * Draft picks for the rows a payload is about to print, keyed by player id.
 *
 * The label half of the draft data — see {@link displayDraftCache}. A caller
 * whose board already loaded the `draft` enrichment has these on the rows and
 * should not ask.
 */
export function getCompsDisplayDraft(
  playerIds: readonly string[],
): Promise<CompsDraftInput> {
  // Sorted as well as deduped, so two callers whose rows differ only in the
  // order they were ranked share one entry rather than reading twice.
  const ids = [...new Set(playerIds.filter(Boolean))].sort();
  if (ids.length === 0) return Promise.resolve(new Map());

  return displayDraftCache.read(JSON.stringify(ids), () =>
    compsReadAdmission.run(() => getNflDraftPicks(ids)),
  );
}

/**
 * Drop everything cached for one season — its pool and each of its datasets.
 *
 * **The signal is the stats sync's, not a timer's.** A finished season's
 * entries are held for a day (`getCompsSeasonTtlMs`), which is right for a
 * season whose numbers don't move and wrong for the moment they do: an archive
 * week re-probed with rows, a payload the completeness gate refused and the
 * next tick accepted, a backfill reaching a season for the first time. So the
 * writer announces (`onStatsSeasonWritten`) and this forgets, which makes a
 * correction visible on the next request instead of a TTL later.
 *
 * `forget` rather than `clear`: both halves of each entry go, so a computation
 * that started before the write still answers the callers waiting on it and
 * simply does not store what it read.
 *
 * The seasons list goes too, because a season's *first* stat line is what makes
 * it appear at all. The player index deliberately does not — it is one entry on
 * its own 45-minute clock holding names, where the cost of dropping it on every
 * archive tick is two reads for a picker list that is not wrong in the meantime.
 */
export function forgetCompsSeason(season: string): void {
  poolCache.forget(compsPoolCacheKey(season));
  for (const enrichment of COMPS_ENRICHMENTS) {
    enrichmentCache.forget(compsEnrichmentCacheKey(enrichment, season));
  }
  seasonsCache.forget("seasons");
}

// Registered at module load, and idempotent by function identity so dev's
// module reloading cannot stack listeners. In a deployment where the sync runs
// on a worker this process never hears it, which is what the season TTLs are
// the backstop for — see `./read-cache`.
onStatsSeasonWritten(forgetCompsSeason);
