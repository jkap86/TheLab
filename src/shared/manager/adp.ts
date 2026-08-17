import { pool } from "@/shared/db";
import { TtlPromiseCache, deepFreeze } from "@/shared/util";

import { adpComputeAdmission } from "./adp-admission";
import type { AdpFilters } from "./adp-filters";
import { draftSelection, matchedDraftsSql } from "./adp-selection";
import {
  ADP_BOARD_CACHE,
  ADP_PLAYER_BOARD_CACHE,
  adpBoardCacheKey,
} from "./read-cache";

/**
 * The board's selection SQL is `./adp-selection`, and it is re-exported from
 * here rather than moved out from under its callers.
 *
 * `LEAGUE_TYPE_SQL`, `DYNASTY_LEAGUE_TYPE` and `BEST_BALL_SQL` are read by
 * `./queries` and by the two roster reads that have to solve a best-ball league,
 * and every one of those call sites names *this* module — the place the board
 * lives. Splitting the file for testability is not a reason to make them all
 * import from a new path, and a barrel-shaped re-export keeps the seam invisible
 * to everything but the tests it was made for.
 */
export {
  BEST_BALL_SQL,
  DYNASTY_BOARD_SQL,
  DYNASTY_LEAGUE_TYPE,
  LEAGUE_TYPE_SQL,
  draftSelection,
} from "./adp-selection";
export type { DraftTypeScope } from "./adp-selection";

/**
 * Average draft position over the drafts this app has crawled.
 *
 * Sleeper has no ADP endpoint — this is computed from `draft_picks`, so it
 * describes the leagues in our database rather than the market at large. The
 * filters exist because that population is a mix: pooling a 12-team superflex
 * dynasty startup with a 10-team redraft would average two different games.
 *
 * The league-type axis is not a filter, though — every read splits the matched
 * drafts into the redraft and dynasty boards (see `ADP_BOARDS`) and averages
 * each, so one fetch answers both markets and the caller chooses which to show.
 */

/** One board's average for a player: how the matched drafts on it took him. */
export type AdpBoardStats = {
  /** How many of this board's drafts took the player, of its draft count. */
  picks: number;
  adp: number;
  min_pick: number;
  max_pick: number;
  /** Sample standard deviation of `pick_no`; 0 for a single pick. */
  stdev: number;
};

/**
 * One player's ADP on each board, over the matched drafts. Player ids are
 * unresolved. A board is null when it took him in fewer than `min_picks`
 * drafts — too few to average — which is a different answer from 0.
 */
export type AdpRow = {
  player_id: string;
  redraft: AdpBoardStats | null;
  dynasty: AdpBoardStats | null;
};

export type AdpResult = {
  /** Drafts that matched the filters, whether or not they contain picks. */
  draft_count: number;
  /** How `draft_count` splits into the two boards; the halves sum to it. */
  redraft_drafts: number;
  dynasty_drafts: number;
  /** Players matching the filters before `limit`/`offset` — for paging. */
  player_count: number;
  rows: AdpRow[];
};

type DraftCounts = {
  draft_count: number;
  redraft_drafts: number;
  dynasty_drafts: number;
};

async function countMatchedDrafts(
  matchedDrafts: string,
  params: unknown[],
): Promise<DraftCounts> {
  const { rows } = await pool.query<DraftCounts>(
    `SELECT count(*)::int AS draft_count,
            (count(*) FILTER (WHERE NOT md.dynasty))::int AS redraft_drafts,
            (count(*) FILTER (WHERE md.dynasty))::int AS dynasty_drafts
       FROM (${matchedDrafts}) md`,
    params,
  );
  return rows[0] ?? { draft_count: 0, redraft_drafts: 0, dynasty_drafts: 0 };
}

/**
 * One board's five aggregate columns, prefixed with the board's name. The
 * board names come from our own closed vocabulary, not from input; `stdev`'s
 * COALESCE keeps a single-pick board at 0 rather than null, matching the
 * one-board query this replaced.
 */
