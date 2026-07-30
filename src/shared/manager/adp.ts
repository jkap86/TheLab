import { pool } from "@/shared/db";

import { LEAGUE_TYPE_CODES } from "./adp-filters";
import type { AdpFilters } from "./adp-filters";

/**
 * Average draft position over the drafts this app has crawled.
 *
 * Sleeper has no ADP endpoint — this is computed from `draft_picks`, so it
 * describes the leagues in our database rather than the market at large. The
 * filters exist because that population is a mix: pooling a 12-team superflex
 * dynasty startup with a 10-team redraft would average two different games.
 */

/** One player's ADP across the matched drafts. Player ids are unresolved. */
export type AdpRow = {
  player_id: string;
  /** How many of the matched drafts took this player. */
  picks: number;
  adp: number;
  min_pick: number;
  max_pick: number;
  /** Sample standard deviation of `pick_no`; 0 for a single pick. */
  stdev: number;
};

export type AdpResult = {
  /** Drafts that matched the filters, whether or not they contain picks. */
  draft_count: number;
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
const LEAGUE_TYPE_SQL = `
  (CASE WHEN l.settings->>'type' ~ '^[0-9]+$'
        THEN (l.settings->>'type')::int ELSE 0 END)`;

const BEST_BALL_SQL = `
  (CASE WHEN l.settings->>'best_ball' ~ '^[0-9]+$'
        THEN (l.settings->>'best_ball')::int ELSE 0 END = 1)`;

const ROUNDS_SQL = `
  (CASE WHEN d.settings->>'rounds' ~ '^[0-9]+$'
        THEN (d.settings->>'rounds')::int END)`;

/** Superflex is a roster slot, not a setting — a league either lists one or not. */
const SUPERFLEX_SQL = `
  (COALESCE(l.roster_positions @> '["SUPER_FLEX"]'::jsonb, false))`;

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
 * The `WHERE` for the draft/league side of the query, plus the parameters it
 * binds. Returned together because the fragment's `$n` placeholders are
 * positions in this exact array — the caller appends its own params after.
 */
function draftSelection(filters: AdpFilters): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const bind = (value: unknown) => `$${params.push(value)}`;
  const clauses: string[] = [];

  if (filters.seasons) clauses.push(`d.season = ANY(${bind(filters.seasons)}::varchar[])`);
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
  if (filters.league_types) {
    const codes = filters.league_types.map((t) => LEAGUE_TYPE_CODES[t]);
    clauses.push(`${LEAGUE_TYPE_SQL} = ANY(${bind(codes)}::int[])`);
  }
  if (filters.scoring) clauses.push(`${SCORING_SQL} = ANY(${bind(filters.scoring)}::varchar[])`);
  if (filters.best_ball !== null) clauses.push(`${BEST_BALL_SQL} = ${bind(filters.best_ball)}`);
  if (filters.superflex !== null) clauses.push(`${SUPERFLEX_SQL} = ${bind(filters.superflex)}`);
  if (filters.teams_min !== null) clauses.push(`l.total_rosters >= ${bind(filters.teams_min)}`);
  if (filters.teams_max !== null) clauses.push(`l.total_rosters <= ${bind(filters.teams_max)}`);

  return { where: clauses.length > 0 ? clauses.join("\n       AND ") : "true", params };
}

type Row = AdpRow & { player_count: number };

/**
 * ADP for every player taken in the drafts matching `filters`, best average
 * first. `draft_count` is reported separately so an empty page still tells the
 * caller whether the filters matched no drafts or merely no players.
 */
