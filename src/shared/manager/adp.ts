import { pool } from "@/shared/db";
import { QB_ELIGIBLE_STARTING_SLOTS } from "@/shared/ktc";

import type { AdpFilters } from "./adp-filters";

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

/**
 * Sleeper's settings blobs are loosely typed and its defaults are omitted
 * entirely, so every numeric read is regex-guarded before the cast: a league
 * with `"type": "abc"` must not fail the whole query. Missing reads fall back
 * the same way the client-side league filters do (absent type = redraft).
 */
// Each fragment is parenthesised because callers append their own comparison.
// Written against a league table aliased `l`. Exported to `./queries`'
// `getLeagueTypes` so the code grouping leagues into ADP boards and the filter
// narrowing `/api/adp` can't classify the same league differently.
export const LEAGUE_TYPE_SQL = `
  (CASE WHEN l.settings->>'type' ~ '^[0-9]+$'
        THEN (l.settings->>'type')::int ELSE 0 END)`;

/**
 * Sleeper's `settings.type` for a dynasty league (0 redraft, 1 keeper, 3 its
 * native guillotine). Exported because `getLeagueDetail` asks the same question
 * of a league it has already read, and the fragment below is written from this
 * constant so the SQL and the TypeScript reading cannot drift apart.
 */
export const DYNASTY_LEAGUE_TYPE = 2;

/**
 * Which of the two ADP boards a league's drafts count into: dynasty is
 * Sleeper's `settings.type` 2, and everything else — redraft and keeper — is
 * the redraft board. See `ADP_BOARDS` in `./adp-filters` for why keeper folds
 * into redraft rather than into a bucket of its own.
 */
const DYNASTY_BOARD_SQL = `(${LEAGUE_TYPE_SQL} = ${DYNASTY_LEAGUE_TYPE})`;

const BEST_BALL_SQL = `
  (CASE WHEN l.settings->>'best_ball' ~ '^[0-9]+$'
        THEN (l.settings->>'best_ball')::int ELSE 0 END = 1)`;

const ROUNDS_SQL = `
  (CASE WHEN d.settings->>'rounds' ~ '^[0-9]+$'
        THEN (d.settings->>'rounds')::int END)`;

/**
 * Superflex means the lineup starts more than one quarterback — the same
 * question `isSuperflexLineup` answers in TypeScript, asked of the stored
 * blob. Counting QB-eligible slots rather than testing for `SUPER_FLEX` by
 * name keeps the two classifiers agreeing: a two-QB league with no literal
 * `SUPER_FLEX` slot is priced against the superflex board by `adpBoardFor`,
 * so its draft has to be counted into that same population here, or it is
 * averaged with (and pollutes) the 1QB drafts. The slot names interpolated
 * below come from our own closed vocabulary in `projections/slots`, not from
 * user input.
 */
const QB_SLOT_LIST = QB_ELIGIBLE_STARTING_SLOTS.map((s) => `'${s}'`).join(", ");
const SUPERFLEX_SQL = `
  (CASE WHEN jsonb_typeof(l.roster_positions) = 'array'
        THEN (SELECT count(*)
                FROM jsonb_array_elements_text(l.roster_positions) AS s(slot)
               WHERE s.slot IN (${QB_SLOT_LIST})) > 1
        ELSE false END)`;

/**
 * Scoring format from the per-reception value: Sleeper stores the rule, not the
 * label. Anything unparseable (or absent, which is standard scoring) reads std.
 */
const SCORING_SQL = `
  (CASE
     WHEN l.scoring_settings->>'rec' !~ '^-?[0-9]+(\\.[0-9]+)?$' THEN 'std'
     WHEN (l.scoring_settings->>'rec')::numeric >= 1 THEN 'ppr'
     WHEN (l.scoring_settings->>'rec')::numeric >= 0.5 THEN 'half_ppr'
     ELSE 'std'
   END)`;

/**
 * A bare `YYYY-MM-DD` against `drafts.start_time`, which Sleeper gives as epoch
 * milliseconds. The date is read in ET — the zone the rest of this app dates
 * things in (`TODAY_ET` in the projections reads) — rather than in whatever zone
 * the Node process happens to run in, which is why the conversion is here and
 * not in the parser. `offsetDays` shifts the boundary, so an inclusive end bound
 * is midnight of the following day.
 */
const startTimeMs = (placeholder: string, offsetDays = 0) =>
  `(extract(epoch from ((${placeholder}::date + ${offsetDays})::timestamp
     AT TIME ZONE 'America/New_York')) * 1000)`;

/**
 * The `WHERE` for the draft/league side of the query, plus the parameters it
 * binds. Returned together because the fragment's `$n` placeholders are
 * positions in this exact array — the caller appends its own params after.
 */