function boardAggregates(board: "redraft" | "dynasty"): string {
  const on = board === "dynasty" ? "md.dynasty" : "NOT md.dynasty";
  return `
              (count(*) FILTER (WHERE ${on}))::int AS ${board}_picks,
              round((avg(dp.pick_no) FILTER (WHERE ${on}))::numeric, 2)::float8 AS ${board}_adp,
              min(dp.pick_no) FILTER (WHERE ${on}) AS ${board}_min_pick,
              max(dp.pick_no) FILTER (WHERE ${on}) AS ${board}_max_pick,
              round(COALESCE(stddev_samp(dp.pick_no) FILTER (WHERE ${on}), 0)::numeric, 2)::float8 AS ${board}_stdev`;
}

type BoardColumns = {
  [B in "redraft" | "dynasty" as `${B}_picks`]: number;
} & {
  [B in "redraft" | "dynasty" as `${B}_adp`]: number | null;
} & {
  [B in "redraft" | "dynasty" as `${B}_min_pick`]: number | null;
} & {
  [B in "redraft" | "dynasty" as `${B}_max_pick`]: number | null;
} & {
  [B in "redraft" | "dynasty" as `${B}_stdev`]: number | null;
};

/** One board's stats off a row's prefixed columns; below `min_picks` is null. */
function boardStats(
  row: BoardColumns,
  board: "redraft" | "dynasty",
  minPicks: number,
): AdpBoardStats | null {
  const picks = row[`${board}_picks`];
  const adp = row[`${board}_adp`];
  if (picks < minPicks || adp === null) return null;
  return {
    picks,
    adp,
    min_pick: row[`${board}_min_pick`]!,
    max_pick: row[`${board}_max_pick`]!,
    stdev: row[`${board}_stdev`]!,
  };
}

/**
 * Every distinct board a process has read lately, and the reads still running.
 *
 * **The aggregate underneath is the most expensive statement in the app** —
 * ~500-600ms over 1.5M picks with the plan fully tuned (see the note on
 * `matchedDraftsSql` for what "tuned" cost), plus a second statement to count
 * the matched drafts. The browser's own cache does nothing about that across
 * readers, tabs, processes or a reload, and the population it describes is
 * identical for everyone who has not narrowed it: the default board is one
 * answer that every visitor to the trades page and the manager tabs was asking
 * Postgres for separately.
 *
 * The in-flight half is the part that matters under load. Ten readers arriving
 * on a cold key is ten copies of that aggregate, each holding a pool connection
 * for its whole duration — one board by itself over `databaseBudget().fanout`,
 * which is the shape of the exhaustion the budget module exists to bound. With
 * the promise shared it is one query and one connection however many are
 * waiting on it.
 *
 * See {@link ADP_BOARD_CACHE} for the TTL and the bound, and
 * {@link adpBoardCacheKey} for why the key names every filter.
 */
const boardResultCache = new TtlPromiseCache<AdpResult>(ADP_BOARD_CACHE);

/**
 * ADP for every player taken in the drafts matching `filters`, averaged per
 * board, best average first. The `min_picks` gate applies per board — a player
 * with one redraft pick and five dynasty ones has a dynasty average and no
 * redraft one — and a player appears when *either* board can average him.
 *
 * The ordering is the best average on any board that cleared the gate, so the
 * page cut keeps whoever is early on either market; the caller re-ranks for
 * whichever board(s) it displays. `draft_count` and its split are reported
 * separately so an empty page still tells the caller whether the filters
 * matched no drafts or merely no players.
 *
 * **Cached and coalesced per process** — see {@link boardResultCache}. The
 * answer is deep-frozen because it is now *shared*: every caller inside the TTL
 * holds the same object, so an in-place sort or annotation would edit what every
 * later reader gets. The SQL below is untouched by any of that; a miss runs
 * exactly the two statements it always ran.
 *
 * **And a miss is admitted rather than simply started** — see
 * {@link adpComputeAdmission} for why the cache alone is not a bound. The
 * limiter wraps the *loader*, which is the only placement that keeps all three
 * of the properties this read needs: a hit never reaches it (the cache answers
 * before `compute` is called at all), same-key callers coalesce onto the one
 * promise that is queueing, and only the distinct cold boards contend.
 */