export async function getDraftAdp(filters: AdpFilters): Promise<AdpResult> {
  const { where, params } = draftSelection(filters);

  const matchedDrafts = `
    SELECT d.draft_id
      FROM drafts d
      JOIN leagues l ON l.league_id = d.league_id
     WHERE ${where}`;

  const counted = await pool.query<{ draft_count: number }>(
    `SELECT count(*)::int AS draft_count FROM (${matchedDrafts}) md`,
    params,
  );
  const draft_count = counted.rows[0]?.draft_count ?? 0;
  if (draft_count === 0) return { draft_count: 0, player_count: 0, rows: [] };

  const rowParams = [...params];
  const bind = (value: unknown) => `$${rowParams.push(value)}`;
  const minPicks = bind(filters.min_picks);
  const limit = bind(filters.limit);
  const offset = bind(filters.offset);

  const { rows } = await pool.query<Row>(
    `WITH matched_drafts AS (${matchedDrafts}),
     adp AS (
       SELECT dp.player_id,
              count(*)::int AS picks,
              round(avg(dp.pick_no)::numeric, 2)::float8 AS adp,
              min(dp.pick_no) AS min_pick,
              max(dp.pick_no) AS max_pick,
              round(COALESCE(stddev_samp(dp.pick_no), 0)::numeric, 2)::float8 AS stdev
         FROM draft_picks dp
         JOIN matched_drafts md ON md.draft_id = dp.draft_id
        WHERE dp.player_id IS NOT NULL AND dp.player_id <> ''
        GROUP BY dp.player_id
       HAVING count(*) >= ${minPicks}
     )
     SELECT a.*, (count(*) OVER ())::int AS player_count
       FROM adp a
      ORDER BY a.adp, a.picks DESC, a.player_id
      LIMIT ${limit} OFFSET ${offset}`,
    rowParams,
  );

  return {
    draft_count,
    player_count: rows[0]?.player_count ?? 0,
    rows: rows.map((r) => ({
      player_id: r.player_id,
      picks: r.picks,
      adp: r.adp,
      min_pick: r.min_pick,
      max_pick: r.max_pick,
      stdev: r.stdev,
    })),
  };
}

/** One player's average draft position on a board, with the sample behind it. */
export type PlayerAdp = { adp: number; picks: number };

/**
 * ADP for a specific set of players over the drafts matching `filters`, keyed by
 * id — what pricing a roster needs, where {@link getDraftAdp} answers a paged
 * board.
 *
 * Restricting the aggregation to the rostered ids is what keeps this cheap enough
 * to run once per league card's worth of rosters: it shares `getDraftAdp`'s
 * `matched_drafts` and its `min_picks` gate (a player taken in a single draft has
 * no average worth trusting), but never resolves names or pages, because the
 * caller already holds both. `draft_count` rides along so the number can say how
 * many crawled drafts stand behind it.
 */
export async function getDraftAdpForPlayers(
  filters: AdpFilters,
  playerIds: readonly string[],
): Promise<{ draft_count: number; values: Map<string, PlayerAdp> }> {
  const ids = [...new Set(playerIds.filter((id) => id && id !== "0"))];
  const { where, params } = draftSelection(filters);

  const matchedDrafts = `
    SELECT d.draft_id
      FROM drafts d
      JOIN leagues l ON l.league_id = d.league_id
     WHERE ${where}`;

  const counted = await pool.query<{ draft_count: number }>(
    `SELECT count(*)::int AS draft_count FROM (${matchedDrafts}) md`,
    params,
  );
  const draft_count = counted.rows[0]?.draft_count ?? 0;
  if (draft_count === 0 || ids.length === 0) {
    return { draft_count, values: new Map() };
  }

  const rowParams = [...params];
  const bind = (value: unknown) => `$${rowParams.push(value)}`;
  const idsBind = bind(ids);
  const minPicks = bind(filters.min_picks);

  const { rows } = await pool.query<{ player_id: string; adp: number; picks: number }>(
    `WITH matched_drafts AS (${matchedDrafts})
     SELECT dp.player_id,
            round(avg(dp.pick_no)::numeric, 2)::float8 AS adp,
            count(*)::int AS picks
       FROM draft_picks dp
       JOIN matched_drafts md ON md.draft_id = dp.draft_id
      WHERE dp.player_id = ANY(${idsBind}::varchar[])
      GROUP BY dp.player_id
     HAVING count(*) >= ${minPicks}`,
    rowParams,
  );

  const values = new Map<string, PlayerAdp>();
  for (const r of rows) values.set(r.player_id, { adp: r.adp, picks: r.picks });
  return { draft_count, values };
}