function draftSelection(filters: AdpFilters): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const bind = (value: unknown) => `$${params.push(value)}`;
  const clauses: string[] = [];

  if (filters.seasons) clauses.push(`d.season = ANY(${bind(filters.seasons)}::varchar[])`);

  // A date bound drops drafts Sleeper never gave a `start_time` — they can't be
  // placed in time at all, so there is no honest side of the boundary for them.
  // An unbounded board still counts them, which is why "all time" can match more
  // drafts than a range covering every date on file.
  if (filters.start_after !== null) {
    clauses.push(`d.start_time >= ${startTimeMs(bind(filters.start_after))}`);
  }
  if (filters.start_before !== null) {
    // Exclusive against the next midnight, so the named end day is included whole.
    clauses.push(`d.start_time < ${startTimeMs(bind(filters.start_before), 1)}`);
  }
  if (filters.draft_types.length > 0) {
    clauses.push(`d.type = ANY(${bind(filters.draft_types)}::varchar[])`);
  }
  if (filters.draft_statuses.length > 0) {
    clauses.push(`d.status = ANY(${bind(filters.draft_statuses)}::varchar[])`);
  }
  if (filters.rounds_min !== null) clauses.push(`${ROUNDS_SQL} >= ${bind(filters.rounds_min)}`);
  if (filters.rounds_max !== null) clauses.push(`${ROUNDS_SQL} <= ${bind(filters.rounds_max)}`);

  if (filters.league_ids) {
    clauses.push(`l.league_id = ANY(${bind(filters.league_ids)}::varchar[])`);
  }
  if (filters.scoring) clauses.push(`${SCORING_SQL} = ANY(${bind(filters.scoring)}::varchar[])`);
  if (filters.best_ball !== null) clauses.push(`${BEST_BALL_SQL} = ${bind(filters.best_ball)}`);
  if (filters.superflex !== null) clauses.push(`${SUPERFLEX_SQL} = ${bind(filters.superflex)}`);
  if (filters.teams_min !== null) clauses.push(`l.total_rosters >= ${bind(filters.teams_min)}`);
  if (filters.teams_max !== null) clauses.push(`l.total_rosters <= ${bind(filters.teams_max)}`);

  return { where: clauses.length > 0 ? clauses.join("\n       AND ") : "true", params };
}

/**
 * The draft/league join every read matches over, carrying which board each
 * draft counts into. The `$n` placeholders in `where` are positions in the
 * params array `draftSelection` returned alongside it.
 *
 * **Both aggregate readers spell it `AS MATERIALIZED`, and that keyword is the
 * single largest thing separating this board from a statement timeout.**
 * Postgres 12+ inlines a CTE referenced once, which is normally what you want
 * and is exactly wrong here: `dynasty` is a JSONB extraction, a regex match and
 * a cast, and inlining pushes that expression into every `FILTER` of every
 * aggregate above it — ten of them on the board read. So a fact about a *draft*
 * (6,963 of them) was being recomputed once per pick per aggregate: ~11M jsonb
 * lookups and ~11M regex matches, none of which appear in the query as written.
 * Materialized, it is computed 6,963 times and each `FILTER` is a boolean test.
 * Measured over 1.5M picks in 8,000 leagues, the board read went 2,872ms →
 * 590ms at the query and ~2.2s → ~0.5s end to end; pricing one roster's board
 * went from 573/1,094/13,978ms across three runs to a flat ~400ms.
 *
 * The rule generalises past this query: **a CTE column derived from JSONB, and
 * read by an aggregate `FILTER` or a `CASE`, has to be materialized.** The cost
 * is invisible in the SQL and shows up only in a plan, where the expression is
 * written out once per aggregate.
 *
 * `countMatchedDrafts` needs no such thing — it reads the join as a plain
 * subquery and evaluates the expression once per draft either way.
 */
const matchedDraftsSql = (where: string) => `
    SELECT d.draft_id, ${DYNASTY_BOARD_SQL} AS dynasty
      FROM drafts d
      JOIN leagues l ON l.league_id = d.league_id
     WHERE ${where}`;

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
 */
export async function getDraftAdp(filters: AdpFilters): Promise<AdpResult> {
  const { where, params } = draftSelection(filters);
  const matchedDrafts = matchedDraftsSql(where);

  const counts = await countMatchedDrafts(matchedDrafts, params);
  if (counts.draft_count === 0) return { ...counts, player_count: 0, rows: [] };

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

  return {
    ...counts,
    player_count: rows[0]?.player_count ?? 0,
    rows: rows.map((r) => ({
      player_id: r.player_id,
      redraft: boardStats(r, "redraft", filters.min_picks),
      dynasty: boardStats(r, "dynasty", filters.min_picks),
    })),
  };
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
 */
export async function getDraftAdpForPlayers(
  filters: AdpFilters,
  playerIds: readonly string[],
): Promise<DraftCounts & { values: Map<string, PlayerBoardAdp> }> {
  const ids = [...new Set(playerIds.filter((id) => id && id !== "0"))];
  const { where, params } = draftSelection(filters);
  const matchedDrafts = matchedDraftsSql(where);

  const counts = await countMatchedDrafts(matchedDrafts, params);
  if (counts.draft_count === 0 || ids.length === 0) {
    return { ...counts, values: new Map() };
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