export async function getDraftAdp(filters: AdpFilters): Promise<AdpResult> {
  return boardResultCache.read(adpBoardCacheKey(filters), () =>
    adpComputeAdmission.run(() => computeDraftAdp(filters)),
  );
}

async function computeDraftAdp(filters: AdpFilters): Promise<AdpResult> {
  const { where, params } = draftSelection(filters);
  const matchedDrafts = matchedDraftsSql(where);

  const counts = await countMatchedDrafts(matchedDrafts, params);
  // Cached like any other answer: a population that matches no draft is the
  // most repeatable answer there is, and re-deriving it is the same query.
  if (counts.draft_count === 0) {
    return deepFreeze({ ...counts, player_count: 0, rows: [] });
  }

  const rowParams = [...params];
  const bind = (value: unknown) => `$${rowParams.push(value)}`;
  const minPicks = bind(filters.min_picks);
  const limit = bind(filters.limit);
  const offset = bind(filters.offset);

  const { rows } = await pool.query<
    BoardColumns & { player_id: string; player_count: number }
  >(
    `WITH matched_drafts AS MATERIALIZED (${matchedDrafts}),
     adp AS (
       SELECT dp.player_id,
              ${boardAggregates("redraft")},
              ${boardAggregates("dynasty")}
         FROM draft_picks dp
         JOIN matched_drafts md ON md.draft_id = dp.draft_id
        WHERE dp.player_id IS NOT NULL AND dp.player_id <> ''
        GROUP BY dp.player_id
       HAVING count(*) FILTER (WHERE NOT md.dynasty) >= ${minPicks}
           OR count(*) FILTER (WHERE md.dynasty) >= ${minPicks}
     )
     SELECT a.*, (count(*) OVER ())::int AS player_count
       FROM adp a
      ORDER BY LEAST(
                 CASE WHEN a.redraft_picks >= ${minPicks} THEN a.redraft_adp END,
                 CASE WHEN a.dynasty_picks >= ${minPicks} THEN a.dynasty_adp END
               ),
               (a.redraft_picks + a.dynasty_picks) DESC,
               a.player_id
      LIMIT ${limit} OFFSET ${offset}`,
    rowParams,
  );

  return deepFreeze({
    ...counts,
    player_count: rows[0]?.player_count ?? 0,
    rows: rows.map((r) => ({
      player_id: r.player_id,
      redraft: boardStats(r, "redraft", filters.min_picks),
      dynasty: boardStats(r, "dynasty", filters.min_picks),
    })),
  });
}

/**
 * Drafts crawled in one calendar month, ET, for one season. `month` is
 * `YYYY-MM`; `season` is the season those drafts were *for*, which is a
 * different thing and frequently a different year — a startup run in January
 * 2026 is a 2026 draft, and so is a rookie draft run that May.
 *
 * The split is what lets the drawer draw the strip for the season being read
 * rather than for the calendar, which is the only way the strip can be the
 * shape of a board that is itself cut to one season.
 */
export type DraftDensityMonth = { season: string; month: string; drafts: number };

/**
 * How many drafts this app has crawled in each month — the shape behind the
 * board's date range, not a number to reconcile with it.
 *
 * Deliberately narrowed by *nothing* the ADP drawer can change. The strip it
 * draws is the thing a reader drags a window across, so it has to hold still
 * while they do it: narrowing it by the live filters would move the bars under
 * the hand choosing them, and a histogram that reshapes as you scrub is worse
 * than no histogram. The two conditions here are the ones no filter can lift —
 * a draft with no `start_time` can't be placed in time at all (the same reason a
 * date bound drops it), and an unfinished draft is never counted into an average
 * whatever else is selected.
 *
 * Months with no drafts are absent rather than zero; the client fills the gaps,
 * since it is the one that knows how far the axis runs.
 *
 * It *is* split by season, though, and that is not the same kind of narrowing.
 * The season is the board's population, not one of its filters: a strip drawn
 * across seasons would be the shape of a market the board never averages. So
 * the season rides on every row and the client slices to the one it is showing
 * — which also gives it the list of seasons there are drafts for, without a
 * second query.
 */
export async function getDraftDensity(): Promise<DraftDensityMonth[]> {
  const { rows } = await pool.query<DraftDensityMonth>(
    `SELECT d.season,
            to_char(
              to_timestamp(d.start_time::float8 / 1000) AT TIME ZONE 'America/New_York',
              'YYYY-MM') AS month,
            count(*)::int AS drafts
       FROM drafts d
      WHERE d.start_time IS NOT NULL
        AND d.start_time > 0
        AND d.status = 'complete'
      GROUP BY 1, 2
      ORDER BY 1, 2`,
  );
  return rows;
}

/** One player's average draft position on a board, with the sample behind it. */
export type PlayerAdp = { adp: number; picks: number };

/**
 * A player's average on each board; a board that took him in fewer than
 * `min_picks` drafts is null — no average worth trusting.
 */
export type PlayerBoardAdp = {
  redraft: PlayerAdp | null;
  dynasty: PlayerAdp | null;
};

export type PlayerBoardAdpResult = DraftCounts & {
  values: Map<string, PlayerBoardAdp>;
};

/**
 * One priced board per process, and the reads still running.
 *
 * The TTL and the bound are {@link ADP_PLAYER_BOARD_CACHE}, beside the paged
 * board's own policy rather than here — they are two cuts of one population,
 * both stand behind a browser stale time, and a pair of numbers only one of the
 * two could be tested against is how they came to disagree.
 *
 * It is a {@link TtlPromiseCache} rather than a plain `BoundedCache` for the one
 * thing the plain one deliberately does not do: **a cold key with several
 * readers on it computes once.** Two readers of one manager, or one reader whose
 * page prices six boards at once, no longer race each other through the same
 * aggregate while each holds a pool connection. That is the same argument the
 * board cache above rests on, and leaving the two halves of one read on
 * different terms is the kind of asymmetry that reads as an oversight.
 *
 * The answer is **not** frozen, unlike the paged board's: it carries a `Map`,
 * and `Object.freeze` on a `Map` is a guarantee that cannot be kept (`set` goes
 * on working), so a freeze here would be reassurance rather than a bound. The
 * three callers read it and nothing else.
 */
const boardCache = new TtlPromiseCache<PlayerBoardAdpResult>(
  ADP_PLAYER_BOARD_CACHE,
);

/**
 * ADP for a specific set of players over the drafts matching `filters`, keyed by
 * id and split per board — what pricing a roster needs, where {@link getDraftAdp}
 * answers a paged board. One fetch carries both boards, so a caller pricing
 * leagues of both types shares a single query and reads each league's side.
 *
 * Restricting the aggregation to the rostered ids is what keeps this cheap enough
 * to run once per league card's worth of rosters: it shares `getDraftAdp`'s
 * `matched_drafts` and its per-board `min_picks` gate (a player taken in a single
 * draft has no average worth trusting), but never resolves names or pages,
 * because the caller already holds both. The draft counts ride along so a number
 * can say how many crawled drafts stand behind the board it was read from.
 *
 * **The answer is cached in-process, and the reason is the curve rather than the
 * query.** Steepness is applied by the *caller*, per league, after this returns —
 * so dragging the ADP drawer's slider re-asks for a board that is byte-identical
 * to the one just read, and every notch was a second of aggregate over 1.9M
 * picks. The same holds for a reload, a second tab, and the 15-minute boundary
 * where the browser's own entry goes stale: none of those change the population,
 * and the population is all this reads. That last case is the one the TTL had to
 * be lengthened to actually cover — at ten minutes this entry expired *before*
 * the browser's, so the revalidation it exists to absorb was the one request
 * guaranteed to miss it. See {@link ADP_PLAYER_BOARD_CACHE}.
 *
 * **The key is the statement, not a signature of the filters.** {@link
 * boardSignature} exists for grouping leagues onto shared fetches and names the
 * axes a *board* varies on; a cache key has to name everything the *answer*
 * varies on, which is strictly more (`min_picks` gates which players come back,
 * `draft_types` and `draft_statuses` decide which drafts are matched, and none
 * of the three is in that signature). Keying on the generated `where`, its bound
 * params, the gate and the ids is exact by construction — the query is a pure
 * function of precisely those. The ids go in verbatim rather than digested, for
 * the reason `boardSignature` spells its league scope out: a hash trades a
 * silent collision for a shorter key, and a collision here is one manager's
 * roster priced off another's board with nothing to say so.
 */
export async function getDraftAdpForPlayers(
  filters: AdpFilters,
  playerIds: readonly string[],
): Promise<PlayerBoardAdpResult> {
  // Sorted as well as deduped, so two callers whose rosters differ only in the
  // order they enumerated them share one entry rather than computing twice.
  const ids = [...new Set(playerIds.filter((id) => id && id !== "0"))].sort();
  const { where, params } = draftSelection(filters);

  const cacheKey = JSON.stringify([where, params, filters.min_picks, ids]);
  // Admitted on the same terms as the paged board, and it is the caller that
  // makes it matter here: one manager's page prices up to six distinct boards,
  // so this is the read most able to produce several cold keys at once. See
  // {@link adpComputeAdmission} for why the limiter wraps the loader rather than
  // this function — a cached board must not queue behind a cold one.
  return boardCache.read(cacheKey, () =>
    adpComputeAdmission.run(() =>
      computeDraftAdpForPlayers(filters, ids, where, params),
    ),
  );
}

async function computeDraftAdpForPlayers(
  filters: AdpFilters,
  ids: readonly string[],
  where: string,
  params: readonly unknown[],
): Promise<PlayerBoardAdpResult> {
  const matchedDrafts = matchedDraftsSql(where);

  const counts = await countMatchedDrafts(matchedDrafts, [...params]);
  if (counts.draft_count === 0 || ids.length === 0) {
    // Cached like any other answer: a population that matches no draft is the
    // most repeatable answer there is, and re-deriving it is the same two
    // queries as deriving a real one.
    return { ...counts, values: new Map<string, PlayerBoardAdp>() };
  }

  const rowParams = [...params];
  const bind = (value: unknown) => `$${rowParams.push(value)}`;
  const idsBind = bind(ids);
  const minPicks = bind(filters.min_picks);

  const { rows } = await pool.query<{
    player_id: string;
    redraft_adp: number | null;
    redraft_picks: number;
    dynasty_adp: number | null;
    dynasty_picks: number;
  }>(
    `WITH matched_drafts AS MATERIALIZED (${matchedDrafts})
     SELECT dp.player_id,
            round((avg(dp.pick_no) FILTER (WHERE NOT md.dynasty))::numeric, 2)::float8 AS redraft_adp,
            (count(*) FILTER (WHERE NOT md.dynasty))::int AS redraft_picks,
            round((avg(dp.pick_no) FILTER (WHERE md.dynasty))::numeric, 2)::float8 AS dynasty_adp,
            (count(*) FILTER (WHERE md.dynasty))::int AS dynasty_picks
       FROM draft_picks dp
       JOIN matched_drafts md ON md.draft_id = dp.draft_id
      WHERE dp.player_id = ANY(${idsBind}::varchar[])
      GROUP BY dp.player_id
     HAVING count(*) FILTER (WHERE NOT md.dynasty) >= ${minPicks}
         OR count(*) FILTER (WHERE md.dynasty) >= ${minPicks}`,
    rowParams,
  );

  const values = new Map<string, PlayerBoardAdp>();
  for (const r of rows) {
    values.set(r.player_id, {
      redraft:
        r.redraft_picks >= filters.min_picks && r.redraft_adp !== null
          ? { adp: r.redraft_adp, picks: r.redraft_picks }
          : null,
      dynasty:
        r.dynasty_picks >= filters.min_picks && r.dynasty_adp !== null
          ? { adp: r.dynasty_adp, picks: r.dynasty_picks }
          : null,
    });
  }
  return { ...counts, values };
}
